import { DeterministicRng } from '../rng';
import {
  Activation,
  GameModeStrategy,
  HitDecision,
  HitInput,
  RoundConfig,
  RoundPlan,
  RoundRuntimeState,
  TargetRef,
  sameTarget,
  targetKey,
} from '../types';

/**
 * Modo `duelo` (G-E, §6.4). Dos o más jugadores compiten con el **mismo número de
 * módulos** y se les presenta la **misma secuencia de dianas a la vez** (misma
 * semilla ⇒ mismo orden de posiciones en cada set de módulos). Gana quien logra
 * **más aciertos en el menor tiempo** — la comparación entre jugadores la resuelve
 * `rankDuelo` (game/duelo.ts); ESTA estrategia sólo puntúa a un jugador.
 *
 * Mecánica de carrera: se enciende una diana cada vez y hay que impactarla (orden
 * estricto por defecto). El motor ya es por-competidor, así que el duelo = correr el
 * mismo plan (misma semilla) por cada jugador sobre SUS módulos y comparar resúmenes.
 */
export class DueloModeStrategy implements GameModeStrategy {
  readonly key = 'duelo';
  readonly displayName = 'Duelo';
  readonly description =
    'Dos o más jugadores con los mismos módulos reciben la misma secuencia de dianas a la vez. Gana quien más acierta en el menor tiempo.';

  plan(config: RoundConfig, rng: DeterministicRng): RoundPlan {
    if (config.targets.length === 0) {
      throw new Error('El modo duelo exige al menos una diana participante');
    }
    // Orden compartido determinista: con la misma semilla, cada jugador recibe el
    // mismo patrón de posiciones sobre su propio set de módulos.
    const order: TargetRef[] =
      config.sequence && config.sequence.length > 0 ? [...config.sequence] : rng.shuffle(config.targets);

    const intervalMs = config.intervalMs ?? 0;
    const activations: Activation[] = order.map((target, step) => ({
      step,
      targets: [target],
      activateAtMs: step * intervalMs,
    }));

    return {
      mode: this.key,
      seed: config.seed,
      // Carrera sobre la diana activa: por defecto orden estricto.
      strictOrder: config.strictOrder ?? true,
      penaltyMs: config.penaltyMs ?? 0,
      countdownMs: config.countdownMs ?? 3000,
      timeLimitMs: config.timeLimitMs ?? null,
      activations,
      expectedHits: activations.length,
    };
  }

  resolveHit(state: RoundRuntimeState, hit: HitInput): HitDecision {
    const active = state.plan.activations[state.step];
    if (!active) {
      return {
        classification: 'during_pause',
        countsForScore: false,
        penaltyMs: 0,
        advance: false,
        reason: 'El duelo ya está completo',
      };
    }

    if (active.targets.some((t) => sameTarget(t, hit.target))) {
      return { classification: 'valid_hit', countsForScore: true, penaltyMs: 0, advance: true, reason: null };
    }

    if (state.hitTargets.has(targetKey(hit.target))) {
      return {
        classification: 'hit_on_already_hit',
        countsForScore: false,
        penaltyMs: state.plan.penaltyMs,
        advance: false,
        reason: 'Diana ya alcanzada en este duelo',
      };
    }

    // Orden estricto (carrera): golpear otra diana no avanza y penaliza.
    if (state.plan.strictOrder) {
      return {
        classification: 'out_of_order',
        countsForScore: false,
        penaltyMs: state.plan.penaltyMs,
        advance: false,
        reason: `Se esperaba ${targetKey(active.targets[0])} y se golpeó ${targetKey(hit.target)}`,
      };
    }

    const pending = state.plan.activations
      .slice(state.step)
      .some((a) => a.targets.some((t) => sameTarget(t, hit.target)));
    if (pending) {
      return { classification: 'valid_hit', countsForScore: true, penaltyMs: 0, advance: true, reason: 'Diana pendiente aceptada' };
    }

    return {
      classification: 'hit_on_safe',
      countsForScore: false,
      penaltyMs: state.plan.penaltyMs,
      advance: false,
      reason: 'Impacto sobre una diana ajena a la secuencia',
    };
  }

  isComplete(state: RoundRuntimeState): boolean {
    return state.validHits >= state.plan.expectedHits;
  }

  shouldSkipActivation(state: RoundRuntimeState, activation: Activation): boolean {
    return activation.targets.every((t) => state.hitTargets.has(targetKey(t)));
  }
}
