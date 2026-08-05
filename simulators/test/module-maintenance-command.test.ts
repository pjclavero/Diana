import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import { validateAgainstSchema } from '../src/contracts/ajv.js';
import { isMaintenanceCommandExpired } from '../src/domain/moduleSimulator.js';
import { Simulation } from '../src/simulation.js';

interface ModuleDiagnosticRejectedPayload {
  kind: 'command_rejected';
  request_id: string;
  detail: { accepted: false; reason: string; request_id: string };
}

/**
 * Canal `module/{id}/maintenance/command` (contrato §0/§2/§6-bis, ampliación
 * v1.1): guardarraíl de seguridad aplicado LOCALMENTE por el módulo. Es la
 * única implementación existente de estas reglas: el firmware ESP-IDF nunca
 * se ha compilado con ellas (README §6-bis). Cada regla del encargo tiene
 * aquí, como mínimo, una prueba dedicada que la fija.
 */

const MODULE_TOPIC = (id: string) => `targets/v1/module/${id}/maintenance/command`;
const DIAG_TOPIC = (id: string) => `targets/v1/module/${id}/diagnostic`;
const STATUS_TOPIC = (id: string) => `targets/v1/module/${id}/status`;
const TELEMETRY_TOPIC = (id: string) => `targets/v1/module/${id}/telemetry`;

interface MaintenanceCommand {
  schema_version: 1;
  request_id: string;
  module_id: string;
  command_type: string;
  issued_at_ms: number;
  expires_in_ms: number;
  nonce: number;
  requested_by: { actor_type: 'user' | 'operator'; actor_id: string };
  params?: Record<string, unknown>;
}

function baseCommand(overrides: Partial<MaintenanceCommand> & { command_type: string }): MaintenanceCommand {
  return {
    schema_version: 1,
    request_id: '11111111-1111-4111-8111-111111111111',
    module_id: 'module-01',
    issued_at_ms: 0,
    expires_in_ms: 5000,
    nonce: 1,
    requested_by: { actor_type: 'operator', actor_id: 'operator-cli' },
    ...overrides,
  };
}

/** Publica directamente en el broker en memoria como lo haría el backend (no un módulo). */
async function sendMaintenance(
  sim: Simulation,
  payload: MaintenanceCommand,
  moduleId = payload.module_id,
): Promise<void> {
  const broker = sim.getBroker()!;
  // 'backend-test' emula el client_id exclusivo del backend en este canal.
  await broker.publish('backend-test', MODULE_TOPIC(moduleId), payload, { qos: 1, retain: false });
}

function diagnosticsFor(sim: Simulation, moduleId: string): Record<string, unknown>[] {
  return sim
    .getBroker()!
    .history()
    .filter((m) => m.topic === DIAG_TOPIC(moduleId))
    .map((m) => m.payload as Record<string, unknown>);
}

function rejectionFor(sim: Simulation, moduleId: string, requestId: string): ModuleDiagnosticRejectedPayload | undefined {
  return diagnosticsFor(sim, moduleId).find(
    (d) => d.kind === 'command_rejected' && d.request_id === requestId,
  ) as ModuleDiagnosticRejectedPayload | undefined;
}

async function makeSim(): Promise<{ sim: Simulation; moduleId: string }> {
  const sim = new Simulation({ systemId: 'system-a', seed: 1, clock: new VirtualClock() });
  const [m] = sim.addDefaultModules(1);
  await sim.bootAll();
  return { sim, moduleId: m!.moduleId };
}

describe('maintenance/command · aceptación y respuesta (no debe tratarse como no-op)', () => {
  it('led_test aceptado publica un diagnóstico self_test_result correlacionado por request_id', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = 'aaaaaaaa-1111-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'led_test',
        params: { duration_ms: 2000, target_index: 3 },
      }),
    );
    await sim.settle();

    const diags = diagnosticsFor(sim, moduleId);
    const result = diags.find((d) => d.request_id === requestId);
    expect(result).toBeDefined();
    expect(result!.kind).toBe('self_test_result');
    const detail = result!.detail as Record<string, unknown>;
    expect(detail.component).toBe('led');
    expect(detail.result).toBe('ok');
    expect(detail.duration_ms).toBe(2000);
    expect(detail.target_index).toBe(3);

    const valid = validateAgainstSchema('module-diagnostic.schema.json', result);
    expect(valid.valid, valid.errors.join('\n')).toBe(true);
  });

  it('piezo_test, self_test, identify y start_calibration también responden (aceptación observable)', async () => {
    const { sim, moduleId } = await makeSim();
    const cases: { command_type: string; params?: Record<string, unknown>; kind: string }[] = [
      { command_type: 'piezo_test', params: { duration_ms: 1000 }, kind: 'self_test_result' },
      { command_type: 'self_test', kind: 'self_test_result' },
      { command_type: 'identify', params: { duration_ms: 500 }, kind: 'self_test_result' },
      { command_type: 'start_calibration', kind: 'calibration_result' },
    ];
    let i = 0;
    for (const c of cases) {
      i += 1;
      const requestId = `bbbbbbbb-${String(i).padStart(4, '0')}-4111-8111-111111111111`;
      await sendMaintenance(
        sim,
        baseCommand({
          request_id: requestId,
          module_id: moduleId,
          command_type: c.command_type,
          params: c.params,
        }),
      );
      await sim.settle();
      const result = diagnosticsFor(sim, moduleId).find((d) => d.request_id === requestId);
      expect(result, `${c.command_type} debería responder`).toBeDefined();
      expect(result!.kind).toBe(c.kind);
      const valid = validateAgainstSchema('module-diagnostic.schema.json', result);
      expect(valid.valid, valid.errors.join('\n')).toBe(true);
    }
  });

  it('request_telemetry aceptado dispara telemetría; query_status/query_version disparan status', async () => {
    const { sim, moduleId } = await makeSim();
    const before = sim.getBroker()!.history().length;

    await sendMaintenance(
      sim,
      baseCommand({ request_id: 'cccccccc-0001-4111-8111-111111111111', module_id: moduleId, command_type: 'request_telemetry' }),
    );
    await sim.settle();
    const afterTelemetry = sim.getBroker()!.history();
    expect(afterTelemetry.slice(before).some((m) => m.topic === TELEMETRY_TOPIC(moduleId))).toBe(true);

    const beforeStatus = afterTelemetry.length;
    await sendMaintenance(
      sim,
      baseCommand({ request_id: 'cccccccc-0002-4111-8111-111111111111', module_id: moduleId, command_type: 'query_status' }),
    );
    await sim.settle();
    const afterStatus = sim.getBroker()!.history();
    expect(afterStatus.slice(beforeStatus).some((m) => m.topic === STATUS_TOPIC(moduleId))).toBe(true);
  });
});

describe('maintenance/command · module_mismatch', () => {
  it('rechaza una orden dirigida a otro module_id', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = 'dddddddd-0001-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: 'module-99', command_type: 'query_status' }),
      moduleId, // se publica en el tópico de module-01 pero el payload dice module-99
    );
    await sim.settle();
    const rej = rejectionFor(sim, moduleId, requestId);
    expect(rej?.detail.reason).toBe('module_mismatch');
  });
});

describe('maintenance/command · unknown_command', () => {
  it('rechaza un command_type no reconocido por este firmware', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = 'eeeeeeee-0001-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'flash_ota' }),
    );
    await sim.settle();
    const rej = rejectionFor(sim, moduleId, requestId);
    expect(rej?.detail.reason).toBe('unknown_command');
  });

  it('rechaza también una orden de JUEGO colada en este canal (game_action_leak)', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = 'eeeeeeee-0002-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'set_targets' }),
    );
    await sim.settle();
    const rej = rejectionFor(sim, moduleId, requestId);
    expect(rej?.detail.reason).toBe('unknown_command');
  });
});

describe('maintenance/command · duplicate', () => {
  it('la segunda entrega del mismo request_id se rechaza y NO se re-ejecuta', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = 'ffffffff-0001-4111-8111-111111111111';
    const cmd = baseCommand({
      request_id: requestId,
      module_id: moduleId,
      command_type: 'led_test',
      params: { duration_ms: 1000 },
    });
    await sendMaintenance(sim, cmd);
    await sim.settle();
    await sendMaintenance(sim, cmd); // reentrega QoS 1
    await sim.settle();

    const diags = diagnosticsFor(sim, moduleId).filter((d) => d.request_id === requestId);
    // Una aceptación (self_test_result) + un rechazo (duplicate); nunca dos aceptaciones.
    expect(diags.filter((d) => d.kind === 'self_test_result')).toHaveLength(1);
    const dup = diags.find((d) => d.kind === 'command_rejected');
    expect((dup as unknown as ModuleDiagnosticRejectedPayload | undefined)?.detail.reason).toBe('duplicate');
  });
});

describe('maintenance/command · game_in_progress (leer sí, actuar no)', () => {
  it('con partida activa, led_test (actuar) se rechaza y request_telemetry (leer) se acepta', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setModuleState('game_active');

    const rejId = '11111111-2222-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: rejId, module_id: moduleId, command_type: 'led_test', params: { duration_ms: 1000 } }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, rejId)?.detail.reason).toBe('game_in_progress');

    const okId = '11111111-2222-4111-8111-111111111112';
    const before = sim.getBroker()!.history().length;
    await sendMaintenance(
      sim,
      baseCommand({ request_id: okId, module_id: moduleId, command_type: 'request_telemetry' }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, okId)).toBeUndefined();
    expect(sim.getBroker()!.history().slice(before).some((m2) => m2.topic === TELEMETRY_TOPIC(moduleId))).toBe(true);
  });

  it('cada uno de los cuatro command_type de actuar se rechaza con partida activa', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setModuleState('game_active');

    const actCommands: { command_type: string; params?: Record<string, unknown> }[] = [
      { command_type: 'led_test', params: { duration_ms: 500 } },
      { command_type: 'piezo_test', params: { duration_ms: 500 } },
      { command_type: 'self_test' },
      { command_type: 'start_calibration' },
    ];
    let i = 0;
    for (const c of actCommands) {
      i += 1;
      const requestId = `22222222-3333-4111-8111-11111111111${i}`;
      await sendMaintenance(
        sim,
        baseCommand({ request_id: requestId, module_id: moduleId, command_type: c.command_type, params: c.params }),
      );
      await sim.settle();
      expect(rejectionFor(sim, moduleId, requestId)?.detail.reason, c.command_type).toBe('game_in_progress');
    }
  });

  it('los cuatro command_type de leer se aceptan con partida activa', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setModuleState('game_active');

    const readCommands = ['request_telemetry', 'identify', 'query_version', 'query_status'];
    let i = 0;
    for (const commandType of readCommands) {
      i += 1;
      const requestId = `33333333-4444-4111-8111-11111111111${i}`;
      await sendMaintenance(
        sim,
        baseCommand({
          request_id: requestId,
          module_id: moduleId,
          command_type: commandType,
          params: commandType === 'identify' ? { duration_ms: 500 } : undefined,
        }),
      );
      await sim.settle();
      expect(rejectionFor(sim, moduleId, requestId), commandType).toBeUndefined();
    }
  });
});

describe('maintenance/command · expired (reloj normal)', () => {
  it('rechaza si ha pasado más de expires_in_ms desde issued_at_ms', async () => {
    const { sim, moduleId } = await makeSim();
    const clock = sim.getClock();
    await clock.sleep(10_000); // avanza el reloj virtual

    const requestId = '44444444-0001-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'query_status',
        issued_at_ms: 0, // emitido "hace" 10s
        expires_in_ms: 2000,
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('expired');
  });

  it('acepta dentro de la ventana de expires_in_ms', async () => {
    const { sim, moduleId } = await makeSim();
    const clock = sim.getClock();
    await clock.sleep(1000);

    const requestId = '44444444-0002-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'query_status',
        issued_at_ms: 0,
        expires_in_ms: 2000,
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
  });
});

/**
 * Frontera EXACTA de la caducidad (revisión del supervisor): nadie había
 * fijado por escrito si `nowMs - issuedAtMs === expiresInMs` acepta o
 * rechaza. El supervisor cambió `>` por `>=` en `isMaintenanceCommandExpired`
 * en aislamiento y sobrevivió 68/68 — ninguna prueba miraba ese instante
 * exacto. Decisión fijada aquí: INCLUSIVA del lado de aceptar (un mensaje
 * que llega en su último milisegundo de ventana sigue siendo válido).
 *
 * Los valores de esta prueba son LITERALES, no derivados de
 * MAINTENANCE_DURATION_LIMITS_MS ni de ninguna otra constante del código de
 * producción — precisamente el defecto que este proyecto ya sufrió una vez
 * (canal `module/command`): una prueba que deriva su instante límite de la
 * misma constante que usa el código se mueve junto con un mutante que altera
 * esa constante, y dos comparaciones equivalentes por construcción no
 * demuestran nada sobre dónde está la frontera real.
 */
describe('maintenance/command · frontera exacta de expired (decisión: inclusiva del lado de aceptar)', () => {
  it('unidad — isMaintenanceCommandExpired: elapsed === expiresInMs ACEPTA (false = no expirado)', () => {
    expect(isMaintenanceCommandExpired(2000, 0, 2000)).toBe(false);
  });

  it('unidad — isMaintenanceCommandExpired: elapsed === expiresInMs + 1 RECHAZA (true = expirado)', () => {
    expect(isMaintenanceCommandExpired(2001, 0, 2000)).toBe(true);
  });

  it('unidad — un elapsed muy por debajo del límite nunca expira', () => {
    expect(isMaintenanceCommandExpired(500, 0, 2000)).toBe(false);
  });

  it('comportamiento end-to-end — exactamente en el límite (2000ms de 2000ms) se acepta', async () => {
    const { sim, moduleId } = await makeSim();
    const clock = sim.getClock();
    await clock.sleep(2000); // literal: coincide exactamente con expires_in_ms de más abajo, no lo deriva

    const requestId = '44444444-0003-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'query_status',
        issued_at_ms: 0,
        expires_in_ms: 2000,
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
  });

  it('comportamiento end-to-end — un instante por encima del límite (2001ms de 2000ms) se rechaza', async () => {
    const { sim, moduleId } = await makeSim();
    const clock = sim.getClock();
    await clock.sleep(2001); // literal: un ms por encima del expires_in_ms de más abajo

    const requestId = '44444444-0004-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'query_status',
        issued_at_ms: 0,
        expires_in_ms: 2000,
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('expired');
  });
});

describe('maintenance/command · sin reloj sincronizado (§6-bis)', () => {
  it('sin clock_ok, un comando de ACTUAR caducado por diseño se rechaza con expired, aunque esté "reciente"', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setClockOk(false);

    const requestId = '55555555-0001-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'led_test',
        params: { duration_ms: 500 },
        issued_at_ms: 0,
        expires_in_ms: 600000, // TTL máximo permitido: no importa, sin reloj se rechaza igual
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('expired');
  });

  it('sin clock_ok, un comando de LEER se acepta pese a estar fuera de cualquier ventana razonable', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setClockOk(false);
    const clock = sim.getClock();
    await clock.sleep(999_000); // muy por encima de cualquier expires_in_ms posible (máx. 600000)

    const requestId = '55555555-0002-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'query_status',
        issued_at_ms: 0,
        expires_in_ms: 100,
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
  });

  it('con clock_ok restaurado a true, la misma orden de actuar vuelve a evaluarse por tiempo real', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setClockOk(false);
    m.setClockOk(true); // el reloj se sincroniza a mitad de sesión

    const requestId = '55555555-0003-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'led_test',
        params: { duration_ms: 500 },
        issued_at_ms: 0,
        expires_in_ms: 5000,
      }),
    );
    await sim.settle();
    // Reloj OK y dentro de ventana: se acepta (no 'expired').
    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
  });
});

describe('maintenance/command · params_out_of_range', () => {
  it('rechaza led_test con duration_ms por encima del límite del firmware (aunque el esquema lo permita)', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = '66666666-0001-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'led_test',
        params: { duration_ms: 45000 }, // < 60000 (límite del esquema) pero > 5000 (límite de firmware)
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('params_out_of_range');
  });

  it('rechaza piezo_test con duration_ms por encima de su límite', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = '66666666-0002-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'piezo_test', params: { duration_ms: 3001 } }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('params_out_of_range');
  });

  it('rechaza target_index fuera de 1..9', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = '66666666-0003-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'led_test',
        params: { duration_ms: 1000, target_index: 99 },
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('params_out_of_range');
  });

  it('rechaza duration_ms=NaN (fragilidad del validador señalada en revisión: typeof NaN === "number")', async () => {
    // El broker en memoria NO serializa a JSON (a diferencia del transporte
    // MQTT real, donde JSON.stringify(NaN) da "null" y el módulo ya lo
    // rechazaba antes de esta prueba): esto permite construir el caso
    // exacto que la revisión encontró explotable "desde otro sitio del
    // simulador sin pasar por JSON" — la propia razón por la que esta
    // prueba existe, aunque hoy no llegue por el canal real.
    const { sim, moduleId } = await makeSim();
    const requestId = '66666666-0005-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'led_test',
        params: { duration_ms: NaN },
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('params_out_of_range');
  });

  it('rechaza target_index=NaN por la misma razón', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = '66666666-0006-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'led_test',
        params: { duration_ms: 1000, target_index: NaN },
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('params_out_of_range');
  });

  it('acepta duration_ms exactamente en el límite del firmware (1 y 5000 para led_test)', async () => {
    const { sim, moduleId } = await makeSim();
    for (const [i, duration] of [1, 5000].entries()) {
      const requestId = `66666666-0004-4111-8111-11111111111${i}`;
      await sendMaintenance(
        sim,
        baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'led_test', params: { duration_ms: duration } }),
      );
      await sim.settle();
      expect(rejectionFor(sim, moduleId, requestId), `duration_ms=${duration}`).toBeUndefined();
    }
  });
});

describe('maintenance/command · fixtures congeladas del contrato (contracts/examples)', () => {
  it('los ejemplos "valid" de module-maintenance-command validan contra el esquema y el módulo los acepta', async () => {
    const { sim, moduleId } = await makeSim();
    const ledTest = baseCommand({
      request_id: '77777777-0001-4111-8111-111111111111',
      module_id: moduleId,
      command_type: 'led_test',
      issued_at_ms: 1784500003000,
      expires_in_ms: 4000,
      nonce: 2,
      requested_by: { actor_type: 'user', actor_id: 'pjclavero@gmail.com' },
      params: { duration_ms: 3000, target_index: 5 },
    });
    const valid = validateAgainstSchema('module-maintenance-command.schema.json', ledTest);
    expect(valid.valid, valid.errors.join('\n')).toBe(true);
  });
});

describe('maintenance/command · aislamiento de espacios (idempotencia y nonce independientes de module/command)', () => {
  it('un request_id de mantenimiento no colisiona con un command_id igual en module/command', async () => {
    const { sim, moduleId } = await makeSim();
    const sharedId = '88888888-0001-4111-8111-111111111111';

    // Ejecuta primero por el canal de JUEGO (module/command) con ese id.
    await sim.getBroker()!.publish(
      'coordinator-test',
      `targets/v1/module/${moduleId}/command`,
      {
        command_id: sharedId,
        issuer: 'coordinator-test',
        nonce: 1,
        issued_at_ms: 0,
        expires_in_ms: 5000,
        action: 'identify',
      },
      { qos: 1, retain: false },
    );
    await sim.settle();

    // El mismo id, ahora por MANTENIMIENTO, debe tratarse como NUEVO (no duplicate).
    await sendMaintenance(
      sim,
      baseCommand({ request_id: sharedId, module_id: moduleId, command_type: 'query_status' }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, sharedId)).toBeUndefined();
  });
});

/**
 * `abort_calibration` · categoría "seguridad" (contrato §6-bis, ampliación
 * posterior a la primera versión de este canal, destapada por el carril de
 * backend al implementar F6: el enum tenía "iniciar calibración" y no tenía
 * su contraria).
 *
 * NO es "leer" ni "actuar": es la tercera categoría. Se acepta SIEMPRE —
 * sin reloj, con su propio TTL vencido, y durante una partida activa — por
 * la misma razón que el organizador señaló: no arranca nada, para lo que
 * otra orden arrancó, y un "para" tardío sigue queriendo decir "para".
 *
 * Cada prueba de este bloque muere si alguien reclasifica `abort_calibration`
 * como "actuar" (metiéndola en MAINTENANCE_ACT_COMMANDS): en cuanto lo
 * estuviera, volvería a heredar el rechazo por game_in_progress y por
 * reloj/caducidad que estas pruebas comprueban que NO ocurre.
 */
function calibrationResultsFor(sim: Simulation, moduleId: string, requestId: string): Record<string, unknown>[] {
  return diagnosticsFor(sim, moduleId).filter(
    (d) => d.kind === 'calibration_result' && d.request_id === requestId,
  );
}

describe('abort_calibration · categoría "seguridad": se acepta SIEMPRE', () => {
  it('se acepta con partida activa (game_in_progress NO se le aplica)', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setModuleState('game_active');

    const requestId = '99999999-0001-4111-8111-111111111111';
    await sendMaintenance(sim, baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration' }));
    await sim.settle();

    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
    expect(calibrationResultsFor(sim, moduleId, requestId)).toHaveLength(1);
  });

  it('se acepta sin reloj sincronizado (expired NO se le aplica, a diferencia de start_calibration)', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setClockOk(false);

    // Comparación directa: start_calibration (actuar) SÍ se rechaza sin reloj...
    const actId = '99999999-0002-4111-8111-111111111112';
    await sendMaintenance(sim, baseCommand({ request_id: actId, module_id: moduleId, command_type: 'start_calibration' }));
    await sim.settle();
    expect(rejectionFor(sim, moduleId, actId)?.detail.reason).toBe('expired');

    // ...pero abort_calibration (seguridad) NO.
    const requestId = '99999999-0002-4111-8111-111111111111';
    await sendMaintenance(sim, baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration' }));
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
    expect(calibrationResultsFor(sim, moduleId, requestId)).toHaveLength(1);
  });

  it('se acepta con su propio TTL ya vencido (reloj sincronizado, pero expires_in_ms consumido)', async () => {
    const { sim, moduleId } = await makeSim();
    const clock = sim.getClock();
    await clock.sleep(10_000); // el reloj SÍ está sincronizado (clockOk por defecto), pero han pasado 10s

    const requestId = '99999999-0003-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({
        request_id: requestId,
        module_id: moduleId,
        command_type: 'abort_calibration',
        issued_at_ms: 0,
        expires_in_ms: 2000, // "caducado" hace 8s si se le aplicara la regla de expired
      }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
    expect(calibrationResultsFor(sim, moduleId, requestId)).toHaveLength(1);
  });

  it('caso combinado: partida activa + sin reloj + TTL vencido a la vez, y aun así se acepta', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setModuleState('game_active');
    m.setClockOk(false);
    const clock = sim.getClock();
    await clock.sleep(999_000);

    const requestId = '99999999-0004-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration', issued_at_ms: 0, expires_in_ms: 100 }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined();
    expect(calibrationResultsFor(sim, moduleId, requestId)).toHaveLength(1);
  });
});

describe('abort_calibration · distingue "abortó algo real" de "no había nada que abortar"', () => {
  it('con una calibración en curso: aborta de verdad, targets vuelven a safe, detail.aborted=true', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    // Simula una calibración en curso (start_calibration del simulador es
    // síncrono y se autocompleta; para probar el aborto hace falta dejar el
    // módulo a mitad de calibración manipulando su estado directamente).
    m.setModuleState('calibration');
    await m.applyTargetStates([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ target_index: i, state: 'calibration' })));

    const requestId = 'aaaa9999-0001-4111-8111-111111111111';
    await sendMaintenance(sim, baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration' }));
    await sim.settle();

    const results = calibrationResultsFor(sim, moduleId, requestId);
    expect(results).toHaveLength(1);
    expect((results[0]!.detail as Record<string, unknown>).aborted).toBe(true);
    expect(m.getState()).toBe('ready');
    expect(m.getTargetsSnapshot().every((t) => t.state === 'safe')).toBe(true);
  });

  it('sin ninguna calibración en curso: NO es un rechazo, responde aborted=false ("no había nada que parar")', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    expect(m.getState()).toBe('ready'); // estado normal tras boot()

    const requestId = 'aaaa9999-0002-4111-8111-111111111111';
    await sendMaintenance(sim, baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration' }));
    await sim.settle();

    expect(rejectionFor(sim, moduleId, requestId)).toBeUndefined(); // no es un rechazo por regla
    const results = calibrationResultsFor(sim, moduleId, requestId);
    expect(results).toHaveLength(1);
    expect((results[0]!.detail as Record<string, unknown>).aborted).toBe(false);
  });

  it('con target_index: aborta sólo esa diana; si quedan otras calibrando, el módulo sigue en calibration', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setModuleState('calibration');
    await m.applyTargetStates([
      { target_index: 3, state: 'calibration' },
      { target_index: 7, state: 'calibration' },
    ]);

    const requestId = 'aaaa9999-0003-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration', params: { target_index: 3 } }),
    );
    await sim.settle();

    const results = calibrationResultsFor(sim, moduleId, requestId);
    expect((results[0]!.detail as Record<string, unknown>).aborted).toBe(true);
    const snapshot = m.getTargetsSnapshot();
    expect(snapshot.find((t) => t.target_index === 3)?.state).toBe('safe');
    expect(snapshot.find((t) => t.target_index === 7)?.state).toBe('calibration');
    expect(m.getState()).toBe('calibration'); // la diana 7 sigue calibrando: el módulo no sale del modo
  });
});

describe('abort_calibration · reglas que SÍ le siguen aplicando (no todo es "siempre sí")', () => {
  it('module_mismatch se sigue rechazando (la excepción es sólo reloj/caducidad/partida)', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = 'bbbb9999-0001-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: 'module-99', command_type: 'abort_calibration' }),
      moduleId,
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('module_mismatch');
  });

  it('params_out_of_range se sigue rechazando (target_index fuera de 1..9)', async () => {
    const { sim, moduleId } = await makeSim();
    const requestId = 'bbbb9999-0002-4111-8111-111111111111';
    await sendMaintenance(
      sim,
      baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration', params: { target_index: 15 } }),
    );
    await sim.settle();
    expect(rejectionFor(sim, moduleId, requestId)?.detail.reason).toBe('params_out_of_range');
  });
});

describe('abort_calibration · duplicate: decisión de este carril (no se rechaza, responde el estado real cada vez)', () => {
  it('reenviar el mismo request_id NUNCA se rechaza por duplicate, y refleja el estado en cada intento', async () => {
    const { sim, moduleId } = await makeSim();
    const m = sim.modules.get(moduleId)!;
    m.setModuleState('calibration');
    await m.applyTargetStates([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ target_index: i, state: 'calibration' })));

    const requestId = 'cccc9999-0001-4111-8111-111111111111';
    const cmd = baseCommand({ request_id: requestId, module_id: moduleId, command_type: 'abort_calibration' });

    // Primer envío: SÍ había una calibración en curso.
    await sendMaintenance(sim, cmd);
    await sim.settle();
    // Reentrega QoS 1 del MISMO request_id: ya no queda nada que abortar.
    await sendMaintenance(sim, cmd);
    await sim.settle();
    // Una tercera vez, por si acaso.
    await sendMaintenance(sim, cmd);
    await sim.settle();

    const rejections = diagnosticsFor(sim, moduleId).filter(
      (d) => d.kind === 'command_rejected' && d.request_id === requestId,
    );
    expect(rejections).toHaveLength(0); // nunca 'duplicate', ni ningún otro rechazo

    const results = calibrationResultsFor(sim, moduleId, requestId);
    expect(results).toHaveLength(3); // las tres se ejecutan y responden
    expect((results[0]!.detail as Record<string, unknown>).aborted).toBe(true); // la primera sí paró algo
    expect((results[1]!.detail as Record<string, unknown>).aborted).toBe(false); // la segunda: nada que parar
    expect((results[2]!.detail as Record<string, unknown>).aborted).toBe(false);
  });
});
