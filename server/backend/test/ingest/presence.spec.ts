import { ContractValidator } from '../../src/contracts/contract-validator';
import { InMemoryHitRepository } from '../../src/modules/hits/in-memory-hit.repository';
import { IngestService } from '../../src/modules/mqtt/ingest.service';
import {
  IncidentInput,
  IncidentSinkPort,
  PresenceSinkPort,
  PresenceUpdate,
} from '../../src/modules/hits/ports';
import { loadExamples } from '../helpers/examples';

class NullSink implements IncidentSinkPort {
  async record(_i: IncidentInput): Promise<void> {
    /* no-op */
  }
}

class RecordingPresence implements PresenceSinkPort {
  readonly updates: PresenceUpdate[] = [];
  readonly touches: { slug: string; at: Date; revives: boolean }[] = [];
  failNext = false;

  async record(update: PresenceUpdate): Promise<unknown> {
    if (this.failNext) throw new Error('base de datos caída');
    this.updates.push(update);
    return null;
  }

  async touch(moduleSlug: string, at: Date, revives = false): Promise<void> {
    this.touches.push({ slug: moduleSlug, at, revives });
  }
}

function example(name: string): Record<string, unknown> {
  const found = loadExamples('valid').find((e) => e.name.includes(name));
  if (!found) throw new Error(`Falta el ejemplo ${name}`);
  return JSON.parse(JSON.stringify(found.payload)) as Record<string, unknown>;
}

const TOPIC = 'targets/v1/module/module-03/presence';
const RECEIVED_AT = new Date('2026-07-26T10:00:00Z');

/**
 * G-I · La presencia se persiste. Antes se validaba contra el contrato y se
 * descartaba: `Module.online` no lo escribía nadie, así que ninguna caída se
 * detectaba.
 */
describe('Ingesta de presencia (G-I)', () => {
  const validator = new ContractValidator();
  let presence: RecordingPresence;
  let ingest: IngestService;

  beforeEach(() => {
    presence = new RecordingPresence();
    ingest = new IngestService(
      validator,
      new InMemoryHitRepository(),
      new NullSink(),
      presence,
    );
  });

  it('el Last Will (online:false) llega al sumidero de presencia', async () => {
    const result = await ingest.handleMessage(TOPIC, example('lwt'), RECEIVED_AT);
    expect(result.status).toBe('accepted');
    expect(presence.updates).toHaveLength(1);
    expect(presence.updates[0]).toMatchObject({
      moduleSlug: 'module-03',
      online: false,
      reason: 'lwt',
      at: RECEIVED_AT,
    });
  });

  it('la conexión trae la identidad del módulo (firmware, mac, ip…)', async () => {
    await ingest.handleMessage(TOPIC, example('module-presence/online'), RECEIVED_AT);
    expect(presence.updates[0]).toMatchObject({
      online: true,
      reason: 'connect',
      firmwareVersion: '0.1.0',
      mac: 'BC:24:11:00:00:03',
      ip: '192.168.1.61',
    });
  });

  it('un fallo al persistir la presencia NO tumba la ingesta', async () => {
    presence.failNext = true;
    const result = await ingest.handleMessage(TOPIC, example('lwt'), RECEIVED_AT);
    expect(result.status).toBe('accepted');
  });

  it('un mensaje de presencia inválido se rechaza y no llega al sumidero', async () => {
    const result = await ingest.handleMessage(
      TOPIC,
      { schema_version: 1, module_id: 'module-03' },
      RECEIVED_AT,
    );
    expect(result.status).toBe('rejected');
    expect(presence.updates).toHaveLength(0);
  });

  it('un módulo no puede publicar la presencia de otro', async () => {
    const payload = { ...example('lwt'), module_id: 'module-09' };
    const result = await ingest.handleMessage(TOPIC, payload, RECEIVED_AT);
    expect(result.status).toBe('rejected');
    expect(presence.updates).toHaveLength(0);
  });

  it('la telemetría cuenta como señal de vida, no como cambio de presencia', async () => {
    const telemetry = loadExamples('valid').find((e) => e.name.includes('module-telemetry'));
    if (!telemetry) return; // sin ejemplo no se inventa la comprobación
    await ingest.handleMessage(
      'targets/v1/module/module-03/telemetry',
      JSON.parse(JSON.stringify(telemetry.payload)),
      RECEIVED_AT,
    );
    expect(presence.updates).toHaveLength(0);
    // La telemetría NO se retiene: prueba que el módulo está vivo AHORA, así
    // que puede deshacer una caída declarada por silencio (D2).
    expect(presence.touches[0]).toMatchObject({
      slug: 'module-03',
      at: RECEIVED_AT,
      revives: true,
    });
  });

  it('el estado, que SÍ es retenido, no puede resucitar a un módulo muerto', async () => {
    const status = loadExamples('valid').find((e) => e.name.includes('module-status'));
    if (!status) throw new Error('Falta el ejemplo de module-status');
    await ingest.handleMessage(
      'targets/v1/module/module-03/status',
      JSON.parse(JSON.stringify(status.payload)),
      RECEIVED_AT,
    );
    // Un retenido se reentrega al reconectar el backend: daría por vivo a un
    // módulo realmente muerto.
    expect(presence.touches[0]).toMatchObject({ slug: 'module-03', revives: false });
  });

  it('un impacto sí resucita: es la prueba de vida más fuerte y no se retiene', async () => {
    const hit = loadExamples('valid').find((e) => e.name.includes('hit-event'));
    if (!hit) throw new Error('Falta el ejemplo de hit-event');
    const payload = JSON.parse(JSON.stringify(hit.payload)) as Record<string, unknown>;
    payload.module_id = 'module-03';
    await ingest.handleMessage('targets/v1/module/module-03/hit', payload, RECEIVED_AT);
    expect(presence.touches[0]).toMatchObject({ slug: 'module-03', revives: true });
  });
});
