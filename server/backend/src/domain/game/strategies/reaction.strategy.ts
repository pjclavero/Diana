import { DeterministicRng } from '../rng';
import {
  Activation,
  GameModeStrategy,
  HitDecision,
  HitInput,
  RoundConfig,
  RoundPlan,
  RoundRuntimeState,
  sameTarget,
} from '../types';

/**
 * Modo `reaction` (dosier 16.4): una diana se activa tras un retardo
 * ALEATORIO (determinista por semilla). Se mide el tiempo desde la activación
 * hasta el impacto. Los disparos anticipados penalizan y no puntúan.
 */
export class ReactionModeStrategy implements GameModeStrategy {
  readonly key = 'reaction';
  readonly displayName = 'Reacción';
  readonly description =
    'La diana se activa tras un retardo aleatorio reproducible. El disparo anticipado penaliza.';

  plan(config: RoundConfig, rng: DeterministicRng): RoundPlan {
    if (config.targets.length === 0) {
      throw new Error('El modo reaction exige al menos una diana participante');
    }
    const [minDelay, maxDelay] = config.reactionDelayMs ?? [1000, 4000];
    if (minDelay < 0 || maxDelay < minDelay) {
      throw new Error(`Rango de retardo inválido: [${minDelay}, ${maxDelay}]`);
    }
    const repetitions = config.repetitions ?? 1;
    if (repetitions <= 0) throw new Error('`repetitions` debe ser mayor que cero');

    const activations: Activation[] = [];
    let cursorMs = 0;
    for (let step = 0; step < repetitions; step += 1) {
      const delay = rng.nextInt(minDelay, maxDelay);
      const target = rng.pick(config.targets);
      cursorMs += delay;
      activations.push({ step, targets: [target], activateAtMs: cursorMs });
      cursorMs += config.intervalMs ?? 0;
    }

    return {
      mode: this.key,
      seed: config.seed,
      strictOrder: false,
      penaltyMs: config.penaltyMs ?? 0,
      countdownMs: config.countdownMs ?? 3000,
      timeLimitMs: config.timeLimitMs ?? null,
      activations,
      expectedHits: repetitions,
    };
  }

  resolveHit(state: RoundRuntimeState, hit: HitInput): HitDecision {
    const active = state.plan.activations[state.step];
    if (!active) {
      return {
        classification: 'during_pause',
        countsForScore: false,
        penaltyMs: state.plan.penaltyMs,
        advance: false,
        reason: 'No hay activaciones pendientes',
      };
    }

    const activateAtUs = active.activateAtMs * 1000;
    if (hit.elapsedUs < activateAtUs) {
      return {
        classification: 'early_shot',
        countsForScore: false,
        penaltyMs: state.plan.penaltyMs,
        advance: false,
        reason: `Disparo anticipado: ${activateAtUs - hit.elapsedUs} µs antes de la activación`,
      };
    }

    if (active.targets.some((t) => sameTarget(t, hit.target))) {
      return { classification: 'valid_hit', countsForScore: true, penaltyMs: 0, advance: true, reason: null };
    }

    return {
      classification: 'hit_on_safe',
      countsForScore: false,
      penaltyMs: state.plan.penaltyMs,
      advance: false,
      reason: 'Impacto sobre una diana no activa',
    };
  }

  isComplete(state: RoundRuntimeState): boolean {
    return state.validHits >= state.plan.expectedHits;
  }

  /**
   * Tiempo de reacción del paso indicado: T2 del impacto menos el instante de
   * activación del plan. Sólo lo calcula el motor a partir de datos del
   * coordinador; el backend no fabrica tiempos.
   */
  static reactionTimeUs(plan: RoundPlan, step: number, hitElapsedUs: number): number | null {
    const activation = plan.activations[step];
    if (!activation) return null;
    const delta = hitElapsedUs - activation.activateAtMs * 1000;
    return delta < 0 ? null : delta;
  }
}
