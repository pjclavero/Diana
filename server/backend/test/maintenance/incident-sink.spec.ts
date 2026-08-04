import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaIncidentSink } from '../../src/modules/maintenance/incident.sink';

const RECEIVED_AT = new Date('2026-08-04T10:00:03.000Z');
const EVENT_AT = new Date('2026-08-04T10:00:00.000Z');

function build(module: { id: string } | null = null) {
  const create = jest.fn().mockResolvedValue({ id: 'inc-1' });
  const prisma = {
    module: { findUnique: jest.fn().mockResolvedValue(module) },
    incident: { create },
  };
  return { sink: new PrismaIncidentSink(prisma as never), prisma, create };
}

describe('PrismaIncidentSink · identidad y tiempo de diagnóstico (F6)', () => {
  it('conserva el slug de un módulo desconocido y avisa dónde consultarlo', async () => {
    const { sink, create } = build(null);
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await sink.record({
      kind: 'self_test_result',
      severity: 'info',
      source: 'diagnostic',
      moduleSlug: 'module-sin-alta',
      eventId: 'evento-1',
      message: 'Autodiagnóstico correcto',
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ moduleId: null, moduleSlug: 'module-sin-alta' }),
    });
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/módulo aún desconocido.*listado global/));
    warning.mockRestore();
  });

  it('guarda por separado la hora del módulo, T1 y la recepción T3', async () => {
    const { sink, create } = build({ id: 'module-db-1' });

    await sink.record({
      kind: 'calibration_result',
      severity: 'info',
      source: 'diagnostic',
      moduleSlug: 'module-01',
      eventId: 'evento-2',
      message: 'Calibración terminada',
      receivedAt: RECEIVED_AT,
      moduleTime: {
        bootId: '99999999-2222-4333-8444-555555555555',
        eventUs: 4_200_000,
        epochMs: EVENT_AT.getTime(),
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        moduleId: 'module-db-1',
        moduleSlug: 'module-01',
        occurredAt: RECEIVED_AT,
        deviceOccurredAt: EVENT_AT,
        deviceEventUs: 4_200_000n,
        deviceEpochMs: BigInt(EVENT_AT.getTime()),
        deviceBootId: '99999999-2222-4333-8444-555555555555',
      }),
    });
  });

  it('si `epoch_ms` es nulo no inventa una fecha desde el reloj monotónico', async () => {
    const { sink, create } = build({ id: 'module-db-1' });

    await sink.record({
      kind: 'self_test_result',
      severity: 'info',
      source: 'diagnostic',
      moduleSlug: 'module-01',
      message: 'Autodiagnóstico correcto',
      receivedAt: RECEIVED_AT,
      moduleTime: {
        bootId: '99999999-2222-4333-8444-555555555555',
        eventUs: 9_000_000,
        epochMs: null,
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        occurredAt: RECEIVED_AT,
        deviceOccurredAt: null,
        deviceEventUs: 9_000_000n,
        deviceEpochMs: null,
      }),
    });
  });

  it('propaga el fallo de un diagnóstico para que la ingesta pueda contabilizarlo', async () => {
    const { sink, create } = build({ id: 'module-db-1' });
    create.mockRejectedValueOnce(new Error('disco lleno'));
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      sink.record({
        kind: 'self_test_result',
        severity: 'error',
        source: 'diagnostic',
        moduleSlug: 'module-01',
        message: 'No se pudo guardar',
      }),
    ).rejects.toThrow('disco lleno');
    expect(errorLog).toHaveBeenCalledWith(expect.stringMatching(/No se pudo registrar.*disco lleno/));
    errorLog.mockRestore();
  });
});

describe('Migración F6 · sólo aditiva y reejecutable', () => {
  it('sujeta las cinco columnas y el índice con `IF NOT EXISTS`', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20260804230000_incident_module_identity_and_time/migration.sql',
      ),
      'utf8',
    );
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

    for (const column of [
      'module_slug',
      'device_occurred_at',
      'device_event_us',
      'device_epoch_ms',
      'device_boot_id',
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
    }
    expect(migration).toMatch(/CREATE INDEX IF NOT EXISTS "incidents_module_slug_occurred_at_idx"/);
    expect(schema).toContain('moduleSlug');
    expect(schema).toContain('deviceOccurredAt');
    expect(schema).toContain('deviceEventUs');
  });
});
