import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL de resiliencia de ronda (G-I): caídas, cuenta atrás y decisión. */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers as Record<string, string>),
      },
    });
  } catch {
    throw new ApiError("No se puede contactar con el servidor.");
  }
  if (res.status === 401 || res.status === 403) throw new ApiError("No tiene permiso para esta acción.");
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string | string[] };
      detail = (Array.isArray(body.message) ? body.message[0] : body.message) ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }
  return (await res.json()) as T;
}

export interface ResilienceStatus {
  game: { id: string; status: string; panel: string };
  round: { id: string; index: number; phase: string } | null;
  panels: string[];
  paused: boolean;
  pausedByResilience: boolean;
  /** null = no consta; false = la orden de pausa NO llegó al broker. */
  pauseCommandDelivered: boolean | null;
  brokerConnected: boolean | null;
  coordinatorDown: boolean;
  missingModules: {
    slug: string;
    lastSeenAt: string | null;
    offlineSince: string | null;
    /** Silencio acumulado; null = no consta ninguna señal de vida previa. */
    silentForMs: number | null;
  }[];
  /** Constan en línea pero llevan callados más de la cuenta (D9). */
  staleModules: { slug: string; silentForMs: number | null; reason: string }[];
  /**
   * Qué hará el barrido si el silencio sigue. `enabled: false` = la detección
   * automática está desactivada por configuración; `listening: false` = el
   * servidor no lleva oyendo al broker lo suficiente, así que el silencio puede
   * ser suyo; `blackout: true` = callan todos a la vez y se está tratando como
   * fallo del camino común. En los tres casos NO habrá pausa automática.
   */
  sweep: { enabled: boolean; listening: boolean; blackout: boolean };
  involvedModules: number;
  countdown: { elapsedMs: number; remainingMs: number; expired: boolean } | null;
  operatorMustDecide: boolean;
  canResumeWithout: boolean;
  canResume: boolean;
  note: string | null;
}

export function getResilienceStatus(gameId: string): Promise<ResilienceStatus> {
  return req(`/resilience/games/${gameId}`);
}

export function decideResilience(
  gameId: string,
  action: "resume" | "resume_without" | "abort",
): Promise<{ action: string; missing: string[]; delivered?: boolean; note?: string | null }> {
  return req(`/resilience/games/${gameId}/decision`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}
