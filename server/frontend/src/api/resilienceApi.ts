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
  coordinatorDown: boolean;
  missingModules: { slug: string; lastSeenAt: string | null }[];
  involvedModules: number;
  countdown: { elapsedMs: number; remainingMs: number; expired: boolean } | null;
  operatorMustDecide: boolean;
  canResumeWithout: boolean;
  note: string | null;
}

export function getResilienceStatus(gameId: string): Promise<ResilienceStatus> {
  return req(`/resilience/games/${gameId}`);
}

export function decideResilience(
  gameId: string,
  action: "resume_without" | "abort",
): Promise<{ action: string; missing: string[] }> {
  return req(`/resilience/games/${gameId}/decision`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}
