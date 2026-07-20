import type { HitClassification } from '../hits/hit-record';
import type { DeterministicRng } from './rng';

/** Referencia a una diana concreta: módulo + índice local 1..9. */
export interface TargetRef {
  module_id: string;
  target_index: number;
}

export function targetKey(ref: TargetRef): string {
  return `${ref.module_id}#${ref.target_index}`;
}

export function sameTarget(a: TargetRef, b: TargetRef): boolean {
  return a.module_id === b.module_id && a.target_index === b.target_index;
}

/** Configuración de ronda, común a todos los modos. */
export interface RoundConfig {
  mode: string;
  /** Dianas participantes. */
  targets: TargetRef[];
  /** Semilla determinista. Obligatoria para poder reproducir la ronda. */
  seed: number;
  /** Número de activaciones (modos random y reaction). */
  repetitions?: number;
  /** Intervalo nominal entre activaciones, ms. */
  intervalMs?: number;
  countdownMs?: number;
  timeLimitMs?: number | null;
  penaltyMs?: number;
  /** Modo `sequence`: exigir orden estricto. */
  strictOrder?: boolean;
  /** Modo `sequence`: orden explícito. Si falta, se baraja con la semilla. */
  sequence?: TargetRef[] | null;
  /** Modo `reaction`: [min, max] del retardo aleatorio, ms. */
  reactionDelayMs?: [number, number] | null;
  /** Parámetros extra de modos añadidos por terceros. */
  extra?: Record<string, unknown>;
}

/** Un paso del plan: qué dianas se activan y cuándo. */
export interface Activation {
  step: number;
  targets: TargetRef[];
  /** Instante nominal de activación relativo al inicio de ronda, ms. */
  activateAtMs: number;
}

export interface RoundPlan {
  mode: string;
  seed: number;
  strictOrder: boolean;
  penaltyMs: number;
  countdownMs: number;
  timeLimitMs: number | null;
  activations: Activation[];
  /** Impactos válidos necesarios para completar la ronda. */
  expectedHits: number;
}

/** Impacto entrante, ya clasificado por el firmware. */
export interface HitInput {
  target: TargetRef;
  /** T2 · tiempo de juego consolidado por el coordinador, microsegundos. */
  elapsedUs: number;
  /** Clasificación propuesta por el firmware. */
  firmwareClassification: HitClassification;
}

/** Decisión del motor sobre un impacto. */
export interface HitDecision {
  classification: HitClassification;
  countsForScore: boolean;
  penaltyMs: number;
  /** ¿Avanza el plan al siguiente paso? */
  advance: boolean;
  reason: string | null;
}

/** Estado mutable de la ronda mientras se juega. Sin E/S: puro. */
export interface RoundRuntimeState {
  plan: RoundPlan;
  /** Índice de la activación en curso. */
  step: number;
  /** Claves de dianas ya alcanzadas en la ronda. */
  hitTargets: Set<string>;
  validHits: number;
  invalidHits: number;
  detectedHits: number;
  penaltiesMs: number;
  penaltiesCount: number;
  finished: boolean;
  /** T2 del primer impacto válido. */
  firstHitUs: number | null;
  /** T2 del último impacto válido. */
  lastHitUs: number | null;
}

/**
 * Contrato de un modo de juego.
 *
 * Añadir un modo nuevo consiste en implementar esta interfaz y registrarla:
 * el núcleo (`GameEngine`, `GameModeRegistry`) no se toca.
 */
export interface GameModeStrategy {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  /** Valida la configuración y devuelve el plan determinista de la ronda. */
  plan(config: RoundConfig, rng: DeterministicRng): RoundPlan;
  /** Resuelve un impacto contra el estado actual. No muta el estado. */
  resolveHit(state: RoundRuntimeState, hit: HitInput): HitDecision;
  /** ¿La ronda ha terminado? */
  isComplete(state: RoundRuntimeState): boolean;
  /**
   * ¿Debe saltarse esta activación al avanzar?
   *
   * Sólo tiene sentido en modos donde una diana puede quedar resuelta antes de
   * que llegue su turno (secuencia sin orden estricto). Por omisión NO se salta
   * nada: en `random` la misma diana puede volver a activarse legítimamente.
   */
  shouldSkipActivation?(state: RoundRuntimeState, activation: Activation): boolean;
}
