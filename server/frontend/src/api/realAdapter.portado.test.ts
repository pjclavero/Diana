import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/tokenStore", () => ({ getToken: () => "token-de-prueba" }));

const { createRealApiClient, RUTAS_AUSENTES_DEL_BACKEND } = await import("./realAdapter");
const { OPERACIONES } = await import("./rutasDelPanel");

/**
 * Lo que este fichero mide y lo que NO.
 *
 * MIDE: que cada operación portada pide la URL y el MÉTODO que el contrato
 * declara, y que traduce la fila REAL del backend (la de Prisma, con
 * `slug`/`occurredAt`/`targetSystemId`) al vocabulario del panel. Las
 * respuestas son las filas que devuelve el backend, copiadas de sus modelos.
 *
 * NO MIDE: que un backend en marcha devuelva exactamente eso. Eso exige un
 * backend real levantado y queda declarado como pendiente en el informe: aquí
 * está IMPLEMENTADO y probado contra la forma del contrato, no PROBADO CONTRA
 * BACKEND REAL. La diferencia se dice, no se disimula.
 */

interface Llamada {
  url: string;
  metodo: string;
}

let llamadas: Llamada[] = [];
let responder: (url: string) => unknown;

function instalarFetch() {
  llamadas = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const texto = String(url);
    llamadas.push({ url: texto, metodo: init?.method ?? "GET" });
    const cuerpo = responder(texto);
    return {
      ok: true,
      status: 200,
      json: async () => cuerpo,
    } as Response;
  }) as unknown as typeof fetch;
}

const api = createRealApiClient();

beforeEach(() => {
  instalarFetch();
});

describe("realAdapter · rutas portadas al backend real", () => {
  it("listModules pide /api/modules y filtra por el sistema, traduciendo la fila", async () => {
    responder = () => ({
      items: [
        {
          id: "uuid-1",
          slug: "module-03",
          targetSystemId: "panel-a",
          state: "ready",
          role: "principal",
          firmwareVersion: "0.2.0",
          queueDepth: 2,
          position: { x: -1, y: 0, rotation: 90 },
          targets: [{ targetIndex: 4, state: "active" }],
        },
        { id: "uuid-2", slug: "module-99", targetSystemId: "otro-panel", state: "ready" },
      ],
    });

    const modulos = await api.listModules("panel-a");

    expect(llamadas).toEqual([{ url: "/api/modules?take=500", metodo: "GET" }]);
    expect(modulos).toHaveLength(1);
    expect(modulos[0].module_id).toBe("module-03"); // slug, no el uuid
    expect(modulos[0].system_id).toBe("panel-a");
    expect(modulos[0].rotation).toBe(90);
    expect(modulos[0].targets).toEqual([{ target_index: 4, state: "active", enabled: true }]);
    // `uptime_s` no viaja por REST: se declara desconocido, no cero.
    expect(modulos[0].uptime_s).toBe(-1);
  });

  it("getModule traduce la fila en vez de afirmar que ya es un ModuleStatus", async () => {
    responder = () => ({ id: "uuid-1", slug: "module-07", targetSystemId: "panel-a", state: "error" });
    const modulo = await api.getModule("uuid-1");
    expect(llamadas[0].url).toBe("/api/modules/uuid-1");
    expect(modulo.module_id).toBe("module-07");
    expect(modulo.state).toBe("error");
  });

  it("un módulo sin `state` NO se declara listo", async () => {
    // Control del defecto de fondo del carril: la ausencia de dato no puede
    // presentarse como buena noticia.
    responder = () => ({ id: "u", slug: "module-08", targetSystemId: "panel-a" });
    const modulo = await api.getModule("u");
    expect(modulo.state).not.toBe("ready");
    expect(modulo.state).toBe("boot");
  });

  it("listIncidents pide /api/maintenance/incidents y traduce occurredAt/resolvedAt", async () => {
    responder = () => ({
      items: [
        {
          id: "i1",
          kind: "ingest_schema_violation",
          severity: "error",
          source: "ingest",
          message: "payload rechazado",
          occurredAt: "2026-09-08T10:00:00.000Z",
          resolvedAt: null,
        },
        {
          id: "i2",
          kind: "low_voltage",
          severity: "warning",
          source: "module-03",
          message: "tensión baja",
          occurredAt: "2026-09-08T09:00:00.000Z",
          resolvedAt: "2026-09-08T09:30:00.000Z",
        },
      ],
    });

    const incidencias = await api.listIncidents();

    expect(llamadas).toEqual([{ url: "/api/maintenance/incidents?take=100", metodo: "GET" }]);
    expect(incidencias[0]).toEqual({
      id: "i1",
      created_at: "2026-09-08T10:00:00.000Z",
      // `error` es una severidad REAL del backend; antes no cabía en el tipo.
      severity: "error",
      source: "ingest",
      message: "payload rechazado",
      resolved: false,
    });
    expect(incidencias[1].resolved).toBe(true);
  });

  it("resolveIncident usa PATCH: con POST habría sido un 404 mudo", async () => {
    responder = () => ({
      id: "i1",
      kind: "k",
      severity: "warning",
      source: "s",
      message: "m",
      occurredAt: "2026-09-08T10:00:00.000Z",
      resolvedAt: "2026-09-08T11:00:00.000Z",
    });
    const incidencia = await api.resolveIncident("i1");
    expect(llamadas).toEqual([
      { url: "/api/maintenance/incidents/i1/resolve", metodo: "PATCH" },
    ]);
    expect(incidencia.resolved).toBe(true);
  });

  it("listPresets pide la MISMA ruta que presetsApi, no una paralela", async () => {
    responder = () => ({
      items: [{ id: "p1", name: "Rápida", config: { rounds: 3 }, gameMode: { key: "reaction" } }],
    });
    const presets = await api.listPresets();
    expect(llamadas).toEqual([{ url: "/api/presets", metodo: "GET" }]);
    expect(presets[0]).toEqual({ id: "p1", name: "Rápida", config: { rounds: 3, mode: "reaction" } });
  });

  it("getGameState traduce `status` a fase y NO inventa cronómetro ni impactos", async () => {
    responder = () => ({
      id: "g1",
      targetSystemId: "panel-a",
      status: "aborted",
      gameMode: { key: "duelo" },
    });
    const estado = await api.getGameState("g1");
    expect(llamadas[0].url).toBe("/api/games/g1");
    // `aborted` del backend es `cancelled` para el panel: sin traducir, una
    // partida abortada se quedaba «corriendo» en pantalla para siempre.
    expect(estado.phase).toBe("cancelled");
    expect(estado.targets_hit).toBe(-1);
    expect(estado.elapsed_us).toBe(-1);
    expect(estado.active_targets).toEqual([]);
  });

  it("getGameResult devuelve el resumen y declara que las filas no vienen aquí", async () => {
    responder = () => ({
      id: "g1",
      targetSystemId: "panel-a",
      status: "finished",
      startedAt: "2026-09-08T10:00:00.000Z",
      finishedAt: "2026-09-08T10:20:00.000Z",
      gameMode: { key: "random" },
    });
    const resumen = await api.getGameResult("g1");
    expect(resumen.phase).toBe("finished");
    expect(resumen.finished_at).toBe("2026-09-08T10:20:00.000Z");
    expect(resumen.results).toEqual([]);
  });

  it("listResults ya no confía en un ?status= que el backend ignora", async () => {
    responder = () => ({
      items: [
        { id: "g1", targetSystemId: "p", status: "finished", gameMode: { key: "random" } },
        { id: "g2", targetSystemId: "p", status: "draft", gameMode: { key: "random" } },
        { id: "g3", targetSystemId: "p", status: "running", gameMode: { key: "random" } },
        { id: "g4", targetSystemId: "p", status: "aborted", gameMode: { key: "random" } },
      ],
    });
    const resultados = await api.listResults();
    // La URL ya no lleva un filtro que el backend tira a la basura...
    expect(llamadas[0].url).toBe("/api/games?take=100");
    // ...y el filtro se aplica de verdad: un borrador no es un resultado.
    expect(resultados.map((r) => r.game_id)).toEqual(["g1", "g4"]);
  });

  it("getModuleConfig se apoya en la configuración deseada del backend", async () => {
    responder = () => ({
      module_id: "module-03",
      config_version: 7,
      network: { mode: "static", ip: "10.0.0.5", netmask: "255.255.255.0", gateway: "10.0.0.1" },
    });
    const config = await api.getModuleConfig("uuid-1");
    expect(llamadas[0].url).toBe("/api/modules/uuid-1/config/desired");
    expect(config.config_version).toBe(7);
    expect(config.network).toEqual({
      mode: "static",
      ip: "10.0.0.5",
      netmask: "255.255.255.0",
      gateway: "10.0.0.1",
    });
  });
});

describe("realAdapter · lo que sigue sin poder atenderse", () => {
  const sinAtender = Object.entries(OPERACIONES).filter(
    ([, o]) => o.veredicto !== "PORT_FRONTEND" && o.veredicto !== "DUPLICATE",
  );

  it("el registro de huecos ya sólo contiene las no atendidas", () => {
    expect(Object.keys(RUTAS_AUSENTES_DEL_BACKEND).sort()).toEqual(
      sinAtender.map(([n]) => n).sort(),
    );
  });

  /**
   * `PENDING_CONTRACT` no es un método del cliente y NO debe serlo: son rutas
   * que el backend ya implementa pero el contrato no declara, así que el panel
   * no puede tipar la llamada. Se comprueba que efectivamente NO están
   * cableadas (cablearlas a ciegas sería inventar la forma de la respuesta) y
   * se excluyen del banco de huecos ejecutables de abajo.
   */
  const pendientesDeContrato = sinAtender.filter(([, o]) => o.veredicto === "PENDING_CONTRACT");

  it.each(pendientesDeContrato)("%s NO está cableada en el cliente, a propósito", (nombre) => {
    expect(Object.keys(api)).not.toContain(nombre);
  });

  const huecosEjecutables = sinAtender.filter(([, o]) => o.veredicto !== "PENDING_CONTRACT");

  it.each(huecosEjecutables)("%s falla diciendo el veredicto y SIN salir a la red", async (nombre, op) => {
    const cliente = api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    // `listDiagnostics` SÍ está portada cuando se le da un módulo: el hueco es
    // el diagnóstico GLOBAL, sin módulo. Se la llama como la llamaría quien
    // pidiera ese hueco, no con argumentos que lo esquivan.
    const args = nombre === "listDiagnostics" ? [] : ["x", "y"];
    await expect(cliente[nombre](...args)).rejects.toThrow(
      new RegExp(`${op.veredicto}`),
    );
    // Efecto observable: no se ha disparado NINGUNA petición. Un 404 mudo era
    // indistinguible de un identificador equivocado.
    expect(llamadas).toEqual([]);
  });
});
