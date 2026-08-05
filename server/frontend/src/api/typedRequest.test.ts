import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { apiRequest, apiRequestAs, baseOrigin } from "./typedRequest";
import { setToken } from "../auth/tokenStore";

/**
 * Pruebas de la PUERTA del contrato. Fijan dos cosas distintas:
 *
 *  1. El defecto de la doble base (`/api/api/modules`), que era real y
 *     silencioso: se manifestaba sólo con `VITE_API_BASE_URL` definida, es
 *     decir en producción y NO en desarrollo, que es la peor combinación
 *     posible. Sin esta prueba, cualquiera puede volver a concatenar la base
 *     entera y el panel seguiría verde en local.
 *  2. La semántica de error de la puerta, que ahora tiene que cubrir todo lo
 *     que antes hacían las doce funciones de llamada a mano de los clientes
 *     (mensajes en array de Nest, detalle del servidor por encima del
 *     «no tiene permiso», 204 sin cuerpo, multipart sin `Content-Type`).
 */

function respuesta(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(respuesta({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("baseOrigin: la base se reduce al ORIGEN porque el contrato ya trae `/api`", () => {
  it.each([
    ["/api", ""],
    ["/api/", ""],
    ["/api/v1", ""],
    ["/api/v2/", ""],
    ["", ""],
    ["https://diana.example/api", "https://diana.example"],
    ["https://diana.example/api/v1", "https://diana.example"],
    ["https://diana.example", "https://diana.example"],
  ])("%s -> %s", (entrada, esperado) => {
    expect(baseOrigin(entrada)).toBe(esperado);
  });
});

describe("la URL final no duplica el prefijo /api (defecto X-21 de la propia puerta)", () => {
  async function urlPedidaCon(base: string | undefined): Promise<string> {
    vi.resetModules();
    if (base === undefined) vi.stubEnv("VITE_API_BASE_URL", "");
    else vi.stubEnv("VITE_API_BASE_URL", base);
    const modulo = await import("./typedRequest");
    await modulo.apiRequest("/api/modules", "/api/modules?take=5");
    return fetchMock.mock.calls.at(-1)?.[0] as string;
  }

  it("con VITE_API_BASE_URL=/api (valor REAL de producción: Dockerfile:20 y compose.yml:84)", async () => {
    const url = await urlPedidaCon("/api");
    expect(url).toBe("/api/modules?take=5");
    expect(url).not.toContain("/api/api");
  });

  it("con VITE_API_BASE_URL=/api/v1 (valor de server/frontend/.env.example:4)", async () => {
    expect(await urlPedidaCon("/api/v1")).toBe("/api/modules?take=5");
  });

  it("con un origen absoluto, el host se conserva y el prefijo no se duplica", async () => {
    expect(await urlPedidaCon("https://diana.example/api")).toBe("https://diana.example/api/modules?take=5");
  });
});

describe("semántica de error de la puerta", () => {
  it("adjunta el token y el Content-Type JSON", async () => {
    setToken("t0ken");
    await apiRequest("/api/modules", "/api/modules");
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t0ken");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    setToken(null);
  });

  it("con FormData NO pone Content-Type (lo pone el navegador con el boundary)", async () => {
    const form = new FormData();
    form.append("binary", new Blob(["x"]), "f.bin");
    await apiRequestAs<unknown>()<"/api/firmware/upload", "post">(
      "/api/firmware/upload",
      "/api/firmware/upload",
      { method: "POST", body: form },
    );
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("204 devuelve undefined sin intentar interpretar cuerpo", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error("no debería leerse");
      },
    } as unknown as Response);
    await expect(apiRequest("/api/modules", "/api/modules")).resolves.toBeUndefined();
  });

  it("un fallo de red se traduce a ApiError con mensaje de operador", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await expect(apiRequest("/api/modules", "/api/modules")).rejects.toBeInstanceOf(ApiError);
  });

  it("toma el primer elemento cuando Nest devuelve `message` como array (validación)", async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ message: ["el nombre es obligatorio", "y otra cosa"] }, 400));
    await expect(apiRequest("/api/modules", "/api/modules")).rejects.toThrow("el nombre es obligatorio");
  });

  it("por defecto, 403 dice «no tiene permiso» aunque el servidor mande detalle", async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ message: "panel ajeno" }, 403));
    await expect(apiRequest("/api/modules", "/api/modules")).rejects.toThrow("No tiene permiso para esta acción.");
  });

  it("con preferServerDetail, 403 conserva la razón exacta del servidor", async () => {
    // Esto es lo que hacía a mano el `post` de scoreboardApi.ts: decirle al
    // operador «no tiene permiso» cuando el motivo es «partida en curso» le
    // hace perder el tiempo. La excepción es ahora una opción declarada.
    fetchMock.mockResolvedValueOnce(respuesta({ message: "la partida está en curso" }, 403));
    await expect(
      apiRequest("/api/modules", "/api/modules", { preferServerDetail: true }),
    ).rejects.toThrow("la partida está en curso");
  });

  it("notFoundMessage sustituye al genérico sólo en el 404", async () => {
    fetchMock.mockResolvedValueOnce(respuesta({}, 404));
    await expect(
      apiRequest("/api/modules", "/api/modules", { notFoundMessage: "Ese módulo ya no existe." }),
    ).rejects.toThrow("Ese módulo ya no existe.");
  });
});
