#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { RealTimeClock, VirtualClock, type Clock } from './clock.js';
import { loadScenario } from './scenarios/loader.js';
import { runScenario } from './scenarios/runner.js';
import { Simulation } from './simulation.js';

function usage(): string {
  return `
diana-sim — simulador de módulos y dianas Diana (WP-05)

Uso:
  diana-sim run --modules <N> [opciones]
  diana-sim run --scenario <fichero.json|yaml> [opciones]

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

async function main(): Promise<void> {
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
