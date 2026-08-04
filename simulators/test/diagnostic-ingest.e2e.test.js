import { describe, expect, it, vi } from 'vitest';
import { VirtualClock } from '../src/clock.ts';
import { validateAgainstSchema } from '../src/contracts/ajv.ts';
import { Simulation } from '../src/simulation.ts';
import { ContractValidator } from '../../server/backend/src/contracts/contract-validator.ts';
import { PrismaIncidentSink } from '../../server/backend/src/modules/maintenance/incident.sink.ts';
import { IngestService } from '../../server/backend/src/modules/mqtt/ingest.service.ts';
import { ModuleDiagnosticsService } from '../../server/backend/src/modules/modules/module-diagnostics.service.ts';

const TOPIC_COMMAND = 'targets/v1/module/module-01/command';
const TOPIC_DIAGNOSTIC = 'targets/v1/module/module-01/diagnostic';
const RECEIVED_AT = new Date('2026-08-04T10:00:03.000Z');

function command(action, nonce, params) {
  return {
    schema_version: 1,
    command_id: `aaaaaaaa-0000-4000-8000-${String(nonce).padStart(12, '0')}`,
    issued_at_ms: 0,
    expires_in_ms: 5000,
    nonce,
    issuer: 'backend',
    module_id: 'module-01',
    action,
    ...(params ? { params } : {}),
  };
}

describe('F6 · recorrido completo simulador → ingesta → persistencia → consulta', () => {
  it('persiste y expone las respuestas de sensor, calibración y LED', async () => {
    const clock = new VirtualClock();
    const simulation = new Simulation({ systemId: 'system-a', seed: 606, clock });
    const [module] = simulation.addDefaultModules(1);
    const broker = simulation.getBroker();
    const rows = [];
    const dbModule = { id: '11111111-1111-4111-8111-111111111111', slug: 'module-01', ownerId: null };
    const prisma = {
      module: { findUnique: vi.fn().mockResolvedValue(dbModule) },
      incident: {
        create: vi.fn(async ({ data }) => {
          const row = { id: `inc-${rows.length + 1}`, ...data };
          rows.push(row);
          return row;
        }),
        findMany: vi.fn(async () => [...rows].reverse()),
      },
    };
    const sink = new PrismaIncidentSink(prisma);
    const hits = { insertIfAbsent: vi.fn(), findByEventId: vi.fn(), countByRound: vi.fn() };
    const ingest = new IngestService(new ContractValidator(), hits, sink);
    const ingestResults = [];

    broker.subscribe('backend-de-prueba', TOPIC_DIAGNOSTIC, async (message) => {
      const contract = validateAgainstSchema('module-diagnostic.schema.json', message.payload);
      expect(contract.valid, contract.errors.join('\n')).toBe(true);
      ingestResults.push(await ingest.handleMessage(message.topic, message.payload, RECEIVED_AT));
    });

    await simulation.bootAll();
    await broker.publish('backend-de-prueba', TOPIC_COMMAND, command('self_test', 1), {
      qos: 1,
      retain: false,
    });
    await broker.publish('backend-de-prueba', TOPIC_COMMAND, command('start_calibration', 2), {
      qos: 1,
      retain: false,
    });
    await broker.publish(
      'backend-de-prueba',
      TOPIC_COMMAND,
      command('led_test', 3, { targets: [{ target_index: 3, state: 'active' }] }),
      { qos: 1, retain: false },
    );

    expect(ingestResults.map((result) => result.status)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
    expect(rows.map((row) => row.kind)).toEqual([
      'self_test_result',
      'calibration_result',
      'self_test_result',
    ]);
    expect(rows[2].detail).toMatchObject({ component: 'led', result: 'ok' });
    expect(module.getTargetsSnapshot().find((target) => target.target_index === 3)?.state).toBe(
      'active',
    );

    const diagnostics = new ModuleDiagnosticsService(prisma, { sendModuleCommand: vi.fn() });
    const visible = await diagnostics.results('module-01', {
      userId: 'admin',
      role: 'administrador',
    });
    expect(visible.items).toHaveLength(3);
    expect(visible.items.map((item) => item.kind).sort()).toEqual([
      'calibration_result',
      'self_test_result',
      'self_test_result',
    ]);
    expect(visible.items.every((item) => item.timeBasis === 'ingest_received')).toBe(true);
  });
});
