import type { DianaApiClient, GamePreset, Incident, Topology } from "./client";
import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";
import type {
  BackupInfo,
  FirmwareRelease,
  GameState,
  GameSummary,
  ModuleConfig,
  ModuleDiagnosticEvent,
  ModuleStatus,
  ModuleTelemetry,
  Player,
  SystemStatus,
  Team,
  UserAccount,
} from "../types/domain";

/**
 * Adaptador REST real. Implementa exactamente `DianaApiClient` contra los
 * endpoints documentados en server/frontend/README.md § "Contrato con el
 * backend". Ningún endpoint aquí está inventado sin documentarlo allí.
 */
async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const token = getToken();
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers as Record<string, string>),
      },
    });
  } catch {
    throw new ApiError("No se puede contactar con el servidor. Compruebe la conexión de red.");
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string };
      detail = body.message ?? "";
    } catch {
      // sin cuerpo interpretable
    }
    if (res.status === 401 || res.status === 403) {
      throw new ApiError("No tiene permiso para realizar esta acción.");
    }
    if (res.status === 404) {
      throw new ApiError("No se ha encontrado el recurso solicitado.");
    }
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createRealApiClient(baseUrl: string): DianaApiClient {
  const r = <T>(path: string, init?: RequestInit) => request<T>(baseUrl, path, init);

  return {
    getSystemStatus: (systemId) => r<SystemStatus>(`/systems/${systemId}`),
    listSystems: () => r<SystemStatus[]>("/systems"),

    listModules: (systemId) => r<ModuleStatus[]>(`/systems/${systemId}/modules`),
    getModule: (moduleId) => r<ModuleStatus>(`/modules/${moduleId}`),
    getModuleTelemetry: (moduleId) => r<ModuleTelemetry>(`/modules/${moduleId}/telemetry`),
    getModuleConfig: (moduleId) => r<ModuleConfig>(`/modules/${moduleId}/config`),
    updateModuleConfig: (moduleId, patch) =>
      r<ModuleConfig>(`/modules/${moduleId}/config`, { method: "PATCH", body: JSON.stringify(patch) }),
    identifyModule: (moduleId, durationMs) =>
      r<{ command_id: string }>(`/modules/${moduleId}/commands/identify`, {
        method: "POST",
        body: JSON.stringify({ duration_ms: durationMs ?? 4000 }),
      }),
    calibrateTarget: (moduleId, targetIndex) =>
      r<{ command_id: string }>(`/modules/${moduleId}/targets/${targetIndex}/calibrate`, { method: "POST" }),
    testSensor: (moduleId, targetIndex) =>
      r<{ ok: boolean; amplitude: number }>(`/modules/${moduleId}/targets/${targetIndex}/test-sensor`, { method: "POST" }),
    testLed: (moduleId, targetIndex, pattern) =>
      r<{ command_id: string }>(`/modules/${moduleId}/targets/${targetIndex}/test-led`, {
        method: "POST",
        body: JSON.stringify({ pattern }),
      }),

    getTopology: (systemId) => r<Topology>(`/systems/${systemId}/topology`),
    saveTopology: (topology) => r<Topology>(`/systems/${topology.system_id}/topology`, { method: "PUT", body: JSON.stringify(topology) }),

    listPlayers: () => r<Player[]>("/players"),
    createPlayer: (p) => r<Player>("/players", { method: "POST", body: JSON.stringify(p) }),
    listTeams: () => r<Team[]>("/teams"),
    createTeam: (t) => r<Team>("/teams", { method: "POST", body: JSON.stringify(t) }),

    listPresets: () => r<GamePreset[]>("/game-presets"),
    createGame: (config) => r<GameSummary>("/games", { method: "POST", body: JSON.stringify(config) }),
    startGame: (gameId) => r<GameState>(`/games/${gameId}/start`, { method: "POST" }),
    pauseGame: (gameId) => r<GameState>(`/games/${gameId}/pause`, { method: "POST" }),
    cancelGame: (gameId) => r<GameState>(`/games/${gameId}/cancel`, { method: "POST" }),
    getGameState: (gameId) => r<GameState>(`/games/${gameId}/state`),
    getGameResult: (gameId) => r<GameSummary>(`/games/${gameId}/result`),
    listResults: () => r<GameSummary[]>("/games?phase=finished"),

    listDiagnostics: (moduleId) => r<ModuleDiagnosticEvent[]>(moduleId ? `/modules/${moduleId}/diagnostics` : "/diagnostics"),

    listFirmware: () => r<FirmwareRelease[]>("/firmware"),

    listIncidents: () => r<Incident[]>("/incidents"),
    resolveIncident: (id) => r<Incident>(`/incidents/${id}/resolve`, { method: "POST" }),

    listUsers: () => r<UserAccount[]>("/users"),

    listBackups: () => r<BackupInfo[]>("/backups"),
    triggerBackup: () => r<BackupInfo>("/backups", { method: "POST" }),
  };
}
