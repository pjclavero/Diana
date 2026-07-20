import { ContractValidator } from '../../src/contracts/contract-validator';
import { InMemoryHitRepository } from '../../src/modules/hits/in-memory-hit.repository';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';
import {
  HitEventPayload,
  markIfOutOfWindow,
  toHitRecord,
} from '../../src/domain/hits/hit-record';
import { loadExamples } from '../helpers/examples';

class NullSink implements IncidentSinkPort {
  readonly incidents: IncidentInput[] = [];
  async record(i: IncidentInput): Promise<void> {
    this.incidents.push(i);
  }
}

function validHitPayload(): HitEventPayload {
  const example = loadExamples('valid').find((e) => e.name.includes('valid-hit'))!;
  return JSON.parse(JSON.stringify(example.payload)) as HitEventPayload;
}

/**
 * ADR-0002 · El backend NO reescribe T1 ni T2.
 * Estas pruebas son la salvaguarda del requisito más delicado del proyecto.
 */
describe('Autoridad temporal (ADR-0002)', () => {
  const validator = new ContractValidator();

  it('T1 y T2 se copian literalmente del payload', () => {
    const payload = validHitPayload();
    const receivedAt = new Date('2026-07-20T12:00:00.000Z');
    const record = toHitRecord(payload, receivedAt);

    // T1 · propiedad del ESP32
    expect(record.deviceBootId).toBe(payload.device.boot_id);
    expect(record.deviceUptimeUs).toBe(BigInt(payload.device.uptime_us));
    expect(record.deviceEventUs).toBe(BigInt(payload.device.event_us));

    // T2 · propiedad del coordinador
    expect(record.coordinatorRecvUs).toBe(BigInt(payload.coordinator!.recv_us));
    expect(record.coordinatorElapsedUs).toBe(BigInt(payload.coordinator!.elapsed_us));
    expect(record.clockOffsetUs).toBe(BigInt(payload.coordinator!.clock_offset_us));
    expect(record.offsetUncertaintyUs).toBe(BigInt(payload.coordinator!.offset_uncertainty_us!));

    // T3 · única marca que aporta el backend en la ingesta
    expect(record.receivedAt).toBe(receivedAt);
  });

  it('T1 y T2 viven en columnas distintas de T3: no hay solapamiento', () => {
    const record = toHitRecord(validHitPayload(), new Date());
    expect(record).toHaveProperty('deviceEventUs');
    expect(record).toHaveProperty('coordinatorElapsedUs');
    expect(record).toHaveProperty('receivedAt');
    // El registro NO expone un `elapsed_us` plano que pudiera rellenar el backend.
    expect(Object.keys(record)).not.toContain('elapsed_us');
    expect(Object.keys(record)).not.toContain('elapsedUs');
  });

  it('un evento sin coordinador (satélite crudo) deja T2 en null, no lo inventa', () => {
    const crosstalk = loadExamples('valid').find((e) => e.name.includes('crosstalk-rejected'))!;
    const record = toHitRecord(crosstalk.payload as unknown as HitEventPayload, new Date());
    expect(record.coordinatorElapsedUs).toBeNull();
    expect(record.coordinatorRecvUs).toBeNull();
    expect(record.clockOffsetUs).toBeNull();
    // Pero T1 sigue presente: un evento sin T1 sería inválido.
    expect(record.deviceEventUs).toBeGreaterThan(0n);
  });

  it('marcar fuera de ventana NO modifica T1 ni T2', () => {
    const payload = validHitPayload();
    const receivedAt = new Date('2026-07-20T12:00:00.000Z');
    const original = toHitRecord(payload, receivedAt);

    const marked = markIfOutOfWindow(original, new Date('2026-07-20T12:00:30.000Z'), {
      maxLatencyMs: 5000,
    });

    expect(marked.outOfWindow).toBe(true);
    expect(marked.outOfWindowReason).toMatch(/T1 y T2 se conservan/);
    expect(marked.deviceEventUs).toBe(original.deviceEventUs);
    expect(marked.deviceUptimeUs).toBe(original.deviceUptimeUs);
    expect(marked.deviceBootId).toBe(original.deviceBootId);
    expect(marked.coordinatorElapsedUs).toBe(original.coordinatorElapsedUs);
    expect(marked.coordinatorRecvUs).toBe(original.coordinatorRecvUs);
    expect(marked.clockOffsetUs).toBe(original.clockOffsetUs);
    expect(marked.receivedAt).toBe(original.receivedAt);
  });

  it('dentro de ventana el registro no se toca en absoluto', () => {
    const original = toHitRecord(validHitPayload(), new Date('2026-07-20T12:00:00.000Z'));
    const marked = markIfOutOfWindow(original, new Date('2026-07-20T12:00:00.100Z'), {
      maxLatencyMs: 5000,
    });
    expect(marked).toBe(original);
  });

  it('la ingesta rechaza un payload que traiga la hora del servidor (T3 inyectada)', async () => {
    const ingest = new IngestService(validator, new InMemoryHitRepository(), new NullSink());
    const payload = { ...validHitPayload(), received_at: '2026-07-20T10:00:00Z' };
    const result = await ingest.handleMessage(
      'targets/v1/module/module-03/hit',
      Buffer.from(JSON.stringify(payload)),
    );
    expect(result.status).toBe('rejected');
    expect(result.errors!.join(' ')).toMatch(/received_at/);
  });

  it('la ingesta persiste el evento con T1/T2 idénticos al payload', async () => {
    const repo = new InMemoryHitRepository();
    const ingest = new IngestService(validator, repo, new NullSink());
    const payload = validHitPayload();

    await ingest.handleMessage(
      'targets/v1/module/module-03/hit',
      Buffer.from(JSON.stringify(payload)),
      new Date('2026-07-20T12:00:00.000Z'),
    );

    const stored = await repo.findByEventId(payload.event_id);
    expect(stored).not.toBeNull();
    expect(stored!.deviceEventUs).toBe(BigInt(payload.device.event_us));
    expect(stored!.coordinatorElapsedUs).toBe(BigInt(payload.coordinator!.elapsed_us));
    expect(stored!.receivedAt.toISOString()).toBe('2026-07-20T12:00:00.000Z');
  });
});
