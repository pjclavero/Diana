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

/**
 * Capa de cliente API tipada y AISLADA. Ninguna pantalla debe importar
 * directamente `fetch`, `mockAdapter` ni `realAdapter`: todo pasa por este
 * contrato, de forma que cambiar de mock a API real (VITE_API_MODE) no
 * requiere tocar ninguna pantalla.
 *
 * Ver server/frontend/README.md para el contrato de endpoints REST que se
 * espera del backend (WP-02, Ola 2).
 */
export interface Incident {
  id: string;
  created_at: string;
  severity: "info" | "warning" | "critical";
  source: string;
  message: string;
  resolved: boolean;
}

export interface TopologySlot {
  module_id: string | null;
  position: { x: -1 | 0 | 1; y: -1 | 0 | 1 };
  rotation: 0 | 90 | 180 | 270;
  locked: boolean;
  out_of_service: boolean;
}

export interface Topology {
  system_id: string;
  slots: TopologySlot[];
  saved_at: string | null;
  name: string;
}

export interface GamePreset {
  id: string;
  name: string;
  config: Partial<GameConfig>;
}

export interface DianaApiClient {
  // --- Sistema ---
  getSystemStatus(systemId: string): Promise<SystemStatus>;
  listSystems(): Promise<SystemStatus[]>;

  // --- Módulos ---
  listModules(systemId: string): Promise<ModuleStatus[]>;
  getModule(moduleId: string): Promise<ModuleStatus>;
  getModuleTelemetry(moduleId: string): Promise<ModuleTelemetry>;
  getModuleConfig(moduleId: string): Promise<ModuleConfig>;
  updateModuleConfig(moduleId: string, patch: Partial<ModuleConfig>): Promise<ModuleConfig>;
  identifyModule(moduleId: string, durationMs?: number): Promise<{ command_id: string }>;
  calibrateTarget(moduleId: string, targetIndex: number): Promise<{ command_id: string }>;
  testSensor(moduleId: string, targetIndex: number): Promise<{ ok: boolean; amplitude: number }>;
  testLed(moduleId: string, targetIndex: number, pattern: string): Promise<{ command_id: string }>;

  // --- Topología ---
  getTopology(systemId: string): Promise<Topology>;
  saveTopology(topology: Topology): Promise<Topology>;

  // --- Jugadores y equipos ---
  listPlayers(): Promise<Player[]>;
  createPlayer(p: Omit<Player, "id">): Promise<Player>;
  listTeams(): Promise<Team[]>;
  createTeam(t: Omit<Team, "id">): Promise<Team>;

  // --- Partidas ---
  listPresets(): Promise<GamePreset[]>;
  createGame(config: GameConfig): Promise<GameSummary>;
  startGame(gameId: string): Promise<GameState>;
  pauseGame(gameId: string): Promise<GameState>;
  cancelGame(gameId: string): Promise<GameState>;
  getGameState(gameId: string): Promise<GameState>;
  getGameResult(gameId: string): Promise<GameSummary>;
  listResults(): Promise<GameSummary[]>;

  // --- Diagnóstico ---
  listDiagnostics(moduleId?: string): Promise<ModuleDiagnosticEvent[]>;

  // --- Firmware ---
  listFirmware(): Promise<FirmwareRelease[]>;

  // --- Incidencias ---
  listIncidents(): Promise<Incident[]>;
  resolveIncident(id: string): Promise<Incident>;

  // --- Usuarios ---
  listUsers(): Promise<UserAccount[]>;

  // --- Copias y estado del sistema ---
  listBackups(): Promise<BackupInfo[]>;
  triggerBackup(): Promise<BackupInfo>;
}

export class ApiError extends Error {
  /** Mensaje ya adaptado para un operador, sin trazas técnicas. */
  readonly userMessage: string;
  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.userMessage = userMessage;
    this.cause = cause;
  }
}
