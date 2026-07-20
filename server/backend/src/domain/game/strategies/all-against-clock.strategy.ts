import { DeterministicRng } from '../rng';
import {
  GameModeStrategy,
  HitDecision,
  HitInput,
  RoundConfig,
  RoundPlan,
  RoundRuntimeState,
  sameTarget,
  targetKey,
} from '../types';

/**
 * Modo `all_against_clock` (dosier 16.3): todas las dianas seleccionadas se
 * activan a la vez; cada impacto correcto la desactiva; la ronda termina
 * cuando todas han sido alcanzadas.
 */
export class AllAgainstClockModeStrategy implements GameModeStrategy {
  readonly key = 'all_against_clock';
  readonly displayName = 'Todas contra reloj';
  readonly description =
    'Todas las dianas se activan simultáneamente. La ronda termina cuando todas han sido alcanzadas.';

  plan(config: RoundConfig, _rng: DeterministicRng): RoundPlan {
    if (config.targets.length === 0) {
      throw new Error('El modo all_against_clock exige al menos una diana participante');
    }
    // Orden estable e independiente de la semilla: la activación es simultánea.
    const targets = [...config.targets].sort((a, b) => targetKey(a).localeCompare(targetKey(b)));

    return {
      mode: this.key,
      seed: config.seed,
      strictOrder: false,
      penaltyMs: config.penaltyMs ?? 0,
      countdownMs: config.countdownMs ?? 3000,
      timeLimitMs: config.timeLimitMs ?? null,
      activations: [{ step: 0, targets, activateAtMs: 0 }],
      expectedHits: targets.length,
    };
  }

  resolveHit(state: RoundRuntimeState, hit: HitInput): HitDecision {
    const activation = state.plan.activations[0];
    const participates = activation.targets.some((t) => sameTarget(t, hit.target));

    if (!participates) {
      return {
        classification: 'hit_on_safe',
        countsForScore: false,
        penaltyMs: state.plan.penaltyMs,
        advance: false,
        reason: 'Impacto sobre una diana que no participa en la ronda',
      };
    }
    if (state.hitTargets.has(targetKey(hit.target))) {
      return {
        classification: 'hit_on_already_hit',
        countsForScore: false,
        penaltyMs: state.plan.penaltyMs,
        advance: false,
        reason: 'Diana ya alcanzada',
      };
    }
    return { classification: 'valid_hit', countsForScore: true, penaltyMs: 0, advance: false, reason: null };
  }

  isComplete(state: RoundRuntimeState): boolean {
    return state.validHits >= state.plan.expectedHits;
  }
}
