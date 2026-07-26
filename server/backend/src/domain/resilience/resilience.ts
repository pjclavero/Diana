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

/**
 * Silencio máximo tolerado antes de dar por caído a un módulo que consta EN
 * LÍNEA. Un módulo vivo refresca su señal de vida con cada telemetría
 * (`telemetry_interval_ms` = 1000 ms) y con cada estado o impacto, así que un
 * minuto y medio de silencio absoluto no es un hueco: es que no está.
 */
export const STALE_AFTER_MS = 90_000;

export interface StaleCandidate {
  slug: string;
  online: boolean;
  lastSeenAt: Date | null;
}

export interface StaleModule {
  slug: string;
  /** Última señal de vida conocida; `null` = no consta ninguna. */
  lastSeenAt: Date | null;
  /** Silencio acumulado, o `null` si no hay referencia desde la que medirlo. */
  silentForMs: number | null;
  reason: string;
}

/**
 * Módulos que constan en línea pero llevan demasiado tiempo callados (D9).
 *
 * Existe porque la caída sólo se detectaba por el Last Will del broker, y ese
 * mensaje puede no llegar nunca: si el broker se reinicia sin persistencia, o
 * pierde la sesión, `online` se queda pegado a `true` y un módulo muerto pasa
 * por vivo indefinidamente. Esta función NO decide nada: sólo dice quién lleva
 * callado más de la cuenta.
 */
export function findStaleModules(
  modules: StaleCandidate[],
  now: Date,
  staleAfterMs: number = STALE_AFTER_MS,
): StaleModule[] {
  const stale: StaleModule[] = [];
  for (const m of modules) {
    if (!m.online) continue;
    if (m.lastSeenAt === null) {
      // Consta en línea y no hay ni una señal de vida registrada: la bandera
      // no la respalda nada. No se puede medir el silencio, pero sí afirmarlo.
      stale.push({
        slug: m.slug,
        lastSeenAt: null,
        silentForMs: null,
        reason: `El módulo ${m.slug} consta en línea pero no hay ninguna señal de vida registrada.`,
      });
      continue;
    }
    const silentForMs = now.getTime() - m.lastSeenAt.getTime();
    if (silentForMs <= staleAfterMs) continue;
    stale.push({
      slug: m.slug,
      lastSeenAt: m.lastSeenAt,
      silentForMs,
      reason:
        `El módulo ${m.slug} lleva ${Math.round(silentForMs / 1000)} s sin dar señal de vida ` +
        `(máximo tolerado ${Math.round(staleAfterMs / 1000)} s). Se da por caído sin haber ` +
        'recibido su Last Will.',
    });
  }
  return stale;
}

/**
 * Cuánto se tolera el silencio simultáneo de todos antes de declarar las caídas
 * de todas formas. Acota el punto ciego: no distinguimos «se ha roto el camino
 * común» de «se ha ido la luz de la sala», pero no podemos quedarnos ciegos para
 * siempre. Una ronda pausada de más se reanuda con un botón; una ronda que sigue
 * con las dianas muertas produce resultados basura sin que nadie se entere.
 */
export const BLACKOUT_GRACE_MS = 4 * 60_000;

/**
 * ¿El silencio es de todos a la vez? Entonces la explicación más probable no es
 * que hayan muerto todos, sino que se ha roto lo que comparten.
 *
 * Los módulos que NUNCA han dado señal no cuentan como prueba: su silencio no
 * dice nada sobre un camino que quizá nunca funcionó, y sin excluirlos uno solo
 * de ellos convertiría cualquier caída aislada en un falso «apagón».
 */
export function isBlackout(candidates: StaleCandidate[], stale: StaleModule[]): boolean {
  const heard = candidates.filter((c) => c.online && c.lastSeenAt !== null);
  const heardStale = stale.filter((s) => s.lastSeenAt !== null);
  return heard.length > 1 && heardStale.length === heard.length;
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
