import { ContractValidator } from '../../src/contracts/contract-validator';
import { InMemoryHitRepository } from '../../src/modules/hits/in-memory-hit.repository';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';
import {
  HitEventPayload,
  hasAnalogMeasurement,
  toHitRecord,
} from '../../src/domain/hits/hit-record';
import { loadExamples } from '../helpers/examples';

class NullIncidentSink implements IncidentSinkPort {
  readonly incidents: IncidentInput[] = [];
  async record(incident: IncidentInput): Promise<void> {
    this.incidents.push(incident);
  }
}

function example(kind: 'valid' | 'invalid', needle: string): HitEventPayload {
  const found = loadExamples(kind).find((e) => e.name.includes(needle));
  if (!found) throw new Error(`No existe el ejemplo ${kind}/${needle}`);
  return JSON.parse(JSON.stringify(found.payload)) as HitEventPayload;
}

/**
 * ADR-0007 · reconciliación del contrato DO-only (`CONTRACT_GAP-DO-ONLY`).
 *
 * El punto que estas pruebas defienden no es "amplitude puede faltar" sino que
 * la AUSENCIA por sí sola no es interpretación válida: hace falta que el
 * productor DECLARE su perfil. Sin discriminador, "módulo DO-only sin ADC" y
 * "productor averiado que perdió el campo" son el mismo mensaje.
 */
describe('ADR-0007 · perfil de detección DO-only', () => {
  const validator = new ContractValidator();
  let ingest: IngestService;

  beforeEach(() => {
    ingest = new IngestService(validator, new InMemoryHitRepository(), new NullIncidentSink());
  });

  const topicFor = (moduleId: string) => `targets/v1/module/${moduleId}/hit`;

  it('acepta un impacto DO-only legítimo (declara digital_threshold y no trae medidas)', async () => {
    const payload = example('valid', 'do-only-digital-hit');
    expect(payload.detection_method).toBe('digital_threshold');
    expect(payload.amplitude).toBeUndefined();

    const result = await ingest.handleMessage(
      topicFor(payload.module_id),
      Buffer.from(JSON.stringify(payload)),
    );
    expect({ status: result.status, code: result.code }).toEqual({
      status: 'accepted',
      code: undefined,
    });
  });

  it('RECHAZA un evento analógico al que le falta amplitude (productor defectuoso)', async () => {
    const payload = example('invalid', 'analog-without-amplitude');
    expect(payload.detection_method).toBeUndefined();

    const result = await ingest.handleMessage(
      topicFor(payload.module_id),
      Buffer.from(JSON.stringify(payload)),
    );
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('schema_violation');
    expect(result.errors!.join(' ')).toMatch(/amplitude/);
  });

  it('la relajación de b883da0 los confundía: mismo mensaje, dos significados', async () => {
    // Un DO-only legítimo y un analógico averiado se diferencian HOY sólo por
    // el discriminador. Se comprueba construyendo el defectuoso a partir del
    // legítimo: quitarle `detection_method` lo convierte en inválido.
    const legitimo = example('valid', 'do-only-digital-hit');
    const averiado = { ...legitimo };
    delete (averiado as Record<string, unknown>).detection_method;

    const okLegit = await ingest.handleMessage(
      topicFor(legitimo.module_id),
      Buffer.from(JSON.stringify(legitimo)),
    );
    const okAveriado = await ingest.handleMessage(
      topicFor(legitimo.module_id),
      Buffer.from(JSON.stringify(averiado)),
    );

    expect(okLegit.status).toBe('accepted');
    expect(okAveriado.status).toBe('rejected');
  });

  it('RECHAZA un discriminador incoherente con sus campos (digital + amplitude)', async () => {
    const payload = example('invalid', 'digital-with-amplitude');
    const result = await ingest.handleMessage(
      topicFor(payload.module_id),
      Buffer.from(JSON.stringify(payload)),
    );
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('schema_violation');
  });

  it('RECHAZA un método de detección desconocido en vez de interpretarlo por parecido', async () => {
    const payload = example('invalid', 'unknown-detection-method');
    const result = await ingest.handleMessage(
      topicFor(payload.module_id),
      Buffer.from(JSON.stringify(payload)),
    );
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('schema_violation');
  });

  describe('traducción a registro persistible', () => {
    it('DO-only: amplitude y threshold quedan NULL, NUNCA 0', () => {
      const record = toHitRecord(example('valid', 'do-only-digital-hit'), new Date());
      expect(record.detectionMethod).toBe('digital_threshold');
      expect(record.amplitude).toBeNull();
      expect(record.threshold).toBeNull();
      expect(record.noiseFloor).toBeNull();
      // Un 0 sería un dato falso: el hardware no midió nada, no midió cero.
      expect(record.amplitude).not.toBe(0);
      expect(hasAnalogMeasurement(record)).toBe(false);
    });

    it('analógico sin discriminador: se resuelve a analog_envelope y conserva la medida', () => {
      const record = toHitRecord(example('valid', 'valid-hit'), new Date());
      expect(record.detectionMethod).toBe('analog_envelope');
      expect(record.amplitude).toBe(2710);
      expect(record.threshold).toBe(920);
      expect(hasAnalogMeasurement(record)).toBe(true);
    });
  });
});
