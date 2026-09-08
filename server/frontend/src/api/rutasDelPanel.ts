/**
 * CLASIFICACIÓN de las operaciones que el panel pedía y el backend no expone
 * con esa ruta.
 *
 * Antes esto era una lista plana (`RUTAS_AUSENTES_DEL_BACKEND`) de trece
 * entradas que sólo decía «falta». Decir «falta» mete en el mismo saco cosas
 * muy distintas: una ruta que el backend tiene con otro nombre, una que ya no
 * hace falta porque su pantalla se rehízo, y una que de verdad hay que
 * implementar. Mientras estuvieran juntas, ninguna se podía cerrar.
 *
 * Cada entrada lleva su veredicto Y la evidencia con la que se tomó: la ruta
 * real del contrato (`contracts/api/openapi.json`, verificada ruta a ruta) o
 * el consumidor que la usaba. Los veredictos `PORT_FRONTEND` están YA
 * portados en `realAdapter.ts`; los demás siguen fallando con una explicación
 * en vez de con un 404 mudo.
 */
export type Veredicto =
  /** El backend no tiene NADA equivalente: hay que escribirlo allí. */
  | "IMPLEMENT_BACKEND"
  /** El backend sí lo tiene, con otro nombre o forma: se porta el panel. */
  | "PORT_FRONTEND"
  /** La pantalla que la usaba ya no existe o se rehízo contra otra ruta. */
  | "OBSOLETE"
  /** Ya hay otro cliente del panel que hace exactamente esto. */
  | "DUPLICATE"
  /** Nadie la llama y no cubre ninguna necesidad viva. */
  | "NOT_NEEDED";

export interface OperacionClasificada {
  /** Ruta que el panel pedía y el backend no expone con ese nombre. */
  rutaPedida: string;
  veredicto: Veredicto;
  /** Ruta real del contrato con la que se resuelve, si la hay. */
  rutaReal?: string;
  /** Quién la llamaba. Vacío = nadie: dato, no opinión (se comprueba en la prueba). */
  consumidores: string[];
  motivo: string;
}

export const OPERACIONES: Record<string, OperacionClasificada> = {
  listModules: {
    rutaPedida: "/api/systems/{id}/modules",
    veredicto: "PORT_FRONTEND",
    rutaReal: "/api/modules",
    consumidores: ["pages/home/HomePage.tsx"],
    motivo:
      "El contrato lista módulos globalmente y la fila trae `targetSystemId`: " +
      "el filtro por sistema se hace aquí. No hay nada que implementar en el backend.",
  },
  getModuleTelemetry: {
    rutaPedida: "/api/modules/{id}/telemetry",
    veredicto: "IMPLEMENT_BACKEND",
    consumidores: ["pages/module-detail/ModuleDetailPage.tsx"],
    motivo:
      "La telemetría llega por MQTT (`module-telemetry.schema.json`) y el backend " +
      "no la expone por REST: ninguna de las 111 rutas del contrato la sirve. " +
      "No se puede portar sin escribirla.",
  },
  getModuleConfig: {
    rutaPedida: "/api/modules/{id}/config",
    veredicto: "PORT_FRONTEND",
    rutaReal: "/api/modules/{id}/config/desired",
    consumidores: [],
    motivo: "Existe como «configuración deseada». Se porta con su traducción de forma.",
  },
  updateModuleConfig: {
    rutaPedida: "/api/modules/{id}/config/patch",
    veredicto: "IMPLEMENT_BACKEND",
    consumidores: [],
    motivo:
      "`/api/modules/{id}/config/push` NO es equivalente: su DTO (`PushConfigDto`) " +
      "sólo admite `network`, mientras el panel pide un parche de `ModuleConfig` " +
      "completo (brillo, intervalo de telemetría, calibración). Portarlo sería " +
      "prometer una escritura que el backend descarta en silencio.",
  },
  getTopology: {
    rutaPedida: "/api/systems/{id}/topology",
    veredicto: "OBSOLETE",
    rutaReal: "/api/topology/panels/{idOrSlug}",
    consumidores: [],
    motivo:
      "La pantalla de topología se rehízo sobre `topologyApi.ts` y la matriz real " +
      "por panel. Nadie llama a ésta; mantenerla viva sería conservar dos verdades.",
  },
  saveTopology: {
    rutaPedida: "/api/systems/{id}/topology/save",
    veredicto: "OBSOLETE",
    rutaReal: "PUT /api/topology/panels/{idOrSlug}",
    consumidores: [],
    motivo: "Mismo caso que `getTopology`: sustituida por el editor de matrices.",
  },
  listPresets: {
    rutaPedida: "/api/game-presets",
    veredicto: "DUPLICATE",
    rutaReal: "/api/presets",
    consumidores: ["pages/new-game/NewGamePage.tsx"],
    motivo:
      "`presetsApi.listPresets()` ya habla con `/api/presets` y lo usa PresetsPage. " +
      "Se porta a la misma ruta para no dejar dos clientes divergentes.",
  },
  startGame: {
    rutaPedida: "/api/games/{id}/start",
    veredicto: "IMPLEMENT_BACKEND",
    consumidores: ["pages/countdown/CountdownPage.tsx"],
    motivo:
      "No existe «arrancar la partida»: el backend autoriza el comienzo de una " +
      "RONDA (`/api/games/{id}/rounds/{roundId}/start`) y las cuatro acciones de " +
      "`/control/{action}` son pause/resume/abort/end. Portarlo exigiría que el " +
      "panel supiera qué ronda arrancar, que hoy no sabe.",
  },
  getGameState: {
    rutaPedida: "/api/games/{id}/state",
    veredicto: "PORT_FRONTEND",
    rutaReal: "/api/games/{id}",
    consumidores: [],
    motivo:
      "La fila de la partida trae `status`, que traducido es la fase. Lo que NO " +
      "trae es el estado en vivo (dianas activas, cronómetro): eso viene por el " +
      "canal en directo y se declara desconocido en vez de rellenarse con ceros.",
  },
  getGameResult: {
    rutaPedida: "/api/games/{id}/result",
    veredicto: "PORT_FRONTEND",
    rutaReal: "/api/games/{id}",
    consumidores: ["pages/live/LiveGamePage.tsx"],
    motivo:
      "Se porta el resumen de la partida. Las filas de resultado viven en " +
      "`/api/scoreboard/games/{gameId}` y las sirve `scoreboardApi.ts`.",
  },
  listDiagnostics: {
    rutaPedida: "/api/diagnostics",
    veredicto: "NOT_NEEDED",
    rutaReal: "/api/modules/{idOrSlug}/diagnostics",
    consumidores: [],
    motivo:
      "El diagnóstico global sin módulo no lo pide ninguna pantalla; el que sí se " +
      "usa es el de un módulo, que ya está portado.",
  },
  listIncidents: {
    rutaPedida: "/api/incidents",
    veredicto: "PORT_FRONTEND",
    rutaReal: "/api/maintenance/incidents",
    consumidores: ["pages/home/HomePage.tsx", "pages/incidents/IncidentsPage.tsx"],
    motivo: "Existe bajo `maintenance`, paginada y con otra forma de fila.",
  },
  resolveIncident: {
    rutaPedida: "/api/incidents/{id}/resolve",
    veredicto: "PORT_FRONTEND",
    rutaReal: "PATCH /api/maintenance/incidents/{id}/resolve",
    consumidores: ["pages/incidents/IncidentsPage.tsx"],
    motivo: "Existe, con método PATCH (no POST) y bajo `maintenance`.",
  },
};

export type OperacionPanel = keyof typeof OPERACIONES;

/** Las que siguen sin poder atenderse: son las únicas que fallan al llamarlas. */
export const SIN_ATENDER = Object.entries(OPERACIONES)
  .filter(([, o]) => o.veredicto !== "PORT_FRONTEND" && o.veredicto !== "DUPLICATE")
  .map(([nombre]) => nombre);

export function resumen(): Record<Veredicto, string[]> {
  const salida = {
    IMPLEMENT_BACKEND: [] as string[],
    PORT_FRONTEND: [] as string[],
    OBSOLETE: [] as string[],
    DUPLICATE: [] as string[],
    NOT_NEEDED: [] as string[],
  };
  for (const [nombre, op] of Object.entries(OPERACIONES)) salida[op.veredicto].push(nombre);
  return salida;
}
