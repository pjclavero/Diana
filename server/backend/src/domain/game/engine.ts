import { GameModeRegistry } from './registry';
import { DeterministicRng } from './rng';
import {
  HitDecision,
  HitInput,
  RoundConfig,
  RoundPlan,
  RoundRuntimeState,
  targetKey,
} from './types';

export interface AppliedHit extends HitDecision {
  /** Paso del plan en el que se resolvió el impacto. */
  step: number;
  /** T2 del impacto, tal cual lo entrega el coordinador. */
  elapsedUs: number;
  /** Estado de la ronda después de aplicar el impacto. */
  finished: boolean;
}

export interface RoundSummary {
  mode: string;
  seed: number;
  validHits: number;
  invalidHits: number;
  detectedHits: number;
  penaltiesCount: number;
  penaltiesMs: number;
  finished: boolean;
  firstHitUs: number | null;
  lastHitUs: number | null;
  /** Tiempo total consolidado (T2) más penalizaciones convertidas a µs. */
  totalTimeUs: number | null;
}

/**
 * Núcleo del motor de partidas.
 *
 * No conoce ningún modo concreto: delega en la estrategia registrada. Es puro
 * (sin E/S, sin relojes propios) y por tanto reproducible: con la misma
 * semilla y la misma secuencia de impactos produce siempre el mismo resultado.
 *
 * AUTORIDAD TEMPORAL (ADR-0002): el motor sólo LEE `elapsedUs` (T2, del
 * coordinador). Nunca lo genera ni lo corrige.
 */
export class GameEngine {
  constructor(private readonly registry: GameModeRegistry) {}

  /** Genera el plan determinista de una ronda. */
  planRound(config: RoundConfig): RoundPlan {
    const strategy = this.registry.get(config.mode);
    const rng = new DeterministicRng(config.seed);
    return strategy.plan(config, rng);
  }

  /** Estado inicial de ejecución de un plan. */
  createState(plan: RoundPlan): RoundRuntimeState {
    return {
      plan,
      step: 0,
      hitTargets: new Set<string>(),
      validHits: 0,
      invalidHits: 0,
      detectedHits: 0,
      penaltiesMs: 0,
      penaltiesCount: 0,
      finished: false,
      firstHitUs: null,
      lastHitUs: null,
    };
  }

  /** Aplica un impacto y muta el estado. Devuelve la decisión tomada. */
  applyHit(state: RoundRuntimeState, hit: HitInput): AppliedHit {
    const strategy = this.registry.get(state.plan.mode);
    const stepAtHit = state.step;

    if (state.finished) {
      return {
        classification: 'during_pause',
        countsForScore: false,
        penaltyMs: 0,
        advance: false,
        reason: 'La ronda ya ha terminado',
        step: stepAtHit,
        elapsedUs: hit.elapsedUs,
        finished: true,
      };
    }

    // La vibración cruzada y la ambigüedad las decide el firmware con datos que
    // el backend no tiene (amplitudes y ventana de agrupación). Se respetan.
    if (hit.firmwareClassification === 'crosstalk_rejected' || hit.firmwareClassification === 'ambiguous') {
      return {
        classification: hit.firmwareClassification,
        countsForScore: false,
        penaltyMs: 0,
        advance: false,
        reason: 'Clasificación del firmware respetada por el motor',
        step: stepAtHit,
        elapsedUs: hit.elapsedUs,
        finished: state.finished,
      };
    }

    const decision = strategy.resolveHit(state, hit);

    if (decision.countsForScore) {
      state.validHits += 1;
      state.detectedHits += 1;
      state.hitTargets.add(targetKey(hit.target));
      if (state.firstHitUs === null) state.firstHitUs = hit.elapsedUs;
      state.lastHitUs = hit.elapsedUs;
    } else if (decision.classification !== 'early_shot') {
      state.invalidHits += 1;
      state.detectedHits += 1;
    }

    if (decision.penaltyMs > 0) {
      state.penaltiesMs += decision.penaltyMs;
      state.penaltiesCount += 1;
    }

    if (decision.advance) {
      state.step += 1;
      // El salto de activaciones ya resueltas es decisión de la ESTRATEGIA, no
      // del núcleo: en `random` una diana puede volver a activarse.
      while (
        state.step < state.plan.activations.length &&
        (strategy.shouldSkipActivation?.(state, state.plan.activations[state.step]) ?? false)
      ) {
        state.step += 1;
      }
    }

    state.finished = strategy.isComplete(state);

    return {
      ...decision,
      step: stepAtHit,
      elapsedUs: hit.elapsedUs,
      finished: state.finished,
    };
  }

  summarise(state: RoundRuntimeState): RoundSummary {
    return {
      mode: state.plan.mode,
      seed: state.plan.seed,
      validHits: state.validHits,
      invalidHits: state.invalidHits,
      detectedHits: state.detectedHits,
      penaltiesCount: state.penaltiesCount,
      penaltiesMs: state.penaltiesMs,
      finished: state.finished,
      firstHitUs: state.firstHitUs,
      lastHitUs: state.lastHitUs,
      totalTimeUs: state.lastHitUs === null ? null : state.lastHitUs + state.penaltiesMs * 1000,
    };
  }
}
