import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import {
  getProvisioningState,
  issueProvisioningOrder,
  resultadoDePublicacion,
  type ResultadoOrden,
} from "./provisioningApi";

/**
 * Lo que estas pruebas SÍ demuestran: que el cliente no pierde ni suaviza
 * `denied`/`timed_out`/`reason_code`, y que el 404 de «estado» es un dato y no
 * un error. Todo ello contra un `fetch` DOBLE.
 *
 * Lo que NO demuestran, y conviene no confundir: nada sobre el backend real ni
 * sobre el broker. Que el backend devuelva de verdad estos campos está leído de
 * su controlador, no ejecutado aquí.
 */

function respuesta(status: number, cuerpo: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

const ORDEN = {
  system_id: "sistema-01",
  action: "PROVISION" as const,
  provisioning_key_fingerprint: "a".repeat(64),
};

afterEach(() => vi.restoreAllMocks());

describe("issueProvisioningOrder", () => {
  it("devuelve el resultado REAL de la publicación, sin colapsarlo en un «aceptado»", async () => {
    const doble = vi.fn(async () =>
      respuesta(201, {
        request_id: "r1",
        provisioning_sequence: "7",
        topic: "module/module-01/provision",
        delivered: false,
        denied: true,
        timed_out: false,
        reason_code: 135,
      }),
    );
    vi.stubGlobal("fetch", doble);

    const r = await issueProvisioningOrder("module-01", ORDEN);

    expect(r.denied).toBe(true);
    expect(r.delivered).toBe(false);
    expect(r.reason_code).toBe(135);
    // La URL lleva el deviceId interpolado y el método es POST.
    const [url, init] = doble.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/provisioning/modules/module-01/orders");
    expect(init.method).toBe("POST");
    // El cuerpo va tal cual, en snake_case: el panel no reescribe el DTO.
    expect(JSON.parse(String(init.body))).toEqual(ORDEN);
  });

  it("un 403 (permiso ausente) se propaga como error, no como orden emitida", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(403, { message: "Prohibido" })));
    await expect(issueProvisioningOrder("module-01", ORDEN)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getProvisioningState", () => {
  it("404 = «nunca ha reportado» → null, que es un DATO, no un error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta(404, { message: "Sin estado de aprovisionamiento observado" })),
    );
    await expect(getProvisioningState("module-01")).resolves.toBeNull();
  });

  it("cualquier OTRO fallo se propaga: «no he podido preguntar» ≠ «no hay nada»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(500, { message: "Boom" })));
    await expect(getProvisioningState("module-01")).rejects.toBeInstanceOf(ApiError);
  });

  it("un fallo de RED tampoco se convierte en null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(getProvisioningState("module-01")).rejects.toBeInstanceOf(ApiError);
  });

  it("devuelve la observación tal cual, con su marca `observational_only`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuesta(200, { device_id: "module-01", state: "PROVISIONED", observational_only: true })),
    );
    const e = await getProvisioningState("module-01");
    expect(e?.observational_only).toBe(true);
    expect(e?.state).toBe("PROVISIONED");
  });
});

describe("resultadoDePublicacion · el veredicto no se puede ablandar", () => {
  const base: ResultadoOrden = {
    request_id: "r1",
    provisioning_sequence: 1,
    topic: "module/module-01/provision",
    delivered: false,
    denied: false,
    timed_out: false,
    reason_code: null,
  };

  it("denegada por el broker: NO es correcto y lo dice con esa palabra y su reason_code", () => {
    const l = resultadoDePublicacion({ ...base, denied: true, reason_code: 135 });
    expect(l.veredicto).toBe("denegada");
    expect(l.correcto).toBe(false);
    expect(l.etiqueta).toMatch(/DENEGADA/);
    expect(l.motivo).toContain("135");
  });

  /**
   * CASO CLAVE. Si el backend marcase las dos banderas a la vez, mirar
   * `delivered` primero pintaría una denegación de ACL como éxito. El orden de
   * las ramas es la propiedad, y aquí se fija.
   */
  it("denied Y delivered a la vez → denegada; la denegación GANA siempre", () => {
    const l = resultadoDePublicacion({ ...base, denied: true, delivered: true, reason_code: 135 });
    expect(l.veredicto).toBe("denegada");
    expect(l.correcto).toBe(false);
  });

  it("tiempo agotado: no se afirma ni que llegó ni que no llegó", () => {
    const l = resultadoDePublicacion({ ...base, timed_out: true });
    expect(l.veredicto).toBe("sin-acuse");
    expect(l.correcto).toBe(false);
    expect(l.motivo).toMatch(/no se puede afirmar/i);
  });

  it("entregada: es correcto, pero se aclara que es AL BROKER, no aplicada por el módulo", () => {
    const l = resultadoDePublicacion({ ...base, delivered: true, reason_code: 0 });
    expect(l.veredicto).toBe("entregada");
    expect(l.correcto).toBe(true);
    expect(l.motivo).toMatch(/no que el módulo la haya aplicado/i);
  });

  it("ninguna bandera puesta NO es éxito: ausencia de datos no es «todo correcto»", () => {
    const l = resultadoDePublicacion(base);
    expect(l.veredicto).toBe("no-entregada");
    expect(l.correcto).toBe(false);
  });
});
