import { IngestService } from '../../src/modules/mqtt/ingest.service';
import { ContractValidator } from '../../src/contracts/contract-validator';
import type { IncidentInput, IncidentSinkPort } from '../../src/modules/hits/ports';
import { Logger } from '@nestjs/common';

/**
 * La persistencia de los diagnósticos es la MITAD de F6: sin ella, ordenar una
 * prueba no deja rastro del resultado y `GET /modules/:id/diagnostics` está
 * vacío para siempre. Se podía borrar entera con toda la suite en verde.
 */
class SinkEspia implements IncidentSinkPort {
  readonly recorded: IncidentInput[] = [];
  async record(incident: IncidentInput): Promise<void> {
    this.recorded.push(incident);
  }
}

const RECEIVED_AT = new Date('2026-07-26T10:00:00Z');
const TOPIC = 'targets/v1/module/module-03/diagnostic';

const payload = (over: Record<string, unknown> = {}) => ({
  schema_version: 1,
  module_id: 'module-03',
  event_id: '11111111-2222-4333-8444-555555555555',
  kind: 'self_test_result',
  severity: 'error',
  message: 'Sensor 4 sin respuesta',
  firmware_version: '1.2.3',
  device: {
    boot_id: '99999999-2222-4333-8444-555555555555',
    uptime_us: 1_000_000,
    event_us: 1_000_000,
    epoch_ms: null,
  },
  ...over,
});

function build() {
  const sink = new SinkEspia();
  const metrics = { accepted: 0, rejected: 0 } as never;
  const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
  const service = new IngestService(new ContractValidator(), hits, sink);
  return { service, sink, metrics };
}

describe('Ingesta de diagnósticos (F6)', () => {
  it('un resultado de autodiagnóstico se PERSISTE', async () => {
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(sink.recorded).toHaveLength(1);
    expect(sink.recorded[0]).toMatchObject({
      kind: 'self_test_result',
      severity: 'error',
      source: 'diagnostic',
      moduleSlug: 'module-03',
      message: 'Sensor 4 sin respuesta',
    });
  });

  it('el `source` es EXACTAMENTE el que consulta la pantalla', async () => {
    // Si la ingesta escribe `diagnostico` y la consulta filtra `diagnostic`, el
    // operador no ve un resultado jamás y todo parece funcionar.
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(sink.recorded[0].source).toBe('diagnostic');
  });

  it('la gravedad se conserva: un error no se guarda como informativo', async () => {
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload({ severity: 'critical' }), RECEIVED_AT);
    expect(sink.recorded[0].severity).toBe('critical');
  });

  it('el detalle del módulo se conserva y no lo pisa la versión de firmware', async () => {
    const { service, sink } = build();
    await service.handleMessage(
      TOPIC,
      payload({ detail: { sensor: 4, firmware_version: 'LA-DEL-MODULO' } }),
      RECEIVED_AT,
    );
    const detail = sink.recorded[0].detail as Record<string, unknown>;
    expect(detail.sensor).toBe(4);
    // Lo que dice el módulo en su detalle manda sobre lo que añadimos nosotros.
    expect(detail.firmware_version).toBe('LA-DEL-MODULO');
  });

  it('sin detalle no revienta', async () => {
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(sink.recorded[0].detail).toMatchObject({ firmware_version: '1.2.3' });
  });

  it('entrega al sink T1 y T3 sin convertir `event_us` en una fecha', async () => {
    const { service, sink } = build();
    await service.handleMessage(TOPIC, payload(), RECEIVED_AT);
    expect(sink.recorded[0]).toMatchObject({
      receivedAt: RECEIVED_AT,
      moduleTime: {
        bootId: '99999999-2222-4333-8444-555555555555',
        eventUs: 1_000_000,
        epochMs: null,
      },
    });
  });

  it('si falla la persistencia deja métrica y registro, pero la ingesta sigue aceptada', async () => {
    const sink: IncidentSinkPort = {
      record: jest.fn().mockRejectedValue(new Error('PostgreSQL no disponible')),
    };
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const hits = { insert: jest.fn(), exists: jest.fn().mockResolvedValue(false) } as never;
    const service = new IngestService(new ContractValidator(), hits, sink);

    const result = await service.handleMessage(TOPIC, payload(), RECEIVED_AT);

    expect(result.status).toBe('accepted');
    expect(service.getMetrics().diagnosticPersistenceFailures).toBe(1);
    expect(logger).toHaveBeenCalledWith(
      expect.stringMatching(/Diagnóstico aceptado pero no persistido.*module-03.*PostgreSQL no disponible/),
    );
    logger.mockRestore();
  });

  it('un diagnóstico que incumple el contrato se rechaza y NO se guarda', async () => {
    const { service, sink } = build();
    const res = await service.handleMessage(TOPIC, payload({ severity: 'inventada' }), RECEIVED_AT);
    expect(res.status).toBe('rejected');
    expect(sink.recorded.filter((r) => r.source === 'diagnostic')).toHaveLength(0);
  });

  it('un módulo no puede publicar el diagnóstico de otro', async () => {
    const { service, sink } = build();
    const res = await service.handleMessage(TOPIC, payload({ module_id: 'module-09' }), RECEIVED_AT);
    expect(res.status).toBe('rejected');
    expect(sink.recorded.filter((r) => r.source === 'diagnostic')).toHaveLength(0);
  });
});
