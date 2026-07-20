import type { HitClassification, ModuleState, TargetState } from './types.js';

export interface ClassifyInput {
  moduleState: ModuleState;
  targetState: TargetState;
  /** true si el modo de juego exige orden estricto y esta diana no es la esperada ahora mismo. */
  outOfExpectedOrder: boolean;
}

/**
 * Clasifica un impacto según el estado del módulo y de la diana en el
 * instante del golpe (dosier §17.1, enum hitClassification del contrato).
 * No decide crosstalk: eso lo resuelve el llamador comparando amplitudes
 * entre canales antes de invocar esta función por canal "principal".
 */
export function classifyHit(input: ClassifyInput): {
  classification: HitClassification;
  reason?: string;
} {
  if (input.moduleState === 'calibration') {
    return { classification: 'calibration_hit', reason: 'módulo en calibración' };
  }
  if (input.moduleState === 'game_paused') {
    return { classification: 'during_pause', reason: 'partida en pausa' };
  }
  if (input.targetState === 'countdown') {
    return { classification: 'early_shot', reason: 'disparo antes de la activación de la diana' };
  }
  if (input.targetState === 'safe') {
    return { classification: 'hit_on_safe', reason: 'diana en azul (segura)' };
  }
  if (input.targetState === 'hit') {
    return { classification: 'hit_on_already_hit', reason: 'diana ya alcanzada' };
  }
  if (input.targetState !== 'active') {
    return {
      classification: 'ambiguous',
      reason: `impacto con diana en estado inesperado: ${input.targetState}`,
    };
  }
  if (input.outOfExpectedOrder) {
    return { classification: 'out_of_order', reason: 'secuencia estricta violada' };
  }
  return { classification: 'valid_hit' };
}
