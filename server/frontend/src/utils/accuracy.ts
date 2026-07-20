import type { AccuracyResult } from "../types/domain";

/**
 * Cálculo de precisión conforme a docs/adr/0006-precision-no-calculable.md.
 *
 * NORMATIVO: si no se conoce la munición restante y la partida no exige
 * consumir toda la munición, la precisión NO es calculable. No se sustituye
 * por la munición inicial ni se muestra un 0 % o 100 % engañoso.
 */
export function computeAccuracy(params: {
  ammoInitial: number | null;
  ammoRemaining: number | null;
  ammoMustBeFullyConsumed: boolean;
  hitsDetected: number;
  hitsValid: number;
}): AccuracyResult {
  const { ammoInitial, ammoRemaining, ammoMustBeFullyConsumed, hitsDetected, hitsValid } = params;

  let shotsFired: number | null = null;

  if (ammoMustBeFullyConsumed && ammoInitial !== null) {
    shotsFired = ammoInitial;
  } else if (ammoInitial !== null && ammoRemaining !== null) {
    shotsFired = ammoInitial - ammoRemaining;
  }

  if (shotsFired === null || shotsFired <= 0) {
    return {
      status: "not_computable",
      shots_fired: null,
      total_accuracy_pct: null,
      valid_accuracy_pct: null,
      reason: "Se desconoce el número real de disparos",
    };
  }

  return {
    status: "computable",
    shots_fired: shotsFired,
    total_accuracy_pct: (hitsDetected / shotsFired) * 100,
    valid_accuracy_pct: (hitsValid / shotsFired) * 100,
  };
}

export const ACCURACY_NOT_COMPUTABLE_TEXT =
  "Precisión no calculable: se desconoce el número real de disparos.";
