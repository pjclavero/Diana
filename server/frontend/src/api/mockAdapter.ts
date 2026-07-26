import type {
  CommandAck,
  DiagnosticResults,
  DianaApiClient,
  GamePreset,
  Incident,
  Topology,
} from "./client";
import { ApiError } from "./client";
import type {
  BackupInfo,
  FirmwareRelease,
  GameConfig,
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
import {
  MOCK_BACKUPS,
  MOCK_DIAGNOSTICS,
  MOCK_FIRMWARE,
  MOCK_INCIDENTS,
  MOCK_MODULES,
  MOCK_MODULE_CONFIG,
  MOCK_PLAYERS,
  MOCK_PRESETS,
  MOCK_RESULTS,
  MOCK_SYSTEM_ID,
  MOCK_SYSTEM_STATUS,
  MOCK_TEAMS,
  MOCK_TELEMETRY,
  MOCK_TOPOLOGY,
  MOCK_USERS,
} from "./mockData";
import { mockGameEngine } from "./mockGameEngine";

const LATENCY_MS = 120;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

let players = clone(MOCK_PLAYERS);
let teams = clone(MOCK_TEAMS);
let topology = clone(MOCK_TOPOLOGY);
let incidents = clone(MOCK_INCIDENTS);
let idCounter = 1000;

export const mockApiClient: DianaApiClient = {
  async getSystemStatus(systemId: string): Promise<SystemStatus> {
    if (systemId !== MOCK_SYSTEM_ID) {
      throw new ApiError("No se encuentra ese sistema.");
    }
    return delay(clone(MOCK_SYSTEM_STATUS));
  },

  async listSystems(): Promise<SystemStatus[]> {
    return delay([clone(MOCK_SYSTEM_STATUS)]);
  },

  async listModules(): Promise<ModuleStatus[]> {
    return delay(clone(MOCK_MODULES));
  },

  async getModule(moduleId: string): Promise<ModuleStatus> {
    const m = MOCK_MODULES.find((x) => x.module_id === moduleId);
    if (!m) throw new ApiError(`No se encuentra el módulo ${moduleId}.`);
    return delay(clone(m));
  },

  async getModuleTelemetry(moduleId: string): Promise<ModuleTelemetry> {
    const t = MOCK_TELEMETRY[moduleId];
    if (!t) throw new ApiError(`Sin telemetría para el módulo ${moduleId}.`);
    return delay(clone(t));
  },

  async getModuleConfig(moduleId: string): Promise<ModuleConfig> {
    const c = MOCK_MODULE_CONFIG[moduleId];
    if (!c) throw new ApiError(`Sin configuración para el módulo ${moduleId}.`);
    return delay(clone(c));
  },

  async updateModuleConfig(moduleId: string, patch: Partial<ModuleConfig>): Promise<ModuleConfig> {
    const c = MOCK_MODULE_CONFIG[moduleId];
    if (!c) throw new ApiError(`Sin configuración para el módulo ${moduleId}.`);
    Object.assign(c, patch, { config_version: c.config_version + 1 });
    return delay(clone(c));
  },

  async identifyModule(moduleId: string): Promise<{ command_id: string }> {
    idCounter += 1;
    return delay({ command_id: `mock-cmd-${moduleId}-${idCounter}` });
  },

  async calibrateTarget(): Promise<{ command_id: string }> {
    idCounter += 1;
    return delay({ command_id: `mock-cmd-${idCounter}` });
  },

  async testSensor(): Promise<CommandAck> {
    idCounter += 1;
    // El simulacro tampoco inventa una amplitud: se comporta como el real.
    return delay({
      command_id: `mock-cmd-${idCounter}`,
      delivered: true,
      scope: "module" as const,
      note: "Orden simulada. El resultado llegaría por `diagnostic`.",
    });
  },

  async getModuleDiagnostics(moduleId: string): Promise<DiagnosticResults> {
    return delay({
      module: moduleId,
      items: [],
      note: "Simulación: ningún módulo real ha respondido.",
    });
  },

  async testLed(): Promise<{ command_id: string }> {
    idCounter += 1;
    return delay({ command_id: `mock-cmd-${idCounter}` });
  },

  async getTopology(): Promise<Topology> {
    return delay(clone(topology));
  },

  async saveTopology(next: Topology): Promise<Topology> {
    topology = clone(next);
    topology.saved_at = new Date().toISOString();
    return delay(clone(topology));
  },

  async listPlayers(): Promise<Player[]> {
    return delay(clone(players));
  },

  async createPlayer(p: Omit<Player, "id">): Promise<Player> {
    const created: Player = { ...p, id: `p-${++idCounter}` };
    players = [...players, created];
    return delay(clone(created));
  },

  async listTeams(): Promise<Team[]> {
    return delay(clone(teams));
  },

  async createTeam(t: Omit<Team, "id">): Promise<Team> {
    const created: Team = { ...t, id: `t-${++idCounter}` };
    teams = [...teams, created];
    return delay(clone(created));
  },

  async listPresets(): Promise<GamePreset[]> {
    return delay(clone(MOCK_PRESETS));
  },

  async createGame(config: GameConfig): Promise<GameSummary> {
    const summary = mockGameEngine.createGame(config);
    return delay(clone(summary));
  },

  async startGame(gameId: string): Promise<GameState> {
    const state = mockGameEngine.start(gameId);
    return delay(clone(state));
  },

  async pauseGame(gameId: string): Promise<GameState> {
    const state = mockGameEngine.pause(gameId);
    return delay(clone(state));
  },

  async cancelGame(gameId: string): Promise<GameState> {
    const state = mockGameEngine.cancel(gameId);
    return delay(clone(state));
  },

  async getGameState(gameId: string): Promise<GameState> {
    return delay(clone(mockGameEngine.getState(gameId)));
  },

  async getGameResult(gameId: string): Promise<GameSummary> {
    return delay(clone(mockGameEngine.getSummary(gameId)));
  },

  async listResults(): Promise<GameSummary[]> {
    return delay(clone([...MOCK_RESULTS, ...mockGameEngine.finishedSummaries()]));
  },

  async listDiagnostics(moduleId?: string): Promise<ModuleDiagnosticEvent[]> {
    const all = clone(MOCK_DIAGNOSTICS);
    return delay(moduleId ? all.filter((d) => d.module_id === moduleId) : all);
  },

  async listFirmware(): Promise<FirmwareRelease[]> {
    return delay(clone(MOCK_FIRMWARE));
  },

  async listIncidents(): Promise<Incident[]> {
    return delay(clone(incidents));
  },

  async resolveIncident(id: string): Promise<Incident> {
    const inc = incidents.find((i) => i.id === id);
    if (!inc) throw new ApiError("No se encuentra esa incidencia.");
    inc.resolved = true;
    return delay(clone(inc));
  },

  async listUsers(): Promise<UserAccount[]> {
    return delay(clone(MOCK_USERS));
  },

  async listBackups(): Promise<BackupInfo[]> {
    return delay(clone(MOCK_BACKUPS));
  },

  async triggerBackup(): Promise<BackupInfo> {
    const backup: BackupInfo = { id: `b-${++idCounter}`, created_at: new Date().toISOString(), size_bytes: 15_100_000, kind: "manual" };
    return delay(backup);
  },
};
