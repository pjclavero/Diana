import type { CommandAck, DiagnosticResults, DianaApiClient } from "./client";
import { ApiError } from "./client";
import { apiRequestAs } from "./typedRequest";
import type {
  FirmwareRelease,
  GameState,
  GameSummary,
  ModuleDiagnosticEvent,
  ModuleStatus,
  Player,
  SystemStatus,
  Team,
  UserAccount,
} from "../types/domain";

/**
 * Adaptador REST real, MIGRADO a la puerta del contrato.
 *
 * Este fichero era el que concentraba las rutas inventadas (X-21). Ya no tiene
 * función de `fetch` propia: todo pasa por `apiRequestAs`, así que cada ruta
 * que aquí se escribe TIENE que existir en `contracts/api/openapi.json` o el
 * panel no compila. Eso ha destapado, comprobándolo ruta a ruta contra el
 * contrato regenerado, dos cosas distintas que antes se confundían:
 *
 *  (a) Rutas que SÍ existen pero con otra PLANTILLA. `/modules/:id/diagnostics`
 *      y las cuatro órdenes de diana estaban escritas con `{id}` cuando el
 *      backend las declara con `{idOrSlug}`; a nivel de URL coincidían, pero
 *      nada lo garantizaba. Ahora quedan ancladas a la plantilla real. Y
 *      `pause`/`cancel` no existían como tales: el backend tiene UNA ruta de
 *      control con la acción en la URL.
 *
 *  (b) Rutas que el backend NO EXPONE EN ABSOLUTO. Antes producían un 404 en
 *      tiempo de ejecución con el mensaje genérico «no se ha encontrado el
 *      recurso», indistinguible de un identificador equivocado. Ahora están en
 *      un registro ÚNICO y explícito, `RUTAS_AUSENTES_DEL_BACKEND`, y fallan
 *      diciendo exactamente qué falta. `no-fetch-fuera-de-la-puerta.test.ts`
 *      comprueba que NINGUNA de ellas exista ya en el contrato: el día que el
 *      backend implemente cualquiera, esa prueba se pone roja y obliga a
 *      migrarla aquí. El registro sólo puede encoger.
 *
 * LÍMITE HONESTO, no disimulado: la puerta ancla RUTA y MÉTODO, no la FORMA.
 * Los tipos de dominio que se declaran abajo (`SystemStatus`, `GameState`…)
 * son lo que el PANEL supone, no lo que el backend promete: hoy ninguna de las
 * 112 rutas lleva `@ApiResponse({ type })` (ver `./README.md`). Por eso van con
 * `apiRequestAs`, que se autodesactiva en cuanto el contrato hable.
 */

/**
 * Rutas que el panel necesita y el backend NO expone (verificado ruta a ruta
 * contra `contracts/api/openapi.json`, 112 rutas). El valor es lo que el panel
 * pedía; el comentario, lo más parecido que sí existe, si existe algo.
 */
export const RUTAS_AUSENTES_DEL_BACKEND = {
  /** El contrato lista módulos con `/api/modules`, no por sistema. */
  listModules: "/api/systems/{id}/modules",
  getModuleTelemetry: "/api/modules/{id}/telemetry",
  /** Lo más cercano: `/api/modules/{id}/config/desired` y `/config/push`. */
  getModuleConfig: "/api/modules/{id}/config",
  updateModuleConfig: "/api/modules/{id}/config/patch",
  /** Lo más cercano: `/api/topology`, `/api/topology/{id}`, `/api/topology/panels`. */
  getTopology: "/api/systems/{id}/topology",
  saveTopology: "/api/systems/{id}/topology/save",
  /** Lo más cercano: `/api/presets`. */
  listPresets: "/api/game-presets",
  /** No hay orden de «arranque de partida»; sí `/api/games/{id}/rounds/{roundId}/start`. */
  startGame: "/api/games/{id}/start",
  getGameState: "/api/games/{id}/state",
  getGameResult: "/api/games/{id}/result",
  /** El diagnóstico global sin módulo no existe; sólo por módulo. */
  listDiagnostics: "/api/diagnostics",
  listIncidents: "/api/incidents",
  resolveIncident: "/api/incidents/{id}/resolve",
} as const;

export type OperacionAusente = keyof typeof RUTAS_AUSENTES_DEL_BACKEND;

/**
 * Hueco DECLARADO. Falla sin salir a la red y diciendo la causa real, en vez
 * de disfrazarse de 404 «recurso no encontrado».
 */
async function huecoDeclarado(op: OperacionAusente): Promise<never> {
  throw new ApiError(
    `Esta pantalla pide «${RUTAS_AUSENTES_DEL_BACKEND[op]}», que el backend no expone (X-21). ` +
      `No es un fallo de red ni un identificador equivocado: falta el endpoint.`,
  );
}

export function createRealApiClient(): DianaApiClient {
  return {
    // --- Sistema ---
    getSystemStatus: (systemId) =>
      apiRequestAs<SystemStatus>()("/api/systems/{id}/status", `/api/systems/${systemId}/status`),
    listSystems: async () => {
      // `/api/systems` está PAGINADO: devuelve `{items,…}`, no un array. Antes
      // se tipaba como array y la lista salía vacía sin error visible; es la
      // misma clase de fallo silencioso que en los clientes de listado.
      const page = await apiRequestAs<{ items: SystemStatus[] }>()("/api/systems", "/api/systems?take=500");
      return page.items;
    },

    // --- Módulos ---
    listModules: () => huecoDeclarado("listModules"),
    getModule: (moduleId) => apiRequestAs<ModuleStatus>()("/api/modules/{id}", `/api/modules/${moduleId}`),
    getModuleTelemetry: () => huecoDeclarado("getModuleTelemetry"),
    getModuleConfig: () => huecoDeclarado("getModuleConfig"),
    updateModuleConfig: () => huecoDeclarado("updateModuleConfig"),
    identifyModule: (moduleId, durationMs) =>
      apiRequestAs<CommandAck>()<"/api/modules/{idOrSlug}/commands/identify", "post">(
        "/api/modules/{idOrSlug}/commands/identify",
        `/api/modules/${moduleId}/commands/identify`,
        { method: "POST", body: JSON.stringify({ duration_ms: durationMs ?? 4000 }) },
      ),
    calibrateTarget: (moduleId, targetIndex) =>
      apiRequestAs<CommandAck>()<"/api/modules/{idOrSlug}/targets/{targetIndex}/calibrate", "post">(
        "/api/modules/{idOrSlug}/targets/{targetIndex}/calibrate",
        `/api/modules/${moduleId}/targets/${targetIndex}/calibrate`,
        { method: "POST" },
      ),
    testSensor: (moduleId, targetIndex) =>
      apiRequestAs<CommandAck>()<"/api/modules/{idOrSlug}/targets/{targetIndex}/test-sensor", "post">(
        "/api/modules/{idOrSlug}/targets/{targetIndex}/test-sensor",
        `/api/modules/${moduleId}/targets/${targetIndex}/test-sensor`,
        { method: "POST" },
      ),
    testLed: (moduleId, targetIndex, pattern) =>
      apiRequestAs<CommandAck>()<"/api/modules/{idOrSlug}/targets/{targetIndex}/test-led", "post">(
        "/api/modules/{idOrSlug}/targets/{targetIndex}/test-led",
        `/api/modules/${moduleId}/targets/${targetIndex}/test-led`,
        // El contrato habla de ESTADOS de diana (`targetState`), no de
        // «patrones»: el nombre anterior era un invento del backend.
        { method: "POST", body: JSON.stringify({ state: pattern }) },
      ),
    getModuleDiagnostics: (moduleId) =>
      apiRequestAs<DiagnosticResults>()(
        "/api/modules/{idOrSlug}/diagnostics",
        `/api/modules/${moduleId}/diagnostics`,
      ),

    // --- Topología ---
    getTopology: () => huecoDeclarado("getTopology"),
    saveTopology: () => huecoDeclarado("saveTopology"),

    // --- Jugadores y equipos ---
    listPlayers: async () => {
      const page = await apiRequestAs<{ items: Player[] }>()("/api/players", "/api/players?take=500");
      return page.items;
    },
    createPlayer: (p) =>
      apiRequestAs<Player>()<"/api/players", "post">("/api/players", "/api/players", {
        method: "POST",
        body: JSON.stringify(p),
      }),
    listTeams: async () => {
      const page = await apiRequestAs<{ items: Team[] }>()("/api/teams", "/api/teams?take=500");
      return page.items;
    },
    createTeam: (t) =>
      apiRequestAs<Team>()<"/api/teams", "post">("/api/teams", "/api/teams", {
        method: "POST",
        body: JSON.stringify(t),
      }),

    // --- Partidas ---
    listPresets: () => huecoDeclarado("listPresets"),
    createGame: (config) =>
      apiRequestAs<GameSummary>()<"/api/games", "post">("/api/games", "/api/games", {
        method: "POST",
        body: JSON.stringify(config),
      }),
    startGame: () => huecoDeclarado("startGame"),
    // El backend no tiene `/pause` ni `/cancel`: tiene UNA ruta de control con
    // la acción en la URL (`pause_game`, `resume_game`, `abort_game`,
    // `end_game`, según `games.service.ts:72`). Antes esto era un 404 mudo.
    pauseGame: (gameId) =>
      apiRequestAs<GameState>()<"/api/games/{id}/control/{action}", "post">(
        "/api/games/{id}/control/{action}",
        `/api/games/${gameId}/control/pause_game`,
        { method: "POST", preferServerDetail: true },
      ),
    cancelGame: (gameId) =>
      apiRequestAs<GameState>()<"/api/games/{id}/control/{action}", "post">(
        "/api/games/{id}/control/{action}",
        `/api/games/${gameId}/control/abort_game`,
        { method: "POST", preferServerDetail: true },
      ),
    getGameState: () => huecoDeclarado("getGameState"),
    getGameResult: () => huecoDeclarado("getGameResult"),
    listResults: async () => {
      // `/api/games` está paginado igual que el resto de listados.
      const page = await apiRequestAs<{ items: GameSummary[] }>()(
        "/api/games",
        "/api/games?take=100&status=finished",
      );
      return page.items;
    },

    // --- Diagnóstico ---
    listDiagnostics: (moduleId) =>
      moduleId
        ? apiRequestAs<ModuleDiagnosticEvent[]>()(
            "/api/modules/{idOrSlug}/diagnostics",
            `/api/modules/${moduleId}/diagnostics`,
          )
        : huecoDeclarado("listDiagnostics"),

    // --- Firmware ---
    listFirmware: async () => {
      const page = await apiRequestAs<{ items: FirmwareRelease[] }>()("/api/firmware", "/api/firmware?take=500");
      return page.items;
    },

    // --- Incidencias ---
    listIncidents: () => huecoDeclarado("listIncidents"),
    resolveIncident: () => huecoDeclarado("resolveIncident"),

    // --- Usuarios ---
    listUsers: async () => {
      const page = await apiRequestAs<{ items: UserAccount[] }>()("/api/users", "/api/users?take=500");
      return page.items;
    },
  };
}
