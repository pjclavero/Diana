/**
 * Verificación del canal `module/{id}/maintenance/command` contra un
 * Mosquitto REAL (no el broker en memoria). Precedente documentado en
 * docs/testing/simulador-contra-mqtt-real.md: contra el broker en memoria,
 * el filtro de suscripción SÍ se aplica, así que un defecto de
 * encaminamiento (o de reloj real) puede pasar 100% de los tests unitarios
 * y no existir nunca en producción.
 *
 * Este script NO usa vitest: corre un módulo simulado y un cliente MQTT
 * independiente ("backend-test") contra un Mosquitto real, con RealTimeClock
 * (tiempo real, no tiempo virtual — las pruebas de caducidad de vitest usan
 * VirtualClock, que no demuestra nada sobre temporizadores reales).
 *
 * Uso: tsx scripts/verify-maintenance-real-broker.ts [url-mqtt]
 * Por defecto: mqtt://127.0.0.1:18830 (broker levantado fuera del repo, ver
 * docs/testing/simulador-contra-mqtt-real.md para el procedimiento sin sudo).
 */
import mqtt from 'mqtt';
import { RealTimeClock } from '../src/clock.js';
import { Simulation } from '../src/simulation.js';

const URL = process.argv[2] ?? 'mqtt://127.0.0.1:18830';

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION', err);
});

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed += 1;
    console.log(`  OK  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}`);
    if (detail !== undefined) console.error('      ', JSON.stringify(detail));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log(`Conectando a Mosquitto real en ${URL} ...`);

  const sim = new Simulation({
    systemId: 'system-real',
    seed: 42,
    clock: new RealTimeClock(),
    mqtt: { url: URL },
  });
  const [m] = sim.addDefaultModules(1);
  const moduleId = m!.moduleId;
  await sim.bootAll();
  await sleep(300); // deja asentar CONNACK + SUBACK reales antes de publicar

  const backend = mqtt.connect(URL, { clientId: 'backend-test', clean: true });
  await new Promise<void>((resolve, reject) => {
    backend.on('connect', () => resolve());
    backend.on('error', reject);
  });

  const diagTopic = `targets/v1/module/${moduleId}/diagnostic`;
  const telemetryTopic = `targets/v1/module/${moduleId}/telemetry`;
  const cmdTopic = `targets/v1/module/${moduleId}/maintenance/command`;

  const received: { topic: string; payload: Record<string, unknown> }[] = [];
  await new Promise<void>((resolve, reject) => {
    backend.subscribe([diagTopic, telemetryTopic], (err) => (err ? reject(err) : resolve()));
  });
  backend.on('message', (topic, buf) => {
    received.push({ topic, payload: JSON.parse(buf.toString('utf-8')) as Record<string, unknown> });
  });

  function findRejection(requestId: string): Record<string, unknown> | undefined {
    return received.find(
      (r) =>
        r.topic === diagTopic &&
        r.payload.kind === 'command_rejected' &&
        r.payload.request_id === requestId,
    )?.payload;
  }

  function findAccepted(requestId: string): Record<string, unknown> | undefined {
    return received.find((r) => r.topic === diagTopic && r.payload.request_id === requestId && r.payload.kind !== 'command_rejected')?.payload;
  }

  function publish(payload: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      backend.publish(cmdTopic, JSON.stringify(payload), { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });
  }

  function base(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      schema_version: 1,
      request_id: '00000000-0000-4000-8000-000000000000',
      module_id: moduleId,
      issued_at_ms: Date.now(),
      expires_in_ms: 5000,
      nonce: 1,
      requested_by: { actor_type: 'operator', actor_id: 'operator-cli' },
      ...overrides,
    };
  }

  // -------------------------------------------------------------- 1. aceptación observable (led_test)
  {
    const requestId = 'facade01-0000-4000-8000-000000000001';
    await publish(base({ request_id: requestId, command_type: 'led_test', params: { duration_ms: 1000 } }));
    await sleep(500);
    const acc = findAccepted(requestId);
    check('led_test real: respuesta de aceptación recibida', Boolean(acc), acc);
    check('led_test real: kind=self_test_result, component=led', acc?.kind === 'self_test_result' && (acc?.detail as Record<string, unknown> | undefined)?.component === 'led');
  }

  // -------------------------------------------------------------- 2. module_mismatch
  {
    const requestId = 'facade02-0000-4000-8000-000000000002';
    await publish(base({ request_id: requestId, module_id: 'module-does-not-exist', command_type: 'query_status' }));
    await sleep(400);
    const rej = findRejection(requestId);
    check('module_mismatch real: rechazado con ese motivo', rej?.['detail'] !== undefined && (rej!['detail'] as Record<string, unknown>).reason === 'module_mismatch', rej);
  }

  // -------------------------------------------------------------- 3. unknown_command
  {
    const requestId = 'facade03-0000-4000-8000-000000000003';
    await publish(base({ request_id: requestId, command_type: 'flash_ota' }));
    await sleep(400);
    const rej = findRejection(requestId);
    check('unknown_command real: rechazado', (rej?.['detail'] as Record<string, unknown> | undefined)?.reason === 'unknown_command', rej);
  }

  // -------------------------------------------------------------- 4. duplicate (reentrega QoS1 real)
  {
    const requestId = 'facade04-0000-4000-8000-000000000004';
    const cmd = base({ request_id: requestId, command_type: 'self_test' });
    await publish(cmd);
    await sleep(400);
    await publish(cmd);
    await sleep(400);
    const rej = findRejection(requestId);
    const accepts = received.filter((r) => r.topic === diagTopic && r.payload.request_id === requestId && r.payload.kind === 'self_test_result');
    check('duplicate real: segunda entrega rechazada', (rej?.['detail'] as Record<string, unknown> | undefined)?.reason === 'duplicate', rej);
    check('duplicate real: sólo UNA ejecución real (no dos self_test_result)', accepts.length === 1, accepts.length);
  }

  // -------------------------------------------------------------- 5. game_in_progress
  {
    m!.setModuleState('game_active');
    const actId = 'facade05-0000-4000-8000-000000000005';
    await publish(base({ request_id: actId, command_type: 'piezo_test', params: { duration_ms: 500 } }));
    await sleep(400);
    const rejAct = findRejection(actId);
    check('game_in_progress real: piezo_test (actuar) rechazado', (rejAct?.['detail'] as Record<string, unknown> | undefined)?.reason === 'game_in_progress', rejAct);

    const readId = 'facade06-0000-4000-8000-000000000006';
    await publish(base({ request_id: readId, command_type: 'request_telemetry' }));
    await sleep(400);
    const rejRead = findRejection(readId);
    check('game_in_progress real: request_telemetry (leer) NO rechazado', rejRead === undefined, rejRead);
    m!.setModuleState('ready');
  }

  // -------------------------------------------------------------- 6. expired (RELOJ REAL: espera de verdad, no VirtualClock)
  //
  // OJO: RealTimeClock.nowUs() es tiempo de PROCESO desde su construcción
  // (process.hrtime), NO epoch — por diseño (clock.ts: "microsegundos
  // monotónicos desde el arranque de la simulación"), igual que en el canal
  // module/command ya existente. issued_at_ms debe vivir en ese MISMO marco
  // temporal (no en Date.now() real), o la resta nowMs - issuedAtMs compara
  // dos relojes distintos y el resultado no significa nada. Se fija en 0
  // (instante de arranque de la simulación) y se deja transcurrir tiempo de
  // pared real de sobra (ya van varios segundos de casos anteriores) para
  // que el TTL corto caduque de verdad, sin tiempo virtual.
  {
    const requestId = 'facade07-0000-4000-8000-000000000007';
    await publish(
      base({
        request_id: requestId,
        command_type: 'query_status',
        issued_at_ms: 0,
        expires_in_ms: 1000, // TTL de 1s: los casos anteriores ya han consumido varios segundos reales
      }),
    );
    await sleep(400);
    const rej = findRejection(requestId);
    check('expired real: caducado por reloj de pared real', (rej?.['detail'] as Record<string, unknown> | undefined)?.reason === 'expired', rej);
  }

  // -------------------------------------------------------------- 7. sin reloj sincronizado (clock_ok=false)
  {
    m!.setClockOk(false);
    const actId = 'facade08-0000-4000-8000-000000000008';
    await publish(base({ request_id: actId, command_type: 'led_test', params: { duration_ms: 500 } }));
    await sleep(400);
    const rejAct = findRejection(actId);
    check('sin reloj real: led_test (actuar) rechazado con expired', (rejAct?.['detail'] as Record<string, unknown> | undefined)?.reason === 'expired', rejAct);

    const readId = 'facade09-0000-4000-8000-000000000009';
    await publish(base({ request_id: readId, command_type: 'query_status' }));
    await sleep(400);
    const rejRead = findRejection(readId);
    check('sin reloj real: query_status (leer) SÍ aceptado', rejRead === undefined, rejRead);
    m!.setClockOk(true);
  }

  // -------------------------------------------------------------- 8. params_out_of_range
  {
    const requestId = 'facade10-0000-4000-8000-000000000010';
    await publish(base({ request_id: requestId, command_type: 'led_test', params: { duration_ms: 45000 } }));
    await sleep(400);
    const rej = findRejection(requestId);
    check('params_out_of_range real: duration_ms 45000 rechazado', (rej?.['detail'] as Record<string, unknown> | undefined)?.reason === 'params_out_of_range', rej);
  }

  // -------------------------------------------------------------- 8-bis. abort_calibration: categoría "seguridad" (se acepta SIEMPRE)
  {
    // (a) durante partida activa: NO se le aplica game_in_progress (a
    // diferencia de start_calibration, que sí la rechazaría).
    m!.setModuleState('game_active');
    const idDuringGame = 'facade12-0000-4000-8000-000000000012';
    await publish(base({ request_id: idDuringGame, command_type: 'abort_calibration' }));
    await sleep(400);
    check(
      'abort_calibration real: se acepta con partida activa (NO game_in_progress)',
      findRejection(idDuringGame) === undefined,
      findRejection(idDuringGame),
    );
    m!.setModuleState('ready');

    // (b) sin reloj sincronizado: NO se le aplica 'expired', a diferencia de
    // start_calibration (comprobado aparte para que quede el contraste).
    m!.setClockOk(false);
    const actDuringNoClock = 'facade13-0000-4000-8000-000000000013';
    await publish(base({ request_id: actDuringNoClock, command_type: 'start_calibration' }));
    await sleep(400);
    check(
      'start_calibration real sin reloj: SÍ se rechaza (contraste con abort)',
      (findRejection(actDuringNoClock)?.['detail'] as Record<string, unknown> | undefined)?.reason === 'expired',
      findRejection(actDuringNoClock),
    );
    const idNoClock = 'facade14-0000-4000-8000-000000000014';
    await publish(base({ request_id: idNoClock, command_type: 'abort_calibration' }));
    await sleep(400);
    check(
      'abort_calibration real: se acepta sin reloj sincronizado (NO expired)',
      findRejection(idNoClock) === undefined,
      findRejection(idNoClock),
    );
    m!.setClockOk(true);

    // (c) TTL propio ya vencido (reloj sincronizado, tiempo real de pared).
    const idExpiredTtl = 'facade15-0000-4000-8000-000000000015';
    await publish(
      base({
        request_id: idExpiredTtl,
        command_type: 'abort_calibration',
        issued_at_ms: Date.now() - 60_000, // hace 60s de reloj real
        expires_in_ms: 100, // TTL de 100ms: larguísimo tiempo caducado
      }),
    );
    await sleep(400);
    check(
      'abort_calibration real: se acepta con TTL propio vencido (reloj de pared real)',
      findRejection(idExpiredTtl) === undefined,
      findRejection(idExpiredTtl),
    );

    // (d) distingue "abortó de verdad" de "no había nada que abortar".
    m!.setModuleState('calibration');
    await m!.applyTargetStates(
      Array.from({ length: 9 }, (_, i) => ({ target_index: i + 1, state: 'calibration' as const })),
    );
    const idRealAbort = 'facade16-0000-4000-8000-000000000016';
    await publish(base({ request_id: idRealAbort, command_type: 'abort_calibration' }));
    await sleep(400);
    const realAbort = findAccepted(idRealAbort);
    check(
      'abort_calibration real: con calibración en curso, detail.aborted=true',
      realAbort?.kind === 'calibration_result' && (realAbort?.detail as Record<string, unknown> | undefined)?.aborted === true,
      realAbort,
    );

    const idNoopAbort = 'facade17-0000-4000-8000-000000000017';
    await publish(base({ request_id: idNoopAbort, command_type: 'abort_calibration' }));
    await sleep(400);
    const noopAbort = findAccepted(idNoopAbort);
    check(
      'abort_calibration real: sin calibración en curso, detail.aborted=false (no es un rechazo)',
      noopAbort?.kind === 'calibration_result' && (noopAbort?.detail as Record<string, unknown> | undefined)?.aborted === false,
      noopAbort,
    );

    // (e) reenvío del mismo request_id: NUNCA 'duplicate' (decisión de este carril).
    const idRetry = 'facade18-0000-4000-8000-000000000018';
    const retryCmd = base({ request_id: idRetry, command_type: 'abort_calibration' });
    await publish(retryCmd);
    await sleep(400);
    await publish(retryCmd);
    await sleep(400);
    check('abort_calibration real: reenvío del mismo request_id NUNCA se rechaza por duplicate', findRejection(idRetry) === undefined, findRejection(idRetry));
  }

  // -------------------------------------------------------------- 9. filtrado de suscripción real (precedente docs/testing)
  {
    // Publica en el tópico de mantenimiento de OTRO módulo inexistente: no
    // debe llegar nada al módulo real (si el filtro de suscripción real
    // fallara como en el defecto documentado, este módulo respondería a
    // mensajes que no son suyos).
    const requestId = 'facade11-0000-4000-8000-000000000011';
    await new Promise<void>((resolve, reject) => {
      backend.publish(
        'targets/v1/module/module-99/maintenance/command',
        JSON.stringify(base({ request_id: requestId, module_id: 'module-99', command_type: 'query_status' })),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    await sleep(400);
    const anyResponse = received.some((r) => r.payload.request_id === requestId);
    check('filtrado real: módulo NO reacciona a maintenance/command de otro module_id', !anyResponse, anyResponse);
  }

  await m!.shutdown();
  backend.end(true);

  console.log(`\n${passed} OK, ${failed} FAIL`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
