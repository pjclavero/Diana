import { apiRequestAs } from "./typedRequest";

/**
 * API REAL de jugadores y equipos (G-D). Contra `/api/players*` y `/api/teams`.
 *
 * MIGRADO a la puerta del contrato (`apiRequest`/`apiRequestAs`): ya no tiene
 * función de llamada propia. Cualquier ruta que el backend renombre o retire
 * deja de compilar aquí. Prioridad de migración: `listTeams` desenvuelve
 * `{items}`, que es la forma que produce el fallo silencioso de tabla vacía.
 */

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
  const url = q ? (`/api/players/search?q=${encodeURIComponent(q)}` as const) : ("/api/players/search" as const);
  return apiRequestAs<PlayerRow[]>()("/api/players/search", url);
}

export function createPlayer(payload: { displayName: string; teamId?: string | null }): Promise<{ id: string }> {
  return apiRequestAs<{ id: string }>()<"/api/players", "post">("/api/players", "/api/players", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Asigna o cambia el equipo de un jugador (o lo deja sin equipo con null). */
export function setPlayerTeam(id: string, teamId: string | null): Promise<{ id: string }> {
  return apiRequestAs<{ id: string }>()<"/api/players/{id}", "patch">(
    "/api/players/{id}",
    `/api/players/${id}`,
    { method: "PATCH", body: JSON.stringify({ teamId }) },
  );
}

export async function listTeams(): Promise<Team[]> {
  const page = await apiRequestAs<{ items: Team[] }>()("/api/teams", "/api/teams?take=500&orderBy=name&order=asc");
  return page.items;
}

export function createTeam(payload: { name: string; description?: string }): Promise<Team> {
  return apiRequestAs<Team>()<"/api/teams", "post">("/api/teams", "/api/teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
