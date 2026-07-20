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
 * Modo `random` (dosier 16.1): se activa una diana al azar; el jugador debe
 * golpearla; al acertar se activa otra. Se mide reacción y tiempo total.
 * Un impacto sobre una diana no activa penaliza.
 */
export class RandomModeStrategy implements GameModeStrategy {
  readonly key = 'random';
  readonly displayName = 'Dianas aleatorias';
  readonly description =
    'Una diana activa cada vez, elegida al azar con la semilla de la ronda. El impacto sobre una diana no activa penaliza.';

  plan(config: RoundConfig, rng: DeterministicRng): RoundPlan {
    if (config.targets.length === 0) {
      throw new Error('El modo random exige al menos una diana participante');
    }
    const repetitions = config.repetitions ?? config.targets.length;
    if (repetitions <= 0) throw new Error('`repetitions` debe ser mayor que cero');
    const intervalMs = config.intervalMs ?? 0;

    const activations: Activation[] = [];
    let previous: TargetRef | null = null;
    for (let step = 0; step < repetitions; step += 1) {
      let candidates = config.targets;
      if (previous && config.targets.length > 1) {
        candidates = config.targets.filter((t) => !sameTarget(t, previous as TargetRef));
      }
      const chosen = rng.pick(candidates);
      previous = chosen;
      activations.push({ step, targets: [chosen], activateAtMs: step * intervalMs });
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
        reason: 'La ronda ya no tiene activaciones pendientes',
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
        reason: 'Diana ya alcanzada en esta ronda',
      };
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
}
