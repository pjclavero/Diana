import { findStaleModules, StaleCandidate, STALE_AFTER_MS } from '../resilience/resilience';

/**
 * CONECTIVIDAD de un módulo (T3). Es una vista DERIVADA, no un campo nuevo.
 *
 * ── Por qué no es `ModuleState` ──────────────────────────────────────────────
 * `ModuleState` (boot, selftest, ready, game_active…) es el ciclo de vida del
 * FIRMWARE: describe qué está haciendo el módulo, y sólo tiene sentido si el
 * módulo está ahí para hacerlo. Un módulo apagado conserva su último
 * `state = ready` en la base para siempre. Leer eso como «está conectado» es
 * exactamente el error que este tipo existe para impedir.
 *
 * ── De dónde sale ────────────────────────────────────────────────────────────
 * De `online` + `lastSeenAt`, que son los dos únicos hechos observados: el
 * primero lo mueve la presencia/LWT del broker, el segundo cada señal de vida
 * real (telemetría, impacto, estado). NO hay ninguna otra fuente, y en
 * particular no hay ninguna que el backend pueda fabricar: con cero
 * dispositivos publicando, `lastSeenAt` es NULL en todas las filas y esta
 * función no puede devolver ONLINE ni una sola vez. Esa es la garantía, y es
 * estructural, no una convención.
 *
 * ── El umbral es el que ya existía ───────────────────────────────────────────
 * El vencimiento se decide con `findStaleModules` / `STALE_AFTER_MS` (90 s) del
 * dominio de resiliencia, medido en el E2E `tests/e2e/offline/` con 92 s
 * reales. No se escribe aquí una segunda regla de caducidad: dos umbrales
 * distintos para «lleva demasiado callado» acaban divergiendo, y entonces el
 * panel y la resiliencia contradicen el uno al otro sobre el mismo módulo.
 */
export type ModuleConnectivity = 'PENDING' | 'ONLINE' | 'STALE' | 'OFFLINE';

export interface ConnectivityInput {
  slug: string;
  /** Bandera de presencia según el broker (LWT incluido). */
  online: boolean;
  /** Última señal de vida REAL. `null` = nunca se ha oído a este módulo. */
  lastSeenAt: Date | null;
}

export interface ConnectivityVerdict {
  slug: string;
  connectivity: ModuleConnectivity;
  lastSeenAt: Date | null;
  /** Silencio acumulado en ms, o `null` si no hay desde dónde medirlo. */
  silentForMs: number | null;
  reason: string;
}

export function classifyConnectivity(
  module: ConnectivityInput,
  now: Date,
  staleAfterMs: number = STALE_AFTER_MS,
): ConnectivityVerdict {
  return classifyConnectivityAll([module], now, staleAfterMs)[0];
}

/**
 * Clasifica un conjunto. Se hace en bloque —y no llamando N veces a una regla
 * suelta— para poder apoyarse en `findStaleModules`, que es la función que ya
 * decide en este proyecto quién lleva demasiado callado.
 */
export function classifyConnectivityAll(
  modules: ConnectivityInput[],
  now: Date,
  staleAfterMs: number = STALE_AFTER_MS,
): ConnectivityVerdict[] {
  const candidates: StaleCandidate[] = modules.map((m) => ({
    slug: m.slug,
    online: m.online,
    lastSeenAt: m.lastSeenAt,
  }));
  const stale = new Map(findStaleModules(candidates, now, staleAfterMs).map((s) => [s.slug, s]));

  return modules.map((m) => {
    const silentForMs = m.lastSeenAt === null ? null : now.getTime() - m.lastSeenAt.getTime();

    // NUNCA CONECTADO. No hay bandera de presencia y no consta ni una sola
    // señal de vida: el módulo está dado de alta y nada más. No es OFFLINE,
    // porque OFFLINE afirma que estuvo y se cayó, y eso no consta.
    if (!m.online && m.lastSeenAt === null) {
      return {
        slug: m.slug,
        connectivity: 'PENDING',
        lastSeenAt: null,
        silentForMs: null,
        reason: `El módulo ${m.slug} está dado de alta pero no se ha conectado nunca.`,
      };
    }

    // VENCIDO. Consta en línea pero lleva más de `staleAfterMs` callado (o
    // consta en línea sin ninguna señal que lo respalde, que es peor).
    const vencido = stale.get(m.slug);
    if (vencido) {
      return {
        slug: m.slug,
        connectivity: 'STALE',
        lastSeenAt: m.lastSeenAt,
        silentForMs,
        reason: vencido.reason,
      };
    }

    // CAÍDO. Se le oyó alguna vez y ahora la presencia dice que no está.
    if (!m.online) {
      return {
        slug: m.slug,
        connectivity: 'OFFLINE',
        lastSeenAt: m.lastSeenAt,
        silentForMs,
        reason: `El módulo ${m.slug} estuvo conectado y ahora consta caído.`,
      };
    }

    // EN LÍNEA. Presencia viva Y una señal de vida dentro del plazo. Hacen
    // falta las dos: `online` a solas es una bandera que puede haberse quedado
    // pegada si el Last Will nunca llegó (D9), y por eso el caso de arriba la
    // desmiente en cuanto el silencio se pasa del plazo.
    return {
      slug: m.slug,
      connectivity: 'ONLINE',
      lastSeenAt: m.lastSeenAt,
      silentForMs,
      reason:
        silentForMs === null
          ? `El módulo ${m.slug} consta en línea.`
          : `El módulo ${m.slug} dio señal de vida hace ${Math.round(silentForMs / 1000)} s.`,
    };
  });
}

/** Resumen para el panel. `online` cuenta SÓLO los ONLINE de verdad. */
export function summarizeConnectivity(verdicts: ConnectivityVerdict[]): {
  total: number;
  online: number;
  stale: number;
  offline: number;
  pending: number;
} {
  const count = (c: ModuleConnectivity) => verdicts.filter((v) => v.connectivity === c).length;
  return {
    total: verdicts.length,
    online: count('ONLINE'),
    stale: count('STALE'),
    offline: count('OFFLINE'),
    pending: count('PENDING'),
  };
}
