import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { ContractValidator } from '../../src/contracts/contract-validator';
import { resolveContractsDir } from '../../src/contracts/contracts-path';
import { InMemoryHitRepository } from '../../src/modules/hits/in-memory-hit.repository';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';
import { loadExamples } from '../helpers/examples';

class SinkSilencioso implements IncidentSinkPort {
  readonly incidents: IncidentInput[] = [];
  async record(incident: IncidentInput): Promise<void> {
    this.incidents.push(incident);
  }
}

/**
 * CONSUMIBILIDAD de los ejemplos del contrato.
 *
 * `contract-examples.spec.ts` comprueba que los ejemplos de `valid/` son
 * aceptados, pero los pasa por `loadExamples`, que RETIRA `_schema` y
 * `_reason` antes de entregarlos. `contracts/validate.py` hace exactamente lo
 * mismo (`strip_meta`). Resultado: el fichero que hay en disco —el que un
 * productor nuevo copia— nunca se prueba tal cual, y el backend real, que no
 * retira nada y cuyos esquemas declaran `additionalProperties: false`, lo
 * rechaza con `schema_violation`. Como el broker ya ha devuelto PUBACK, el
 * productor no se entera: el rechazo sólo aparece en el log del backend.
 *
 * Esta suite mide sobre los BYTES DE DISCO, sin pasar por ningún helper que
 * limpie nada:
 *
 *   - CONTROL POSITIVO: cada fichero de `contracts/examples/publishable/` es
 *     aceptado por `IngestService`, leído tal cual con `fs.readFileSync`.
 *   - CONTROL NEGATIVO: cada fichero de `contracts/examples/valid/`, leído
 *     igual de crudo, es RECHAZADO con `schema_violation` por `_schema`. Si
 *     algún día dejara de serlo, este control se pone rojo y avisa de que la
 *     premisa ha cambiado, en vez de dejar el remedio ahí por inercia.
 *   - COBERTURA: la correspondencia es total y biyectiva, así que un ejemplo
 *     válido nuevo sin su gemelo publicable pone la suite en rojo. La garantía
 *     es para TODOS los ejemplos, no para el que se descubrió roto.
 */
describe('Ejemplos del contrato · consumibles por el backend real', () => {
  const contractsDir = resolveContractsDir();
  const dirValid = path.join(contractsDir, 'examples', 'valid');
  const dirPublicable = path.join(contractsDir, 'examples', 'publishable');
  const generador = path.join(contractsDir, 'examples', 'generate-publishable.mjs');

  const validator = new ContractValidator();
  let ingest: IngestService;

  beforeEach(() => {
    ingest = new IngestService(validator, new InMemoryHitRepository(), new SinkSilencioso());
  });

  function recorrer(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? recorrer(full) : e.name.endsWith('.json') ? [full] : [];
      })
      .sort();
  }

  const relativos = (dir: string, ficheros: string[]) =>
    ficheros.map((f) => path.relative(dir, f).split(path.sep).join('/'));

  const ficherosValid = relativos(dirValid, recorrer(dirValid));
  const ficherosPublicables = relativos(dirPublicable, recorrer(dirPublicable)).filter(
    (f) => f !== 'INDEX.json',
  );

  /** Tópico canónico del ejemplo, reutilizando el mapeo ya existente. */
  const topicoPorFichero = new Map(loadExamples('valid').map((e) => [e.name.split(path.sep).join('/'), e.topic]));

  it('hay ejemplos que comprobar', () => {
    expect(ficherosValid.length).toBeGreaterThan(0);
  });

  it('cada ejemplo válido tiene su gemelo publicable, y no sobra ninguno', () => {
    expect(ficherosPublicables).toEqual(ficherosValid);
  });

  it('el índice de esquemas cubre exactamente los mensajes publicables', () => {
    const indice = JSON.parse(fs.readFileSync(path.join(dirPublicable, 'INDEX.json'), 'utf8')) as {
      esquemas: Record<string, string>;
    };
    expect(Object.keys(indice.esquemas).sort()).toEqual([...ficherosPublicables].sort());
    for (const esquema of Object.values(indice.esquemas)) {
      expect(validator.schemaNames()).toContain(esquema);
    }
  });

  it('publishable/ está sincronizado con valid/ (el generador no ha quedado atrás)', () => {
    // Efecto observable, no `exit 0` a ciegas: si divergiera, `--check` sale 1
    // y execFileSync lanza. Se comprueba además que dijo lo que se espera.
    const salida = execFileSync('node', [generador, '--check'], { encoding: 'utf8' });
    expect(salida).toMatch(/al día/);
  });

  describe.each(ficherosPublicables)('publishable/%s', (rel) => {
    it('lo acepta la ingesta real, leído crudo de disco', async () => {
      const crudo = fs.readFileSync(path.join(dirPublicable, rel));
      const topico = topicoPorFichero.get(rel);
      expect(topico).toBeDefined();
      const result = await ingest.handleMessage(topico!, crudo);
      expect({ status: result.status, code: result.code, errors: result.errors }).toEqual({
        status: 'accepted',
        code: undefined,
        errors: undefined,
      });
    });
  });

  describe.each(ficherosValid)('valid/%s (control negativo)', (rel) => {
    it('el fichero con `_schema` dentro NO es publicable: la ingesta lo rechaza', async () => {
      const crudo = fs.readFileSync(path.join(dirValid, rel));
      const topico = topicoPorFichero.get(rel);
      expect(topico).toBeDefined();
      const result = await ingest.handleMessage(topico!, crudo);
      expect(result.status).toBe('rejected');
      expect(result.code).toBe('schema_violation');
      expect(result.errors!.join(' ')).toMatch(/_schema/);
    });
  });
});
