/**
 * Tipos de dominio derivados de contracts/schemas/common.schema.json y de los
 * ejemplos en contracts/examples/valid/**.
 *
 * CONTRATO CONGELADO (Ola 1): estos tipos reflejan targets/v1. Cualquier cambio
 * incompatible en los esquemas exige actualizar este fichero y contracts/mqtt/README.md.
 */

export type Identifier = string; // ^[a-z0-9][a-z0-9-]{2,62}$

export type TargetState =
  | "off"
  | "safe"
  | "active"
  | "hit"
  | "countdown"
  | "penalty"
  | "error"
  | "calibration"
  | "locked"
  | "sensor_error"
  | "maintenance"
  | "disabled";

export type ModuleState =
  | "boot"
  | "selftest"
  | "network"
  | "registering"
  | "ready"
  | "calibration"
  | "maintenance"
  | "game_prepare"
  | "game_countdown"
  | "game_active"
  | "game_paused"
  | "game_finished"
  | "error";

export type HitClassification =
  | "valid_hit"
  | "hit_on_safe"
  | "hit_on_already_hit"
  | "out_of_order"
  | "crosstalk_rejected"
  | "ambiguous"
  | "during_pause"
  | "calibration_hit"
  | "early_shot";

export type ModuleRole = "principal" | "satellite" | "auto";
export type SelectorPosition = "SATELITE" | "AUTO" | "PRINCIPAL";
export type ModuleRotation = 0 | 90 | 180 | 270;

export interface ModulePosition {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

export interface DeviceTime {
  boot_id: string;
  uptime_us: number;
  event_us: number;
  epoch_ms?: number | null;
}

export interface CoordinatorTime {
  recv_us: number;
  elapsed_us: number;
  clock_offset_us: number;
  offset_uncertainty_us?: number;
}

/** Estado de una diana dentro de module-status.targets[] */
export interface TargetStatus {
  target_index: number; // 1..9
  state: TargetState;
  enabled: boolean;
}

export interface LastCommandResult {
  command_id: string;
  result: "accepted" | "rejected" | "expired" | "duplicate" | string;
}

export interface ModuleStatus {
  module_id: Identifier;
  system_id: Identifier;
  state: ModuleState;
  selector: SelectorPosition;
  role: ModuleRole;
  position: ModulePosition;
  rotation: ModuleRotation;
  targets: TargetStatus[];
  queue_depth: number;
  last_command?: LastCommandResult;
  firmware_version: string;
  uptime_s: number;
}

export interface LedChainTelemetry {
  chain: number;
  ok: boolean;
  current_ma: number;
}

export interface ModuleTelemetry {
  module_id: Identifier;
  uptime_s: number;
  free_heap_bytes: number;
  min_free_heap_bytes: number;
  cpu_load_pct: number;
  temperature_c?: number;
  voltage_5v_mv: number;
  voltage_12v_mv: number;
  link_up: boolean;
  mqtt_reconnects: number;
  queue_depth: number;
  led_chains: LedChainTelemetry[];
  device: DeviceTime;
}

export interface HitEvent {
  event_id: string;
  system_id: Identifier;
  module_id: Identifier;
  game_id: string;
  round_id: string;
  target_index: number;
  module_position: ModulePosition;
  module_rotation: ModuleRotation;
  local_sequence: number;
  device: DeviceTime;
  coordinator: CoordinatorTime;
  amplitude: number;
  threshold: number;
  noise_floor: number;
  neighbours: { target_index: number; amplitude: number; delta_us: number }[];
  target_state_before: TargetState;
  classification: HitClassification;
  firmware_version: string;
  replay: boolean;
}

export type GamePhase =
  | "idle"
  | "prepare"
  | "countdown"
  | "running"
  | "paused"
  | "finished"
  | "cancelled";

export type GameMode =
  | "random"
  | "sequence"
  | "all_vs_clock"
  | "reaction"
  | "memory"
  | "no_shoot"
  | "duel";

export interface ActiveTarget {
  module_id: Identifier;
  target_index: number;
  state: TargetState;
}

export interface GameState {
  system_id: Identifier;
  game_id: string;
  round_id: string;
  phase: GamePhase;
  mode: GameMode;
  coordinator_module_id: Identifier;
  elapsed_us: number;
  targets_remaining: number;
  targets_hit: number;
  penalties: number;
  active_targets: ActiveTarget[];
  device?: DeviceTime;
}

export type GameEventKind =
  | "target_hit"
  | "target_activated"
  | "penalty"
  | "round_started"
  | "round_finished"
  | "game_started"
  | "game_finished"
  | "game_cancelled";

export interface GameEvent {
  system_id: Identifier;
  event_id: string;
  game_id: string;
  round_id: string;
  kind: GameEventKind;
  coordinator_module_id: Identifier;
  elapsed_us: number;
  device?: DeviceTime;
  hit_event_id?: string;
  module_id?: Identifier;
  target_index?: number;
  detail?: string;
}

export type SystemState =
  | "boot"
  | "ready"
  | "degraded"
  | "conflict"
  | "game_active"
  | "maintenance"
  | "error";

export interface SystemStatus {
  system_id: Identifier;
  state: SystemState;
  coordinator_module_id: Identifier | null;
  modules_expected: number;
  modules_online: number;
  conflicts: string[];
  active_game_id: string | null;
  backend_time_ms: number;
}

export interface ModuleDiagnosticEvent {
  module_id: Identifier;
  event_id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  message: string;
  device: DeviceTime;
  detail?: Record<string, unknown>;
  firmware_version: string;
}

export interface TargetCalibration {
  target_index: number;
  threshold: number;
  hysteresis: number;
  noise_floor: number;
  blanking_us: number;
  group_window_us: number;
  neighbour_ratio: number;
  enabled: boolean;
  calibrated_at: string;
}

export interface ModuleConfig {
  module_id: Identifier;
  config_version: number;
  system_id: Identifier;
  position: ModulePosition;
  rotation: ModuleRotation;
  friendly_name: string;
  led_brightness_max: number;
  telemetry_interval_ms: number;
  network: { mode: "dhcp" | "static"; ip: string | null; netmask: string | null; gateway: string | null };
  calibration: TargetCalibration[];
}

/* ---------------------------------------------------------------------- */
/* Entidades de aplicación (jugadores, equipos, partidas) — no forman     */
/* parte del contrato MQTT; se esperan de la API REST del backend (WP-02) */
/* ---------------------------------------------------------------------- */

export interface Player {
  id: string;
  name: string;
  team_id?: string | null;
}

export interface Team {
  id: string;
  name: string;
  color: string;
}

export type AccuracyStatus = "computable" | "not_computable";

export interface AccuracyResult {
  status: AccuracyStatus;
  shots_fired: number | null;
  total_accuracy_pct: number | null;
  valid_accuracy_pct: number | null;
  reason?: string;
}

export interface GameConfig {
  mode: GameMode;
  preset_id?: string | null;
  targets: { module_id: Identifier; target_index: number }[];
  player_ids: string[];
  team_ids: string[];
  ammo_initial: number | null;
  countdown_ms: number;
  time_limit_ms: number | null;
  penalty_ms: number;
  strict_order: boolean;
}

export interface GameResultRow {
  player_id: string;
  hits_valid: number;
  hits_incorrect: number;
  penalties: number;
  total_time_ms: number;
  accuracy: AccuracyResult;
}

export interface GameSummary {
  game_id: string;
  system_id: Identifier;
  mode: GameMode;
  started_at: string;
  finished_at: string | null;
  phase: GamePhase;
  results: GameResultRow[];
}

export interface FirmwareRelease {
  version: string;
  url: string;
  size_bytes: number;
  sha256: string;
  target_board: string;
  released_at: string;
}

export interface UserAccount {
  id: string;
  username: string;
  role: "admin" | "operator" | "viewer";
  active: boolean;
}

export interface BackupInfo {
  id: string;
  created_at: string;
  size_bytes: number;
  kind: "auto" | "manual";
}
