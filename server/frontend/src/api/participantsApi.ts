import { apiRequestAs } from "./typedRequest";

/**
 * API REAL de participantes y partidas (G-D.2).
 *
 * MIGRADO a la puerta del contrato. Prioridad: `listGames` desenvuelve
 * `{items}` de `/api/games` (fallo silencioso de tabla vacía).
 */

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
  const page = await apiRequestAs<{ items: GameLite[] }>()("/api/games", "/api/games?take=100");
  return page.items;
}

export function listParticipants(gameId: string): Promise<Participant[]> {
  return apiRequestAs<Participant[]>()("/api/participants", `/api/participants?gameId=${encodeURIComponent(gameId)}`);
}

export function addRegisteredParticipant(gameId: string, playerId: string): Promise<Participant> {
  return apiRequestAs<Participant>()<"/api/participants", "post">("/api/participants", "/api/participants", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, player_id: playerId }),
  });
}

export function addTemporaryParticipant(gameId: string, guestName: string): Promise<Participant> {
  return apiRequestAs<Participant>()<"/api/participants", "post">("/api/participants", "/api/participants", {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, guest_name: guestName }),
  });
}

export function setParticipantTeam(id: string, teamId: string | null): Promise<Participant> {
  return apiRequestAs<Participant>()<"/api/participants/{id}/team", "patch">(
    "/api/participants/{id}/team",
    `/api/participants/${id}/team`,
    { method: "PATCH", body: JSON.stringify({ team_id: teamId }) },
  );
}

export function setParticipantPanel(id: string, targetSystemId: string | null): Promise<Participant> {
  return apiRequestAs<Participant>()<"/api/participants/{id}/panel", "patch">(
    "/api/participants/{id}/panel",
    `/api/participants/${id}/panel`,
    { method: "PATCH", body: JSON.stringify({ target_system_id: targetSystemId }) },
  );
}

export function removeParticipant(id: string): Promise<void> {
  return apiRequestAs<void>()<"/api/participants/{id}", "delete">(
    "/api/participants/{id}",
    `/api/participants/${id}`,
    { method: "DELETE" },
  );
}

// --- Unirse por QR (G-D) ---

export function ensureJoinCode(gameId: string, regenerate = false): Promise<{ id: string; joinCode: string }> {
  const url = regenerate
    ? (`/api/games/${gameId}/join-code?regenerate=1` as const)
    : (`/api/games/${gameId}/join-code` as const);
  return apiRequestAs<{ id: string; joinCode: string }>()<"/api/games/{id}/join-code", "post">(
    "/api/games/{id}/join-code",
    url,
    { method: "POST" },
  );
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
  return apiRequestAs<JoinGameInfo>()("/api/games/join/{code}", `/api/games/join/${encodeURIComponent(code)}`);
}

/** Público: unirse como jugador temporal con el código de unión. */
export function joinByCode(code: string, guestName: string): Promise<{ gameId: string; participantId: string; name: string | null }> {
  return apiRequestAs<{ gameId: string; participantId: string; name: string | null }>()<
    "/api/games/join/{code}/guest",
    "post"
  >("/api/games/join/{code}/guest", `/api/games/join/${encodeURIComponent(code)}/guest`, {
    method: "POST",
    body: JSON.stringify({ guest_name: guestName }),
  });
}
