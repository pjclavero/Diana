import type { CommandAck, DiagnosticResults, DianaApiClient } from "./client";
import { ApiError } from "./client";
import { apiRequestAs } from "./typedRequest";
import { getProvisioningState, issueProvisioningOrder } from "./provisioningApi";
import { OPERACIONES, SIN_ATENDER } from "./rutasDelPanel";
import {
  aGamePreset,
  aGameSummary,
  aIncident,
  aModuleConfig,
  aModuleStatus,
  type ConfiguracionDeseada,
  type FilaIncidencia,
  type FilaModulo,
  type FilaPartida,
  type FilaPreset,
} from "./backendShapes";
import type {
  FirmwareRelease,
  GameState,
  GameSummary,
  ModuleDiagnosticEvent,
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
 * Huecos que quedan. Ya NO es una lista plana de «faltan trece»: cada
 * operación está clasificada con su veredicto y su evidencia en
 * `./rutasDelPanel.ts`, y las que el backend sí sirve con otro nombre están
 * PORTADAS abajo. Aquí sólo quedan las que de verdad no se pueden atender.
 */
export const RUTAS_AUSENTES_DEL_BACKEND = Object.fromEntries(
  SIN_ATENDER.map((nombre) => [nombre, OPERACIONES[nombre].rutaPedida]),
) as Record<string, string>;

export type OperacionAusente = keyof typeof OPERACIONES;

/**
 * Hueco DECLARADO. Falla sin salir a la red, diciendo la causa real y el
 * veredicto, en vez de disfrazarse de 404 «recurso no encontrado».
 */
async function huecoDeclarado(op: OperacionAusente): Promise<never> {
  const info = OPERACIONES[op];
  throw new ApiError(
    `Esta pantalla pide «${info.rutaPedida}» (${info.veredicto}). ` +
      `No es un fallo de red ni un identificador equivocado: ${info.motivo}`,
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
    // PORTADO. El contrato lista módulos globalmente; el filtro por sistema se
    // hace aquí porque la fila trae `targetSystemId`. `take=500` es el tope
    // duro del CRUD del backend: pedir más no trae más, así que no se finge.
    listModules: async (systemId) => {
      const page = await apiRequestAs<{ items: FilaModulo[] }>()("/api/modules", "/api/modules?take=500");
      return page.items.filter((m) => m.targetSystemId === systemId).map(aModuleStatus);
    },
    getModule: async (moduleId) => {
      // Antes esto afirmaba `apiRequestAs<ModuleStatus>()` sobre la fila de
      // Prisma. `ModuleStatus` es la forma del contrato MQTT, no la del REST:
      // `module_id`, `targets` y `queue_depth` habrían llegado `undefined` y
      // la pantalla habría pintado huecos sin dar ningún error.
      const fila = await apiRequestAs<FilaModulo>()("/api/modules/{id}", `/api/modules/${moduleId}`);
      return aModuleStatus(fila);
    },
    getModuleTelemetry: () => huecoDeclarado("getModuleTelemetry"),
    // PORTADO a la «configuración deseada» del backend.
    getModuleConfig: async (moduleId) => {
      const fila = await apiRequestAs<ConfiguracionDeseada>()(
        "/api/modules/{id}/config/desired",
        `/api/modules/${moduleId}/config/desired`,
      );
      return aModuleConfig(fila, moduleId);
    },
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
        // La ampliación v1.1 retiró `state` de `maintenance/command`: el LED de
        // mantenimiento se prueba por DURACIÓN. El comentario anterior --- que
        // el contrato hablaba de estados de diana --- dejó de ser cierto con
        // ese cambio, y este cuerpo se quedó en la versión vieja: el backend lo
        // rechazaba con 400 antes de publicar nada.
        { method: "POST", body: JSON.stringify(pattern === "off" ? { duration_ms: 0 } : {}) },
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
    // PORTADO a `/api/presets`, la MISMA ruta que ya usa `presetsApi.ts`: dos
    // clientes del panel pidiendo presets a sitios distintos era la receta
    // para que una pantalla enseñara una lista y otra, otra.
    listPresets: async () => {
      const page = await apiRequestAs<{ items: FilaPreset[] }>()("/api/presets", "/api/presets");
      return page.items.map(aGamePreset);
    },
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
    // PORTADO a la fila de la partida. Sólo se afirma lo que la fila dice: la
    // fase. Lo que no sabe (ronda, cronómetro, dianas activas) va marcado como
    // desconocido —cadena vacía, -1, lista vacía— y NUNCA como cero medido,
    // que es como un panel acaba diciendo «0 impactos» cuando lo cierto es
    // «no lo sé».
    getGameState: async (gameId) => {
      const fila = await apiRequestAs<FilaPartida>()("/api/games/{id}", `/api/games/${gameId}`);
      const resumen = aGameSummary(fila);
      return {
        system_id: resumen.system_id,
        game_id: resumen.game_id,
        round_id: "",
        phase: resumen.phase,
        mode: resumen.mode,
        coordinator_module_id: "",
        elapsed_us: -1,
        targets_remaining: -1,
        targets_hit: -1,
        penalties: -1,
        active_targets: [],
      };
    },
    // PORTADO. Las FILAS de resultado no vienen aquí (viven en
    // `/api/scoreboard/games/{id}`, que sirve `scoreboardApi.ts`): esta llamada
    // devuelve el resumen y `results: []` significa «esta llamada no los trae»,
    // no «no hubo resultados».
    getGameResult: async (gameId) => {
      const fila = await apiRequestAs<FilaPartida>()("/api/games/{id}", `/api/games/${gameId}`);
      return aGameSummary(fila);
    },
    listResults: async () => {
      // DEFECTO CORREGIDO AQUÍ: se pedía `?status=finished` y el backend NO
      // filtra por estado — `GET /api/games` sólo lee `take` (games.module.ts).
      // La consulta se aceptaba, el parámetro se tiraba a la basura y la
      // pantalla de resultados enseñaba TAMBIÉN borradores y partidas en
      // curso, presentados como resultados. El filtro se hace aquí, que es
      // donde hoy se puede hacer de verdad.
      const page = await apiRequestAs<{ items: FilaPartida[] }>()("/api/games", "/api/games?take=100");
      return page.items.map(aGameSummary).filter((g) => g.phase === "finished" || g.phase === "cancelled");
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
    // PORTADO a `/api/maintenance/incidents`.
    listIncidents: async () => {
      const page = await apiRequestAs<{ items: FilaIncidencia[] }>()(
        "/api/maintenance/incidents",
        "/api/maintenance/incidents?take=100",
      );
      return page.items.map(aIncident);
    },
    // PORTADO. Método PATCH, no POST: escrito con POST habría sido un 404 mudo.
    resolveIncident: async (id) => {
      const fila = await apiRequestAs<FilaIncidencia>()<
        "/api/maintenance/incidents/{id}/resolve",
        "patch"
      >("/api/maintenance/incidents/{id}/resolve", `/api/maintenance/incidents/${id}/resolve`, {
        method: "PATCH",
        preferServerDetail: true,
      });
      return aIncident(fila);
    },

    // --- Usuarios ---
    listUsers: async () => {
      const page = await apiRequestAs<{ items: UserAccount[] }>()("/api/users", "/api/users?take=500");
      return page.items;
    },

    // --- Aprovisionamiento (T2) ---
    // Delegado en `./provisioningApi.ts` (mismo patrón que `firmwareApi.ts`):
    // el adaptador no reinterpreta la respuesta, la pasa tal cual. Cualquier
    // traducción aquí sería una oportunidad de perder `denied`/`reason_code`.
    issueProvisioningOrder,
    getProvisioningState,
  };
}
