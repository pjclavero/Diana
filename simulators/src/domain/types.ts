export type TargetState =
  | 'off'
  | 'safe'
  | 'active'
  | 'hit'
  | 'countdown'
  | 'penalty'
  | 'error'
  | 'calibration'
  | 'locked'
  | 'sensor_error'
  | 'maintenance'
  | 'disabled';

export type ModuleState =
  | 'boot'
  | 'selftest'
  | 'network'
  | 'registering'
  | 'ready'
  | 'calibration'
  | 'maintenance'
  | 'game_prepare'
  | 'game_countdown'
  | 'game_active'
  | 'game_paused'
  | 'game_finished'
  | 'error';

export type SelectorPosition = 'SATELITE' | 'AUTO' | 'PRINCIPAL';
export type ModuleRole = 'principal' | 'satellite' | 'auto';

export type HitClassification =
  | 'valid_hit'
  | 'hit_on_safe'
  | 'hit_on_already_hit'
  | 'out_of_order'
  | 'crosstalk_rejected'
  | 'ambiguous'
  | 'during_pause'
  | 'calibration_hit'
  | 'early_shot';

export interface ModulePosition {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

export type ModuleRotation = 0 | 90 | 180 | 270;

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

export interface HitEventPayload {
  schema_version: 1;
  event_id: string;
  system_id: string;
  module_id: string;
  game_id?: string;
  round_id?: string;
  target_index: number;
  module_position?: ModulePosition;
  module_rotation?: ModuleRotation;
  local_sequence: number;
  device: DeviceTime;
  coordinator: CoordinatorTime | null;
  amplitude: number;
  threshold: number;
  noise_floor?: number;
  neighbours?: { target_index: number; amplitude: number; delta_us: number }[];
  target_state_before: TargetState;
  classification: HitClassification;
  classification_reason?: string;
  firmware_version: string;
  replay?: boolean;
}

export interface TargetSlot {
  target_index: number;
  state: TargetState;
  enabled: boolean;
}

export interface ModuleStatusPayload {
  schema_version: 1;
  module_id: string;
  system_id: string | null;
  state: ModuleState;
  selector: SelectorPosition;
  role: ModuleRole;
  position: ModulePosition | null;
  rotation: ModuleRotation;
  targets: TargetSlot[];
  queue_depth: number;
  last_command: { command_id: string; result: string; detail?: string } | null;
  firmware_version: string;
  uptime_s: number;
}

export interface ModulePresencePayload {
  schema_version: 1;
  module_id: string;
  online: boolean;
  reason: 'connect' | 'shutdown' | 'lwt';
  boot_id?: string | null;
  firmware_version?: string | null;
  hardware_revision?: string | null;
  mac?: string | null;
  ip?: string | null;
  serial?: string | null;
}
