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
 * Modo `sequence` (dosier 16.2): las dianas se activan en un orden definido.
 *
 * - `strictOrder = true`: golpear una diana distinta de la activa es
 *   `out_of_order`, penaliza y NO avanza la secuencia.
 * - `strictOrder = false`: se admite golpear cualquier diana pendiente; la
 *   secuencia avanza saltando las ya alcanzadas.
 */
export class SequenceModeStrategy implements GameModeStrategy {
  readonly key = 'sequence';
  readonly displayName = 'Secuencia fija';
  readonly description =
    'Las dianas se activan en el orden definido. Con orden estricto, salirse del orden penaliza y no avanza.';

  plan(config: RoundConfig, rng: DeterministicRng): RoundPlan {
    if (config.targets.length === 0) {
      throw new Error('El modo sequence exige al menos una diana participante');
    }
    const order: TargetRef[] =
      config.sequence && config.sequence.length > 0
        ? [...config.sequence]
        : rng.shuffle(config.targets);

    const known = new Set(config.targets.map(targetKey));
    for (const ref of order) {
      if (!known.has(targetKey(ref))) {
        throw new Error(`La secuencia contiene una diana no participante: ${targetKey(ref)}`);
      }
    }

    const intervalMs = config.intervalMs ?? 0;
    const activations: Activation[] = order.map((target, step) => ({
      step,
      targets: [target],
      activateAtMs: step * intervalMs,
    }));

    return {
      mode: this.key,
      seed: config.seed,
      strictOrder: config.strictOrder ?? false,
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
        penaltyMs: state.plan.penaltyMs,
        advance: false,
        reason: 'La secuencia ya está completa',
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
      return {
        classification: 'valid_hit',
        countsForScore: true,
        penaltyMs: 0,
        advance: true,
        reason: 'Orden no estricto: se acepta una diana pendiente fuera de orden',
      };
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

  /** En una secuencia, una diana ya alcanzada no vuelve a exigirse. */
  shouldSkipActivation(state: RoundRuntimeState, activation: Activation): boolean {
    return activation.targets.every((t) => state.hitTargets.has(targetKey(t)));
  }
}
