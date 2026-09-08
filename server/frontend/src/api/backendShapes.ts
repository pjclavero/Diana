import type { GameMode, GamePhase, GameSummary, ModuleConfig, ModuleStatus } from "../types/domain";
import type { GamePreset, Incident } from "./client";

/**
 * TRADUCCIÓN de las filas que devuelve el backend REST al vocabulario del
 * panel, en la frontera y en un solo sitio.
 *
 * Por qué existe este fichero. `realAdapter` venía afirmando con
 * `apiRequestAs<ModuleStatus>()` que `/api/modules` devuelve un `ModuleStatus`.
 * No lo devuelve: `ModuleStatus` es la forma del CONTRATO MQTT (`module_id`,
 * `targets`, `queue_depth`…) y el REST devuelve la FILA de Prisma
 * (`id`, `slug`, `friendlyName`, `targetSystemId`…). Como el contrato OpenAPI
 * no declara todavía la forma de ninguna ruta (ver `./README.md`), la
 * afirmación compilaba y nadie la comprobaba: en cuanto el panel se
 * despliegue en modo `real`, `module.module_id` sería `undefined` y la
 * pantalla pintaría huecos en vez de dar un error.
 *
 * Estas funciones son PURAS y se prueban solas. Lo que no se puede deducir de
 * la fila NO se inventa: se deja nulo o vacío y el consumidor lo trata como
 * ausencia, no como cero.
 */

/** Lo que de verdad devuelve `GET /api/modules` y `GET /api/modules/{id}`. */
export interface FilaModulo {
  id: string;
  slug: string;
  targetSystemId?: string | null;
  friendlyName?: string | null;
  firmwareVersion?: string | null;
  role?: string | null;
  selector?: string | null;
  state?: string | null;
  online?: boolean;
  queueDepth?: number;
  maintenance?: boolean;
  position?: { x: number; y: number; rotation?: number } | null;
  targets?: Array<{ index?: number; targetIndex?: number; state?: string | null }>;
}

/** Lo que devuelve `GET /api/maintenance/incidents`. */
export interface FilaIncidencia {
  id: string;
  kind: string;
  severity: string;
  source: string;
  message: string;
  occurredAt: string;
  resolvedAt?: string | null;
}

/** Lo que devuelve `GET /api/presets`. */
export interface FilaPreset {
  id: string;
  name: string;
  config?: Record<string, unknown> | null;
  gameMode?: { key?: string | null } | null;
}

/** Lo que devuelve `GET /api/games` y `GET /api/games/{id}`. */
export interface FilaPartida {
  id: string;
  targetSystemId: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string | null;
  gameMode?: { key?: string | null } | null;
}

/** Lo que devuelve `GET /api/modules/{id}/config/desired`. */
export interface ConfiguracionDeseada {
  module_id?: string;
  config_version?: number;
  system_id?: string | null;
  friendly_name?: string | null;
  network?: { mode?: string; ip?: string | null; netmask?: string | null; gateway?: string | null } | null;
  calibration?: ModuleConfig["calibration"];
  [extra: string]: unknown;
}

/**
 * `status` de Prisma → `GamePhase` del panel. Es la misma tabla que ya
 * traduce el canal en directo (`liveContract.ts`): `aborted` es `cancelled`
 * para el panel, y no traducirlo dejaba las partidas abortadas «corriendo»
 * para siempre en pantalla.
 */
const FASE: Record<string, GamePhase> = {
  draft: "idle",
  armed: "prepare",
  running: "running",
  paused: "paused",
  finished: "finished",
  aborted: "cancelled",
};

const MODOS: GameMode[] = ["random", "sequence", "all_against_clock", "reaction", "duelo"];

export function faseDeEstado(status: string | null | undefined): GamePhase {
  return FASE[status ?? ""] ?? "idle";
}

function modo(clave: string | null | undefined): GameMode {
  return MODOS.includes(clave as GameMode) ? (clave as GameMode) : "random";
}

const ESTADOS_MODULO: ModuleStatus["state"][] = [
  "boot",
  "selftest",
  "network",
  "registering",
  "ready",
  "calibration",
  "maintenance",
  "game_prepare",
  "game_countdown",
  "game_active",
  "game_paused",
  "game_finished",
  "error",
];

export function aModuleStatus(fila: FilaModulo): ModuleStatus {
  const posicion = fila.position ?? null;
  const estado = ESTADOS_MODULO.includes(fila.state as ModuleStatus["state"])
    ? (fila.state as ModuleStatus["state"])
    : // Un módulo sin estado declarado NO es un módulo «listo»: es un módulo
      // del que no se sabe nada. `boot` es el estado más neutro del contrato;
      // afirmar `ready` sería exactamente el fallo que este carril persigue.
      "boot";
  return {
    module_id: fila.slug,
    system_id: fila.targetSystemId ?? "",
    state: fila.maintenance ? "maintenance" : estado,
    selector: (fila.selector as ModuleStatus["selector"]) ?? "AUTO",
    role: (fila.role as ModuleStatus["role"]) ?? "satellite",
    position: {
      x: (posicion?.x ?? 0) as ModuleStatus["position"]["x"],
      y: (posicion?.y ?? 0) as ModuleStatus["position"]["y"],
    },
    rotation: (posicion?.rotation ?? 0) as ModuleStatus["rotation"],
    targets: (fila.targets ?? []).map((t, i) => ({
      target_index: t.targetIndex ?? t.index ?? i + 1,
      state: (t.state as ModuleStatus["targets"][number]["state"]) ?? "off",
      // El REST no dice si la diana está habilitada; no se inventa un `true`.
      enabled: t.state != null,
    })),
    queue_depth: fila.queueDepth ?? 0,
    firmware_version: fila.firmwareVersion ?? "",
    // El REST no lleva `uptime_s`: viene por telemetría MQTT, que el backend
    // todavía no expone. Cero sería un dato FALSO; se declara desconocido con
    // -1, que las pantallas ya distinguen de un valor medido.
    uptime_s: -1,
  };
}

export function aIncident(fila: FilaIncidencia): Incident {
  return {
    id: fila.id,
    created_at: fila.occurredAt,
    // `error` existe en el backend (`enum IncidentSeverity`) y NO existía en
    // el tipo del panel: una incidencia de severidad `error` se pintaba como
    // etiqueta desconocida. El tipo se ha ampliado en vez de mapearla a otra.
    severity: (["info", "warning", "error", "critical"].includes(fila.severity)
      ? fila.severity
      : "warning") as Incident["severity"],
    source: fila.source || fila.kind,
    message: fila.message,
    resolved: fila.resolvedAt != null,
  };
}

export function aGamePreset(fila: FilaPreset): GamePreset {
  const config = (fila.config ?? {}) as Record<string, unknown>;
  return {
    id: fila.id,
    name: fila.name,
    config: { ...config, mode: modo(fila.gameMode?.key) } as GamePreset["config"],
  };
}

export function aGameSummary(fila: FilaPartida): GameSummary {
  return {
    game_id: fila.id,
    system_id: fila.targetSystemId,
    mode: modo(fila.gameMode?.key),
    started_at: fila.startedAt ?? fila.createdAt ?? "",
    finished_at: fila.finishedAt ?? null,
    phase: faseDeEstado(fila.status),
    // Los resultados NO están en la fila de la partida: viven en
    // `/api/scoreboard/games/{id}`. Devolver `[]` aquí es correcto —«esta
    // llamada no los trae»— y el consumidor no debe interpretarlo como
    // «la partida no tuvo resultados».
    results: [],
  };
}

export function aModuleConfig(fila: ConfiguracionDeseada, moduleId: string): ModuleConfig {
  const red = fila.network ?? {};
  return {
    module_id: fila.module_id ?? moduleId,
    config_version: fila.config_version ?? 0,
    system_id: fila.system_id ?? "",
    position: { x: 0, y: 0 },
    rotation: 0,
    friendly_name: fila.friendly_name ?? "",
    led_brightness_max: 0,
    telemetry_interval_ms: 0,
    network: {
      mode: red.mode === "static" ? "static" : "dhcp",
      ip: red.ip ?? null,
      netmask: red.netmask ?? null,
      gateway: red.gateway ?? null,
    },
    calibration: fila.calibration ?? [],
  };
}
