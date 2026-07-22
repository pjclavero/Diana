import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL de jugadores y equipos (G-D). Contra `/api/players*` y `/api/teams`. */
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
}

export interface PlayerRow {
  id: string;
  displayName: string;
  licence: string | null;
  active: boolean;
  teamId: string | null;
  team: { id: string; name: string } | null;
  userId: string | null;
  user: { id: string; username: string } | null;
  registered: boolean;
}

export function searchPlayers(q: string): Promise<PlayerRow[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : "";
  return req<PlayerRow[]>(`/players/search${query}`);
}

export function createPlayer(payload: { displayName: string; teamId?: string | null }): Promise<{ id: string }> {
  return req<{ id: string }>("/players", { method: "POST", body: JSON.stringify(payload) });
}

/** Asigna o cambia el equipo de un jugador (o lo deja sin equipo con null). */
export function setPlayerTeam(id: string, teamId: string | null): Promise<{ id: string }> {
  return req<{ id: string }>(`/players/${id}`, { method: "PATCH", body: JSON.stringify({ teamId }) });
}

export async function listTeams(): Promise<Team[]> {
  const page = await req<{ items: Team[] }>("/teams?take=500&orderBy=name&order=asc");
  return page.items;
}

export function createTeam(payload: { name: string; description?: string }): Promise<Team> {
  return req<Team>("/teams", { method: "POST", body: JSON.stringify(payload) });
}
