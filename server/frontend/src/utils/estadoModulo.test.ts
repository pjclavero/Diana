import { describe, expect, it } from "vitest";
import {
  SILENCIO_MAXIMO_MS,
  diagnosticarModulo,
  estadoDeConfiguracion,
  estadoDeLista,
  formatearSilencio,
  recuentoPorEstado,
} from "./estadoModulo";

const AHORA = new Date("2026-09-10T12:00:00.000Z");
const haceMs = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();

describe("diagnóstico de un módulo", () => {
  it("nunca visto y no en línea = pendiente, no desconectado", () => {
    const d = diagnosticarModulo({ online: false, lastSeenAt: null }, AHORA);
    expect(d.estado).toBe("pendiente");
    expect(d.motivo).toMatch(/sin primera señal/i);
  });

  it("en línea con señal reciente = online", () => {
    expect(diagnosticarModulo({ online: true, lastSeenAt: haceMs(5_000) }, AHORA).estado).toBe("online");
  });

  it("no en línea con señal previa = offline, y dice cuándo fue", () => {
    const d = diagnosticarModulo({ online: false, lastSeenAt: haceMs(600_000) }, AHORA);
    expect(d.estado).toBe("offline");
    expect(d.motivo).toContain("10 min");
  });

  it("en línea pero callado por encima del umbral = stale (la bandera NO gana)", () => {
    const d = diagnosticarModulo({ online: true, lastSeenAt: haceMs(SILENCIO_MAXIMO_MS + 1) }, AHORA);
    expect(d.estado).toBe("stale");
    expect(d.motivo).toMatch(/puede estar caído/i);
  });

  it("el borde exacto del umbral todavía es online", () => {
    expect(diagnosticarModulo({ online: true, lastSeenAt: haceMs(SILENCIO_MAXIMO_MS) }, AHORA).estado).toBe(
      "online",
    );
    expect(
      diagnosticarModulo({ online: true, lastSeenAt: haceMs(SILENCIO_MAXIMO_MS + 1) }, AHORA).estado,
    ).toBe("stale");
  });

  it("en línea SIN ninguna señal registrada no se acepta como online", () => {
    const d = diagnosticarModulo({ online: true, lastSeenAt: null }, AHORA);
    expect(d.estado).toBe("stale");
    expect(d.silencioMs).toBeNull();
    expect(d.motivo).toMatch(/no se puede confirmar/i);
  });

  it("una marca de tiempo ilegible se trata como ausencia, no como ahora mismo", () => {
    expect(diagnosticarModulo({ online: false, lastSeenAt: "no-es-una-fecha" }, AHORA).estado).toBe(
      "pendiente",
    );
  });

  it("una marca futura se dice, no se disfraza de 0 s", () => {
    const d = diagnosticarModulo({ online: true, lastSeenAt: haceMs(-30_000) }, AHORA);
    expect(d.motivo).toMatch(/futura/i);
  });
});

describe("recuento por estado", () => {
  it("con cero módulos, todo es cero", () => {
    expect(recuentoPorEstado([], AHORA)).toEqual({ total: 0, online: 0, stale: 0, offline: 0, pendiente: 0 });
  });

  it("un módulo `stale` NO suma como en línea aunque el backend lo marque online", () => {
    const r = recuentoPorEstado(
      [
        { online: true, lastSeenAt: haceMs(1_000) },
        { online: true, lastSeenAt: haceMs(10 * 60_000) },
        { online: false, lastSeenAt: haceMs(10 * 60_000) },
        { online: false, lastSeenAt: null },
      ],
      AHORA,
    );
    expect(r).toEqual({ total: 4, online: 1, stale: 1, offline: 1, pendiente: 1 });
  });
});

describe("estado de la lista: cargando / error / vacío comprobado", () => {
  it("un error NO es una lista vacía", () => {
    expect(estadoDeLista({ cargando: false, error: "sin red", datos: null })).toBe("error");
    // Y sigue siendo error aunque hubiera datos viejos en pantalla.
    expect(estadoDeLista({ cargando: false, error: "sin red", datos: [] })).toBe("error");
    expect(estadoDeLista({ cargando: false, error: "sin red", datos: [1] })).toBe("error");
  });

  it("datos aún sin llegar es `cargando`, nunca `vacio`", () => {
    expect(estadoDeLista({ cargando: true, error: null, datos: null })).toBe("cargando");
    expect(estadoDeLista({ cargando: false, error: null, datos: null })).toBe("cargando");
  });

  it("`vacio` sólo tras haber preguntado y no haber error", () => {
    expect(estadoDeLista({ cargando: false, error: null, datos: [] })).toBe("vacio");
  });

  it("con datos, con datos", () => {
    expect(estadoDeLista({ cargando: false, error: null, datos: [1, 2] })).toBe("con-datos");
  });
});

describe("estado de la configuración (depende del carril de backend)", () => {
  it("sin ningún dato NO es «aplicada»: es desconocida", () => {
    expect(estadoDeConfiguracion({}).estado).toBe("desconocida");
    expect(estadoDeConfiguracion({ desiredConfigVersion: 4 }).estado).toBe("desconocida");
    expect(estadoDeConfiguracion({ reportedConfigVersion: 4 }).estado).toBe("desconocida");
  });

  it("`pending|applied|failed` del backend mandan sobre la comparación de versiones", () => {
    expect(estadoDeConfiguracion({ configState: "applied" }).estado).toBe("aplicada");
    expect(estadoDeConfiguracion({ configState: "pending", desiredConfigVersion: 7 }).estado).toBe(
      "pendiente",
    );
    expect(estadoDeConfiguracion({ configState: "failed", desiredConfigVersion: 7 }).estado).toBe("fallida");
    // Aunque las versiones coincidan, un `failed` explícito no se pinta de verde.
    expect(
      estadoDeConfiguracion({ configState: "failed", desiredConfigVersion: 7, reportedConfigVersion: 7 })
        .estado,
    ).toBe("fallida");
  });

  it("con las dos versiones y sin estado, se comparan", () => {
    expect(estadoDeConfiguracion({ desiredConfigVersion: 7, reportedConfigVersion: 7 }).estado).toBe(
      "aplicada",
    );
    expect(estadoDeConfiguracion({ desiredConfigVersion: 8, reportedConfigVersion: 7 }).estado).toBe(
      "pendiente",
    );
    // Número y cadena con el mismo valor son la misma versión.
    expect(estadoDeConfiguracion({ desiredConfigVersion: 7, reportedConfigVersion: "7" }).estado).toBe(
      "aplicada",
    );
  });
});

describe("formato del silencio", () => {
  it.each([
    [0, "0 s"],
    [45_000, "45 s"],
    [5 * 60_000, "5 min"],
    [3 * 3_600_000, "3 h"],
    [5 * 24 * 3_600_000, "5 días"],
  ])("%i ms → %s", (ms, esperado) => {
    expect(formatearSilencio(ms)).toBe(esperado);
  });
});
