import type { Clock } from '../clock.js';
import { seededUuid } from '../ids.js';
import { Rng } from '../rng.js';
import { Simulation, type SimulationOptions } from '../simulation.js';
import type { Scenario, ScenarioStep } from './schema.js';

export interface RunScenarioOptions {
  clock: Clock;
  /** Si se define, el escenario corre contra un Mosquitto real en vez del broker en memoria. */
  mqtt?: SimulationOptions['mqtt'];
}

/** Ejecuta un escenario declarativo contra una Simulation nueva y la devuelve para inspección/aserciones. */
export async function runScenario(scenario: Scenario, opts: RunScenarioOptions): Promise<Simulation> {
  const sim = new Simulation({
    systemId: scenario.systemId,
    seed: scenario.seed,
    clock: opts.clock,
    mqtt: opts.mqtt,
  });
  // Semilla propia (derivada, pero independiente de la de los módulos) para
  // los identificadores sintéticos que el propio runner genera (p.ej.
  // command_id de los pasos "system_command"): determinista igual que todo
  // lo demás en el simulador.
  const runnerRng = new Rng(scenario.seed).fork('scenario-runner');
  // Contador simple, no basado en el reloj: dos pasos "system_command"
  // seguidos con el reloj virtual sin avanzar (habitual en tests) no deben
  // colisionar en el mismo nonce, o el segundo se rechazaría por
  // "nonce <= último aceptado" (protección de reproducción, H-05).
  const counters = { syscmdNonce: 1 };

  if (scenario.modules && scenario.modules.length > 0) {
    for (const m of scenario.modules) {
      sim.addModule(m);
    }
  } else {
    sim.addDefaultModules(scenario.moduleCount ?? 1);
  }

  if (scenario.principal) {
    // setPrincipal() se aplica tras boot_all normalmente, pero crear el
    // Coordinator no requiere que el módulo ya esté arrancado.
  }

  for (const step of scenario.steps) {
    await runStep(sim, step, scenario, runnerRng, counters);
  }

  return sim;
}

async function runStep(
  sim: Simulation,
  step: ScenarioStep,
  scenario: Scenario,
  runnerRng: Rng,
  counters: { syscmdNonce: number },
): Promise<void> {
  switch (step.type) {
    case 'boot_all':
      await sim.bootAll();
      if (scenario.principal) {
        sim.setPrincipal(scenario.principal);
      }
      break;
    case 'wait_ms':
      await sim.getClock().sleep(step.ms);
      break;
    case 'set_selector': {
      const m = requireModule(sim, step.moduleId);
      m.setSelector(step.selector);
      break;
    }
    case 'set_principal':
      sim.setPrincipal(step.moduleId);
      break;
    case 'system_command': {
      const commandId = seededUuid(runnerRng.fork(`syscmd-${step.action}-${sim.getClock().nowUs()}`));
      const payload: Record<string, unknown> = {
        schema_version: 1,
        command_id: commandId,
        issued_at_ms: Math.floor(sim.getClock().nowUs() / 1000),
        expires_in_ms: 5000,
        nonce: counters.syscmdNonce++,
        issuer: 'backend',
        system_id: scenario.systemId,
        action: step.action,
      };
      if (step.game) {
        payload.game = {
          game_id: step.game.gameId,
          round_id: step.game.roundId,
          mode: step.game.mode,
          targets: step.game.targets,
          sequence: step.game.sequence ?? null,
          penalty_ms: step.game.penaltyMs ?? 0,
          strict_order: step.game.strictOrder ?? false,
          reaction_delay_ms: step.game.reactionDelayMs ?? null,
          seed: step.game.seed,
        };
      }
      await sim.broadcastSystemCommand(payload);
      break;
    }
    case 'start_autoplayer':
      sim.startAutoplayer({ reactionMs: step.reactionMs, errorRate: step.errorRate });
      break;
    case 'arm_and_start':
      await sim.armAndStart({
        gameId: step.game.gameId,
        roundId: step.game.roundId,
        mode: step.game.mode,
        targets: step.game.targets,
        sequence: step.game.sequence ?? null,
        penaltyMs: step.game.penaltyMs ?? 0,
        strictOrder: step.game.strictOrder ?? false,
        reactionDelayMs: step.game.reactionDelayMs ?? null,
        seed: step.game.seed,
      });
      break;
    case 'pause_game':
      await requireCoordinator(sim).pauseGame();
      break;
    case 'resume_game':
      await requireCoordinator(sim).resumeGame();
      break;
    case 'abort_game':
      await requireCoordinator(sim).abortGame();
      break;
    case 'hit': {
      const m = requireModule(sim, step.moduleId);
      await m.hitTarget(step.targetIndex, {
        amplitudeOverride: step.amplitude,
        suppressCrosstalk: step.suppressCrosstalk,
      });
      break;
    }
    case 'duplicate_last_hit': {
      const m = requireModule(sim, step.moduleId);
      const payload = m.getLastHitPayload();
      if (!payload) throw new Error(`duplicate_last_hit: ${step.moduleId} no tiene hit previo`);
      await m.publishDuplicate(payload.event_id, payload);
      break;
    }
    case 'kill_connection': {
      const m = requireModule(sim, step.moduleId);
      await m.killConnection();
      break;
    }
    case 'reconnect': {
      const m = requireModule(sim, step.moduleId);
      await m.reconnect();
      break;
    }
    case 'shutdown': {
      const m = requireModule(sim, step.moduleId);
      await m.shutdown();
      break;
    }
    case 'reboot': {
      const m = requireModule(sim, step.moduleId);
      await m.reboot();
      break;
    }
    case 'low_voltage': {
      const m = requireModule(sim, step.moduleId);
      await m.lowVoltage(step.voltage5vMv);
      break;
    }
    case 'telemetry': {
      const m = requireModule(sim, step.moduleId);
      await m.publishTelemetry();
      break;
    }
    case 'settle':
      await sim.settle(step.ticks ?? 8);
      break;
    default: {
      const exhaustive: never = step;
      throw new Error(`paso de escenario desconocido: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function requireModule(sim: Simulation, moduleId: string) {
  const m = sim.modules.get(moduleId);
  if (!m) throw new Error(`escenario: módulo desconocido ${moduleId}`);
  return m;
}

function requireCoordinator(sim: Simulation) {
  if (!sim.coordinator) throw new Error('escenario: no hay coordinador (falta "principal" o boot_all)');
  return sim.coordinator;
}
