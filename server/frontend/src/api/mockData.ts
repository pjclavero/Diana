import type {
  BackupInfo,
  FirmwareRelease,
  GameSummary,
  ModuleConfig,
  ModuleDiagnosticEvent,
  ModuleStatus,
  ModuleTelemetry,
  Player,
  SystemStatus,
  Team,
  TargetState,
  UserAccount,
} from "../types/domain";
import type { GamePreset, Incident, Topology } from "./client";

/** Datos de ejemplo DETERMINISTAS (sin Math.random ni Date.now en los valores base). */

export const MOCK_SYSTEM_ID = "system-a";

const TARGET_STATE_CYCLE: TargetState[] = ["safe", "safe", "safe", "active", "safe", "safe", "hit", "safe", "safe"];

function buildModule(id: string, x: -1 | 0 | 1, y: -1 | 0 | 1, rotation: 0 | 90 | 180 | 270, role: ModuleStatus["role"]): ModuleStatus {
  return {
    module_id: id,
    system_id: MOCK_SYSTEM_ID,
    state: "ready",
    selector: role === "principal" ? "PRINCIPAL" : "SATELITE",
    role,
    position: { x, y },
    rotation,
    targets: TARGET_STATE_CYCLE.map((state, i) => ({ target_index: i + 1, state, enabled: true })),
    queue_depth: 0,
    last_command: { command_id: "00000000-0000-4000-8000-000000000000", result: "accepted" },
    firmware_version: "0.3.1",
    uptime_s: 5400 + id.length * 37,
  };
}

export const MOCK_MODULES: ModuleStatus[] = [
  buildModule("module-01", 0, 0, 0, "principal"),
  buildModule("module-02", 1, 0, 90, "satellite"),
  buildModule("module-03", -1, 0, 90, "satellite"),
  buildModule("module-04", 0, -1, 0, "satellite"),
  buildModule("module-05", 0, 1, 180, "satellite"),
];

export const MOCK_SYSTEM_STATUS: SystemStatus = {
  system_id: MOCK_SYSTEM_ID,
  state: "ready",
  coordinator_module_id: "module-01",
  modules_expected: 9,
  modules_online: MOCK_MODULES.length,
  conflicts: [],
  active_game_id: null,
  backend_time_ms: Date.UTC(2026, 6, 20, 12, 0, 0),
};

export const MOCK_TELEMETRY: Record<string, ModuleTelemetry> = Object.fromEntries(
  MOCK_MODULES.map((m) => [
    m.module_id,
    {
      module_id: m.module_id,
      uptime_s: m.uptime_s,
      free_heap_bytes: 210000,
      min_free_heap_bytes: 195000,
      cpu_load_pct: 14.2,
      temperature_c: 39.5,
      voltage_5v_mv: 4990,
      voltage_12v_mv: 12050,
      link_up: true,
      mqtt_reconnects: 0,
      queue_depth: 0,
      led_chains: [
        { chain: 0, ok: true, current_ma: 380 },
        { chain: 1, ok: true, current_ma: 380 },
        { chain: 2, ok: true, current_ma: 380 },
      ],
      device: { boot_id: "9c4f5f71-9e4d-4c5b-ae60-4d5e6f708192", uptime_us: m.uptime_s * 1_000_000, event_us: m.uptime_s * 1_000_000 },
    } satisfies ModuleTelemetry,
  ]),
);

export const MOCK_MODULE_CONFIG: Record<string, ModuleConfig> = Object.fromEntries(
  MOCK_MODULES.map((m) => [
    m.module_id,
    {
      module_id: m.module_id,
      config_version: 3,
      system_id: MOCK_SYSTEM_ID,
      position: m.position,
      rotation: m.rotation,
      friendly_name: `Módulo ${m.module_id.slice(-2)}`,
      led_brightness_max: 120,
      telemetry_interval_ms: 1000,
      network: { mode: "dhcp", ip: null, netmask: null, gateway: null },
      calibration: Array.from({ length: 9 }, (_, i) => ({
        target_index: i + 1,
        threshold: 900 + i,
        hysteresis: 80,
        noise_floor: 140,
        blanking_us: 60000,
        group_window_us: 2000,
        neighbour_ratio: 0.35,
        enabled: true,
        calibrated_at: "2026-07-20T10:00:00Z",
      })),
    } satisfies ModuleConfig,
  ]),
);

export const MOCK_TOPOLOGY: Topology = {
  system_id: MOCK_SYSTEM_ID,
  name: "Disposición estándar",
  saved_at: "2026-07-20T09:00:00Z",
  slots: [
    { module_id: "module-03", position: { x: -1, y: -1 }, rotation: 0, locked: false, out_of_service: false },
    { module_id: "module-04", position: { x: 0, y: -1 }, rotation: 0, locked: false, out_of_service: false },
    { module_id: null, position: { x: 1, y: -1 }, rotation: 0, locked: false, out_of_service: false },
    { module_id: "module-03b", position: { x: -1, y: 0 }, rotation: 90, locked: false, out_of_service: false },
    { module_id: "module-01", position: { x: 0, y: 0 }, rotation: 0, locked: true, out_of_service: false },
    { module_id: "module-02", position: { x: 1, y: 0 }, rotation: 90, locked: false, out_of_service: false },
    { module_id: null, position: { x: -1, y: 1 }, rotation: 0, locked: false, out_of_service: false },
    { module_id: "module-05", position: { x: 0, y: 1 }, rotation: 180, locked: false, out_of_service: false },
    { module_id: null, position: { x: 1, y: 1 }, rotation: 0, locked: false, out_of_service: false },
  ],
};

export const MOCK_PLAYERS: Player[] = [
  { id: "p1", name: "Ana García", team_id: "t1" },
  { id: "p2", name: "Luis Pérez", team_id: "t1" },
  { id: "p3", name: "Marta Ruiz", team_id: "t2" },
  { id: "p4", name: "Carlos Díaz", team_id: "t2" },
  { id: "p5", name: "Sofía Torres", team_id: null },
];

export const MOCK_TEAMS: Team[] = [
  { id: "t1", name: "Águilas", color: "#2563eb" },
  { id: "t2", name: "Halcones", color: "#dc2626" },
];

export const MOCK_PRESETS: GamePreset[] = [
  {
    id: "preset-random-9",
    name: "9 dianas aleatorias",
    config: { mode: "random", targets: MOCK_MODULES[0].targets.map((t) => ({ module_id: "module-01", target_index: t.target_index })) },
  },
  {
    id: "preset-clock-full",
    name: "Todas contra reloj",
    config: { mode: "all_vs_clock" },
  },
  {
    id: "preset-reaction",
    name: "Reacción individual",
    config: { mode: "reaction" },
  },
];

export const MOCK_RESULTS: GameSummary[] = [
  {
    game_id: "game-1001",
    system_id: MOCK_SYSTEM_ID,
    mode: "random",
    started_at: "2026-07-19T18:00:00Z",
    finished_at: "2026-07-19T18:04:12Z",
    phase: "finished",
    results: [
      {
        player_id: "p1",
        hits_valid: 8,
        hits_incorrect: 1,
        penalties: 0,
        total_time_ms: 42300,
        accuracy: { status: "computable", shots_fired: 9, total_accuracy_pct: 100, valid_accuracy_pct: 88.9 },
      },
      {
        player_id: "p2",
        hits_valid: 6,
        hits_incorrect: 2,
        penalties: 1,
        total_time_ms: 51000,
        accuracy: { status: "not_computable", shots_fired: null, total_accuracy_pct: null, valid_accuracy_pct: null, reason: "Se desconoce el número real de disparos" },
      },
    ],
  },
];

export const MOCK_DIAGNOSTICS: ModuleDiagnosticEvent[] = [
  {
    module_id: "module-03",
    event_id: "diag-1",
    kind: "low_voltage",
    severity: "warning",
    message: "5V por debajo de 4.6V durante 200ms",
    device: { boot_id: "9c4f5f71-9e4d-4c5b-ae60-4d5e6f708192", uptime_us: 1832456789, event_us: 1832456712 },
    detail: { voltage_5v_mv: 4550, duration_ms: 200 },
    firmware_version: "0.3.1",
  },
];

export const MOCK_FIRMWARE: FirmwareRelease[] = [
  {
    version: "0.3.1",
    url: "http://192.168.1.209/firmware/diana-esp32s3-0.3.1.bin",
    size_bytes: 1048576,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    target_board: "esp32s3-w5500-protoA",
    released_at: "2026-07-15T00:00:00Z",
  },
];

export const MOCK_INCIDENTS: Incident[] = [
  {
    id: "inc-1",
    created_at: "2026-07-20T08:12:00Z",
    severity: "warning",
    source: "module-03",
    message: "Tensión de 5V inestable durante 200ms",
    resolved: false,
  },
];

export const MOCK_USERS: UserAccount[] = [
  { id: "u1", username: "operador1", role: "operator", active: true },
  { id: "u2", username: "admin", role: "admin", active: true },
];

export const MOCK_BACKUPS: BackupInfo[] = [
  { id: "b1", created_at: "2026-07-20T04:00:00Z", size_bytes: 15_000_000, kind: "auto" },
  { id: "b2", created_at: "2026-07-19T04:00:00Z", size_bytes: 14_800_000, kind: "auto" },
];
