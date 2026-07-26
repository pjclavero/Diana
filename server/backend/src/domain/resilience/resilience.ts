/**
 * Resiliencia de ronda (G-I, §6.3). Decisión PURA sobre qué hacer cuando un
 * módulo desaparece o vuelve.
 *
 * Reglas acordadas:
 *  - Cae un módulo IMPLICADO en la ronda → auto-pausa con aviso y cuenta atrás
 *    de reconexión. Al agotarse, decide el OPERADOR: reanudar sin él o abortar.
 *    El backend NUNCA reanuda solo: reanudar sin un módulo cambia las
 *    condiciones de la prueba y eso no lo decide una máquina.
 *  - Cae el COORDINADOR → pausa dura: sin él no hay tiempos fiables (es quien
 *    consolida T2), así que da igual que el resto siga en pie.
 *  - Cae un módulo NO implicado → no se toca la ronda; sólo se registra.
 */

export type ResilienceAction = 'none' | 'auto_pause' | 'hard_pause' | 'reconnected';

export interface PresenceChange {
  moduleSlug: string;
  online: boolean;
  /** El módulo es el coordinador del panel donde se juega. */
  isCoordinator: boolean;
  /** El módulo aporta dianas al plan de la ronda en curso. */
  involvedInRound: boolean;
  /** Estado de la partida en el momento del cambio. */
  gameStatus: string | null;
}

export interface ResilienceDecision {
  action: ResilienceAction;
  /** Motivo legible; se muestra en el panel y se guarda en la incidencia. */
  reason: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** true = el operador debe decidir (reanudar sin él o abortar). */
  needsOperatorDecision: boolean;
}

/** Estados en los que una caída puede afectar a una ronda en marcha. */
const LIVE_STATUSES = ['running', 'paused'];

export function decidePresenceChange(change: PresenceChange): ResilienceDecision {
  const live = change.gameStatus !== null && LIVE_STATUSES.includes(change.gameStatus);

  if (change.online) {
    if (!live) {
      return {
        action: 'none',
        reason: `El módulo ${change.moduleSlug} está en línea.`,
        severity: 'info',
        needsOperatorDecision: false,
      };
    }
    return {
      action: 'reconnected',
      reason:
        `El módulo ${change.moduleSlug} ha vuelto. La ronda sigue en pausa: ` +
        'reanudarla es decisión del operador.',
      severity: 'info',
      // Volver no reanuda solo: la ronda quedó pausada y alguien debe decidir.
      needsOperatorDecision: true,
    };
  }

  if (!live) {
    return {
      action: 'none',
      reason: `El módulo ${change.moduleSlug} se ha desconectado. No hay ronda en curso.`,
      severity: 'warning',
      needsOperatorDecision: false,
    };
  }

  if (change.isCoordinator) {
    return {
      action: 'hard_pause',
      reason:
        `Ha caído el COORDINADOR (${change.moduleSlug}). Pausa dura: sin él no hay ` +
        'tiempos fiables, así que la ronda no puede continuar hasta que vuelva.',
      severity: 'critical',
      needsOperatorDecision: true,
    };
  }

  if (change.involvedInRound) {
    return {
      action: 'auto_pause',
      reason:
        `Ha caído el módulo ${change.moduleSlug}, implicado en la ronda. Ronda en pausa ` +
        'automática mientras se espera su reconexión.',
      severity: 'error',
      needsOperatorDecision: true,
    };
  }

  return {
    action: 'none',
    reason: `Ha caído el módulo ${change.moduleSlug}, que no participa en esta ronda.`,
    severity: 'warning',
    needsOperatorDecision: false,
  };
}

export interface CountdownInput {
  /** Instante de la caída. */
  since: Date;
  now: Date;
  graceMs: number;
}

export interface Countdown {
  elapsedMs: number;
  remainingMs: number;
  /** true = se agotó el plazo; el operador tiene que decidir ya. */
  expired: boolean;
}

/** Cuenta atrás de reconexión. No decide nada: sólo informa del plazo. */
export function reconnectCountdown({ since, now, graceMs }: CountdownInput): Countdown {
  const elapsedMs = Math.max(0, now.getTime() - since.getTime());
  const remainingMs = Math.max(0, graceMs - elapsedMs);
  return { elapsedMs, remainingMs, expired: remainingMs === 0 };
}
