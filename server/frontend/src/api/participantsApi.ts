import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL de participantes y partidas (G-D.2). */
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

export interface GameLite {
  id: string;
  name: string | null;
  status: string;
  gameMode?: { key: string; name: string } | null;
}

export interface Participant {
  id: string;
  slot: number;
  guestName: string | null;
  temporary: boolean;
  player: { id: string; displayName: string; userId: string | null } | null;
  team: { id: string; name: string } | null;
  /** Panel en el que juega; es lo que permite atribuir sus impactos. */
  targetSystem?: { id: string; slug: string; name: string } | null;
  attributable?: boolean;
  note?: string | null;
}

export async function listGames(): Promise<GameLite[]> {
  const page = await req<{ items: GameLite[] }>("/games?take=100");
  return page.items;
}

export function listParticipants(gameId: string): Promise<Participant[]> {
  return req<Participant[]>(`/participants?gameId=${encodeURIComponent(gameId)}`);
}

export function addRegisteredParticipant(gameId: string, playerId: string): Promise<Participant> {
  return req<Participant>("/participants", { method: "POST", body: JSON.stringify({ game_id: gameId, player_id: playerId }) });
}

export function addTemporaryParticipant(gameId: string, guestName: string): Promise<Participant> {
  return req<Participant>("/participants", { method: "POST", body: JSON.stringify({ game_id: gameId, guest_name: guestName }) });
}

export function setParticipantTeam(id: string, teamId: string | null): Promise<Participant> {
  return req<Participant>(`/participants/${id}/team`, { method: "PATCH", body: JSON.stringify({ team_id: teamId }) });
}

export function setParticipantPanel(id: string, targetSystemId: string | null): Promise<Participant> {
  return req<Participant>(`/participants/${id}/panel`, {
    method: "PATCH",
    body: JSON.stringify({ target_system_id: targetSystemId }),
  });
}

export function removeParticipant(id: string): Promise<void> {
  return req<void>(`/participants/${id}`, { method: "DELETE" });
}

// --- Unirse por QR (G-D) ---

export function ensureJoinCode(gameId: string, regenerate = false): Promise<{ id: string; joinCode: string }> {
  return req<{ id: string; joinCode: string }>(`/games/${gameId}/join-code${regenerate ? "?regenerate=1" : ""}`, { method: "POST" });
}

export interface JoinGameInfo {
  id: string;
  name: string | null;
  status: string;
  gameMode: { key: string; name: string } | null;
  joinable: boolean;
}

/** Público: información de la partida por su código de unión (para la pantalla de unión). */
export function gameByJoinCode(code: string): Promise<JoinGameInfo> {
  return req<JoinGameInfo>(`/games/join/${encodeURIComponent(code)}`);
}

/** Público: unirse como jugador temporal con el código de unión. */
export function joinByCode(code: string, guestName: string): Promise<{ gameId: string; participantId: string; name: string | null }> {
  return req(`/games/join/${encodeURIComponent(code)}/guest`, { method: "POST", body: JSON.stringify({ guest_name: guestName }) });
}
