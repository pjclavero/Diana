/**
 * Precedencia de versiones de configuración (T2). Decisión PURA, sin reloj.
 *
 * La regla exigida, tal cual:
 *
 *     remota  >  local  ->  aplicar
 *     remota  =  local  ->  noop
 *     remota  <  local  ->  rechazar
 *
 * «Remota» es la versión que llega en el mensaje; «local» la que ya consta.
 * El ORDEN lo da el entero y sólo el entero. Nada aquí mira una marca de
 * tiempo, y es deliberado: un módulo con el reloj adelantado —o un reinicio
 * que devuelva el reloj atrás— cambiaría el resultado si el orden dependiese
 * del tiempo, y el efecto sería aceptar una configuración vieja como si fuera
 * nueva. Con enteros eso no puede pasar: una versión menor es menor siempre.
 *
 * La consecuencia práctica de `rechazar` es la que da la monotonía: una versión
 * reportada no puede retroceder nunca, ni siquiera si el dispositivo la
 * reenvía tras un arranque en frío con memoria perdida.
 */
export type ConfigVersionDecision = 'apply' | 'noop' | 'reject';

export interface ConfigVersionComparison {
  decision: ConfigVersionDecision;
  reason: string;
}

export function decideConfigVersion(remote: number, local: number): ConfigVersionComparison {
  if (!Number.isInteger(remote) || remote < 0) {
    return {
      decision: 'reject',
      reason: `config_version remota inválida (${remote}): el contrato exige un entero ≥ 0.`,
    };
  }
  if (!Number.isInteger(local) || local < 0) {
    return {
      decision: 'reject',
      reason: `config_version local inválida (${local}): el contrato exige un entero ≥ 0.`,
    };
  }
  if (remote > local) {
    return { decision: 'apply', reason: `La versión ${remote} es posterior a la ${local}.` };
  }
  if (remote === local) {
    return { decision: 'noop', reason: `La versión ${remote} ya consta; no hay nada que hacer.` };
  }
  return {
    decision: 'reject',
    reason:
      `La versión ${remote} es ANTERIOR a la ${local} ya conocida. Se rechaza: ` +
      'la versión de configuración es monotónica y no retrocede.',
  };
}

/** Los tres estados del ciclo de configuración de un módulo. */
export type ConfigState = 'pending' | 'applied' | 'failed';

export const CONFIG_STATES: readonly ConfigState[] = ['pending', 'applied', 'failed'] as const;

export interface ConfigStateInput {
  desired: number;
  /** `null` = el módulo no ha reportado nunca. */
  reported: number | null;
  /** El último empujón no llegó al broker, o el módulo reportó un fallo. */
  failed?: boolean;
}

/**
 * Estado derivado. NO se almacena como voluntad independiente: se calcula de
 * los dos enteros, de forma que no pueda quedar un `applied` que ninguna
 * versión reportada respalde (la base lo refuerza con un CHECK).
 */
export function deriveConfigState({ desired, reported, failed }: ConfigStateInput): ConfigState {
  if (failed) return 'failed';
  if (reported === null) return 'pending';
  return reported === desired ? 'applied' : 'pending';
}
