/**
 * Cálculo de munición y precisión — ADR-0006 y dosier 17.2-17.3.
 *
 * PROHIBIDO: sustituir los disparos desconocidos por la munición inicial o
 * derivar "fallos" de la diferencia entre munición e impactos. Cuando no se
 * conoce la munición restante, los disparos y las precisiones son `null` y el
 * estado es `not_computable`.
 */

export type AccuracyStatus = 'computed' | 'not_computable';

export interface AmmoInput {
  /** Munición inicial disponible. `null` si no se registró. */
  initialAmmo: number | null;
  /** Munición restante contada al terminar. `null` si se desconoce. */
  remainingAmmo: number | null;
  /** ¿Se ha contado realmente la munición restante? */
  remainingKnown: boolean;
  /** La partida exigía consumir toda la munición (dosier 17.3, caso 1). */
  mustUseAllAmmo: boolean;
  /** Impactos detectados por los sensores (todas las clasificaciones que son impacto real). */
  detectedHits: number;
  /** Impactos válidos (clasificación `valid_hit`). */
  validHits: number;
  /** Impactos incorrectos: detectados que no son válidos. */
  invalidHits: number;
}

export interface AccuracyResult {
  initialAmmo: number | null;
  remainingAmmo: number | null;
  /** `null` cuando no puede conocerse. Nunca se inventa. */
  shotsFired: number | null;
  detectedHits: number;
  validHits: number;
  invalidHits: number;
  /** impactos detectados / disparos realizados × 100. `null` si no calculable. */
  accuracyTotal: number | null;
  /** impactos válidos / disparos realizados × 100. `null` si no calculable. */
  accuracyValid: number | null;
  accuracyStatus: AccuracyStatus;
  /** Motivo legible cuando el estado es `not_computable`, o aviso de inconsistencia. */
  reason: string | null;
  warnings: string[];
}

export const NOT_COMPUTABLE_MESSAGE =
  'Precisión no calculable: se desconoce el número real de disparos.';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function notComputable(input: AmmoInput, reason: string, warnings: string[] = []): AccuracyResult {
  return {
    initialAmmo: input.initialAmmo,
    remainingAmmo: input.remainingKnown ? input.remainingAmmo : null,
    shotsFired: null,
    detectedHits: input.detectedHits,
    validHits: input.validHits,
    invalidHits: input.invalidHits,
    accuracyTotal: null,
    accuracyValid: null,
    accuracyStatus: 'not_computable',
    reason,
    warnings,
  };
}

/**
 * Determina los disparos realizados a partir de la munición, según 17.3.
 * Devuelve `null` cuando el dato no es derivable de forma honesta.
 */
export function resolveShotsFired(input: AmmoInput): number | null {
  if (input.initialAmmo === null || input.initialAmmo < 0) return null;
  if (input.mustUseAllAmmo) return input.initialAmmo;
  if (!input.remainingKnown) return null;
  if (input.remainingAmmo === null || input.remainingAmmo < 0) return null;
  const shots = input.initialAmmo - input.remainingAmmo;
  return shots < 0 ? null : shots;
}

export function computeAccuracy(input: AmmoInput): AccuracyResult {
  const warnings: string[] = [];

  if (input.detectedHits < 0 || input.validHits < 0 || input.invalidHits < 0) {
    throw new Error('Los recuentos de impactos no pueden ser negativos');
  }
  if (input.validHits + input.invalidHits !== input.detectedHits) {
    warnings.push(
      `Recuento incoherente: válidos (${input.validHits}) + incorrectos (${input.invalidHits}) ` +
        `≠ detectados (${input.detectedHits}).`,
    );
  }

  if (input.initialAmmo === null) {
    return notComputable(input, `${NOT_COMPUTABLE_MESSAGE} No se registró la munición inicial.`, warnings);
  }

  if (
    !input.mustUseAllAmmo &&
    input.remainingKnown &&
    input.remainingAmmo !== null &&
    input.remainingAmmo > input.initialAmmo
  ) {
    return notComputable(
      input,
      `${NOT_COMPUTABLE_MESSAGE} La munición restante (${input.remainingAmmo}) supera la inicial (${input.initialAmmo}).`,
      warnings,
    );
  }

  const shotsFired = resolveShotsFired(input);

  if (shotsFired === null) {
    return notComputable(
      input,
      `${NOT_COMPUTABLE_MESSAGE} No se ha introducido la munición restante y la partida no exigía consumirla toda.`,
      warnings,
    );
  }

  if (shotsFired === 0) {
    return notComputable(
      input,
      'Precisión no calculable: no se registraron disparos realizados.',
      warnings,
    );
  }

  if (input.detectedHits > shotsFired) {
    warnings.push(
      `Impactos detectados (${input.detectedHits}) mayores que los disparos realizados (${shotsFired}); ` +
        'revisar munición introducida o vibración cruzada.',
    );
  }

  return {
    initialAmmo: input.initialAmmo,
    remainingAmmo: input.mustUseAllAmmo ? (input.remainingAmmo ?? 0) : input.remainingAmmo,
    shotsFired,
    detectedHits: input.detectedHits,
    validHits: input.validHits,
    invalidHits: input.invalidHits,
    accuracyTotal: round2((input.detectedHits / shotsFired) * 100),
    accuracyValid: round2((input.validHits / shotsFired) * 100),
    accuracyStatus: 'computed',
    reason: warnings.length > 0 ? warnings.join(' ') : null,
    warnings,
  };
}
