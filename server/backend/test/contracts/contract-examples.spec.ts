import { ContractValidator } from '../../src/contracts/contract-validator';
import { InMemoryHitRepository } from '../../src/modules/hits/in-memory-hit.repository';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';
import { loadExamples } from '../helpers/examples';

class RecordingIncidentSink implements IncidentSinkPort {
  readonly incidents: IncidentInput[] = [];
  async record(incident: IncidentInput): Promise<void> {
    this.incidents.push(incident);
  }
}

/**
 * Prueba de conformidad con el contrato congelado (WP-00).
 *
 * Todo ejemplo de `contracts/examples/valid` debe ser ACEPTADO por la capa de
 * ingesta y todo ejemplo de `invalid` debe ser RECHAZADO. No se valida contra
 * los esquemas directamente sino a través de `IngestService`, que es el camino
 * real de entrada al backend.
 */
describe('Ingesta · conformidad con contracts/examples', () => {
  const validator = new ContractValidator();
  let ingest: IngestService;
  let sink: RecordingIncidentSink;

  beforeEach(() => {
    sink = new RecordingIncidentSink();
    ingest = new IngestService(validator, new InMemoryHitRepository(), sink);
  });

  const validExamples = loadExamples('valid');
  const invalidExamples = loadExamples('invalid');

  it('hay ejemplos que comprobar', () => {
    expect(validExamples.length).toBeGreaterThan(0);
    expect(invalidExamples.length).toBeGreaterThan(0);
  });

  describe.each(validExamples.map((e) => [e.name, e] as const))('valid/%s', (_name, example) => {
    it('es aceptado por la ingesta', async () => {
      const result = await ingest.handleMessage(
        example.topic,
        Buffer.from(JSON.stringify(example.payload)),
      );
      expect({ status: result.status, code: result.code, errors: result.errors }).toEqual({
        status: 'accepted',
        code: undefined,
        errors: undefined,
      });
    });
  });

  describe.each(invalidExamples.map((e) => [e.name, e] as const))('invalid/%s', (_name, example) => {
    it(`es rechazado por la ingesta`, async () => {
      const result = await ingest.handleMessage(
        example.topic,
        Buffer.from(JSON.stringify(example.payload)),
      );
      expect(result.status).toBe('rejected');
      expect(result.code).toBeDefined();
    });
  });

  it('rechaza una schema_version futura con el código específico y registra incidencia', async () => {
    const example = invalidExamples.find((e) => e.name.includes('future-schema-version'));
    expect(example).toBeDefined();
    const result = await ingest.handleMessage(
      example!.topic,
      Buffer.from(JSON.stringify(example!.payload)),
    );
    expect(result.code).toBe('schema_version_unsupported');
    expect(sink.incidents).toHaveLength(1);
    expect(sink.incidents[0].kind).toBe('ingest_schema_version_unsupported');
    expect(sink.incidents[0].severity).toBe('error');
  });

  it('rechaza un payload con campos desconocidos (received_at inyectado, ADR-0002)', async () => {
    const example = invalidExamples.find((e) => e.name.includes('server-timestamp-injected'));
    expect(example).toBeDefined();
    const result = await ingest.handleMessage(
      example!.topic,
      Buffer.from(JSON.stringify(example!.payload)),
    );
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('schema_violation');
    expect(result.errors!.join(' ')).toMatch(/received_at/);
  });

  it('ignora, sin romperse, un tópico ajeno al contrato v1', async () => {
    const result = await ingest.handleMessage('otra/cosa/rara', Buffer.from('{}'));
    expect(result.status).toBe('ignored');
    expect(result.code).toBe('unknown_topic');
  });

  it('rechaza JSON no deserializable', async () => {
    const result = await ingest.handleMessage(
      'targets/v1/module/module-03/hit',
      Buffer.from('{no es json'),
    );
    expect(result.status).toBe('rejected');
    expect(result.code).toBe('invalid_json');
  });

  it('rechaza un evento cuyo module_id no coincide con el del tópico', async () => {
    const valid = loadExamples('valid').find((e) => e.name.includes('valid-hit'))!;
    const result = await ingest.handleMessage(
      'targets/v1/module/module-99/hit',
      Buffer.from(JSON.stringify(valid.payload)),
    );
    expect(result.status).toBe('rejected');
    expect(result.message).toMatch(/no coincide/);
  });

  it('todos los esquemas del contrato están cargados', () => {
    const names = validator.schemaNames();
    expect(names).toContain('hit-event.schema.json');
    expect(names.length).toBeGreaterThanOrEqual(12);
  });
});
