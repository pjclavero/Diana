#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { RealTimeClock, VirtualClock, type Clock } from './clock.js';
import { loadScenario } from './scenarios/loader.js';
import { runScenario } from './scenarios/runner.js';
import { Simulation } from './simulation.js';
import { liveConfigFromEnv, startLiveModule, type LiveModuleConfig } from './live.js';

function usage(): string {
  return `
diana-sim — simulador de módulos y dianas Diana (WP-05)

Uso:
  diana-sim run --modules <N> [opciones]
  diana-sim run --scenario <fichero.json|yaml> [opciones]
  diana-sim live [--broker ...] [--module-id ...]   (configurable por entorno)

Modo "live" — un módulo simulado contra un Mosquitto REAL, corriendo hasta
Ctrl+C: se anuncia (presencia con LWT), publica status y telemetría de forma
periódica, genera impactos opcionales y responde a los comandos de
diagnóstico. Se configura por variables de entorno:

  DIANA_MQTT_URL          mqtt://host:puerto     (por defecto mqtt://127.0.0.1:1883)
  DIANA_MQTT_USERNAME     usuario Mosquitto      (p. ej. module-m1)
  DIANA_MQTT_PASSWORD     contraseña
  DIANA_MODULE_ID         module_id = client_id  (por defecto module-01)
  DIANA_SYSTEM_ID         (por defecto system-a)
  DIANA_MODULE_SELECTOR   SATELITE | PRINCIPAL   (por defecto SATELITE)
  DIANA_MODULE_POSITION   "x,y"                  (opcional)
  DIANA_MODULE_ROTATION   0|90|180|270           (por defecto 0)
  DIANA_FIRMWARE_VERSION  (opcional)
  DIANA_TELEMETRY_MS      periodo de telemetría, 0 desactiva (por defecto 1000)
  DIANA_STATUS_MS         periodo de status, 0 desactiva (por defecto 0)
  DIANA_HIT_EVERY_MS      periodo de impactos automáticos, 0 ninguno (por defecto 0)
  DIANA_HIT_TARGETS       índices 1..9 separados por comas (por defecto 1..9)
  DIANA_SUPPRESS_CROSSTALK true|false            (por defecto false)
  DIANA_SEED              semilla determinista   (por defecto 1)

Opciones:
  --modules <n>        Número de módulos 1..9 (matriz por defecto del dosier §6.1).
  --scenario <path>     Escenario declarativo JSON/YAML (ver simulators/scenarios/).
  --broker <url>        mqtt://host:puerto de un Mosquitto real. Si se omite, se usa
                         un broker en memoria (sin red) y el proceso termina al acabar.
  --username <user>      Credenciales MQTT (sólo con --broker).
  --password <pass>
  --system-id <id>       Por defecto "system-a".
  --principal <moduleId> Módulo forzado a PRINCIPAL. Por defecto module-01.
  --seed <n>              Semilla determinista. Por defecto 1.
  --speed <n>             Multiplicador de velocidad del reloj real (--broker). Por defecto 1.
  --autoplayer            Arranca el autojugador (requiere --principal implícito).
  --reaction-ms <min,max> Rango de tiempo de reacción del autojugador. Por defecto 150,600.
  --error-rate <0..1>     Probabilidad de fallo deliberado del autojugador. Por defecto 0.
  --keep-alive            No cerrar el proceso al terminar el escenario (útil con --broker).
  -h, --help              Esta ayuda.

Ejemplos:
  # Arranca 9 módulos contra un broker en memoria y valida el registro:
  diana-sim run --modules 9

  # Corre un escenario declarativo contra Mosquitto real en la VM:
  diana-sim run --scenario simulators/scenarios/02-partida-aleatoria-completa.json \\
    --broker mqtt://192.168.1.209:1883 --username module-01 --password *** --speed 1
`;
}

async function runLive(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      broker: { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string' },
      'module-id': { type: 'string' },
      'system-id': { type: 'string' },
      'hit-every-ms': { type: 'string' },
      'telemetry-ms': { type: 'string' },
    },
    allowPositionals: true,
  });

  const overrides: Partial<LiveModuleConfig> = {};
  if (values.broker) overrides.url = values.broker as string;
  if (values.username) overrides.username = values.username as string;
  if (values.password) overrides.password = values.password as string;
  if (values['module-id']) overrides.moduleId = values['module-id'] as string;
  if (values['system-id']) overrides.systemId = values['system-id'] as string;
  if (values['hit-every-ms']) overrides.hitEveryMs = Number(values['hit-every-ms']);
  if (values['telemetry-ms']) overrides.telemetryMs = Number(values['telemetry-ms']);

  const cfg = liveConfigFromEnv(overrides);
  console.error(
    `[diana-sim] live · módulo ${cfg.moduleId} (client_id=${cfg.moduleId}) → ${cfg.url}` +
      ` · telemetría cada ${cfg.telemetryMs} ms · impactos cada ${cfg.hitEveryMs || 0} ms`,
  );
  const handle = await startLiveModule(cfg);
  console.error('[diana-sim] live · módulo anunciado y en "ready". Ctrl+C para terminar.');

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.error(`[diana-sim] live · ${signal}: desconexión ordenada (presencia offline).`);
    await handle.stop().catch((e: unknown) => console.error('[diana-sim] live · error al parar:', e));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await new Promise(() => void 0); // vive hasta la señal
}

async function main(): Promise<void> {
  if (process.argv[2] === 'live') {
    await runLive();
    return;
  }

  const { values } = parseArgs({
    args: process.argv.slice(3), // salta "node diana-sim run"
    options: {
      modules: { type: 'string' },
      scenario: { type: 'string' },
      broker: { type: 'string' },
      username: { type: 'string' },
      password: { type: 'string' },
      'system-id': { type: 'string', default: 'system-a' },
      principal: { type: 'string' },
      seed: { type: 'string', default: '1' },
      speed: { type: 'string', default: '1' },
      autoplayer: { type: 'boolean', default: false },
      'reaction-ms': { type: 'string', default: '150,600' },
      'error-rate': { type: 'string', default: '0' },
      'keep-alive': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  const command = process.argv[2];
  if (values.help || command !== 'run') {
    console.log(usage());
    process.exit(command === 'run' ? 0 : 1);
  }

  const seed = Number(values.seed);
  const clock: Clock = values.broker ? new RealTimeClock(Number(values.speed)) : new VirtualClock();

  if (values.scenario) {
    const scenario = loadScenario(values.scenario);
    if (!Number.isNaN(seed) && values.seed !== '1') scenario.seed = seed;
    console.error(`[diana-sim] escenario "${scenario.name}" · seed=${scenario.seed}`);
    if (values.broker) {
      // Los escenarios están pensados para el reloj VIRTUAL: un paso `settle`
      // de N "ticks" no espera N ms reales, sino que cede el bucle de eventos
      // N veces. Contra un broker real el escenario termina en un par de
      // segundos y, sin --keep-alive, el proceso sale antes de que la partida
      // avance. Para ejercer el sistema desplegado use `diana-sim live`.
      console.error(
        '[diana-sim] AVISO: los escenarios usan tiempo virtual. Contra un broker real terminan\n' +
          '            en segundos aunque simulen minutos. Para un módulo que se quede vivo,\n' +
          '            use "diana-sim live" (o añada --keep-alive).',
      );
    }
    const sim = await runScenario(scenario, {
      clock,
      mqtt: values.broker
        ? { url: values.broker, username: values.username, password: values.password }
        : undefined,
    });
    void sim;
    console.error('[diana-sim] escenario completado.');
    if (!values['keep-alive']) process.exit(0);
    return;
  }

  const moduleCount = Math.min(9, Math.max(1, Number(values.modules ?? '1')));
  const systemId = values['system-id'] as string;
  const sim = new Simulation({
    systemId,
    seed,
    clock,
    mqtt: values.broker
      ? {
          url: values.broker,
          username: values.username,
          password: values.password,
        }
      : undefined,
  });

  sim.addDefaultModules(moduleCount);
  await sim.bootAll();
  console.error(`[diana-sim] ${moduleCount} módulo(s) arrancado(s) y en 'ready'.`);

  const principal = (values.principal as string) ?? 'module-01';
  sim.setPrincipal(principal);
  console.error(`[diana-sim] principal: ${principal}`);

  if (values.autoplayer) {
    const [minS, maxS] = (values['reaction-ms'] as string).split(',').map(Number);
    sim.startAutoplayer({
      reactionMs: [minS ?? 150, maxS ?? 600],
      errorRate: Number(values['error-rate']),
    });
    console.error('[diana-sim] autojugador activo.');
  }

  if (!values.broker) {
    await sim.settle(50);
    console.error('[diana-sim] sin --broker: fin de la simulación en memoria.');
    if (!values['keep-alive']) process.exit(0);
  } else {
    console.error('[diana-sim] conectado a broker real. Ctrl+C para terminar.');
    await new Promise(() => void 0); // mantiene el proceso vivo
  }
}

main().catch((err) => {
  console.error('[diana-sim] error:', err);
  process.exit(1);
});
