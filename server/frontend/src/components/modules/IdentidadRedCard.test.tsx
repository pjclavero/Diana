import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentidadRedCard } from "./IdentidadRedCard";
import * as filaApi from "../../api/moduleRowApi";
import type { FilaModuloCompleta } from "../../api/moduleRowApi";

/**
 * La tarjeta existe porque la IP, la MAC y el serie de un módulo NO se veían
 * en ninguna pantalla del panel. Estas pruebas vigilan las dos cosas que
 * podrían hacerla inútil sin que se note:
 *
 *  - que deje de pintar alguno de esos campos, y
 *  - que un módulo que NUNCA ha conectado se pinte como si estuviera vivo.
 *
 * La segunda es la que importa: `last_seen_at = NULL` con `online = false` es
 * PENDIENTE, y con `online = true` es «sin confirmar» — nunca «en línea».
 */

const FILA: FilaModuloCompleta = {
  id: "m1",
  slug: "module-01",
  friendlyName: "Módulo de banco",
  serial: "SN-0001",
  mac: "AA:BB:CC:DD:EE:FF",
  ip: "192.168.1.77",
  hardwareRevision: "rev-B",
  targetBoard: "esp32s3",
  firmwareVersion: "1.4.2",
  online: true,
  lastSeenAt: new Date().toISOString(),
  desiredConfigVersion: 7,
  reportedConfigVersion: 7,
  configState: "applied",
};

describe("IdentidadRedCard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("enseña IP, MAC, serie, firmware y las dos versiones de configuración", async () => {
    vi.spyOn(filaApi, "obtenerModulo").mockResolvedValue(FILA);

    render(<IdentidadRedCard moduleId="m1" />);

    expect(await screen.findByText("192.168.1.77")).toBeInTheDocument();
    expect(screen.getByText("AA:BB:CC:DD:EE:FF")).toBeInTheDocument();
    expect(screen.getByText("SN-0001")).toBeInTheDocument();
    expect(screen.getByText("1.4.2")).toBeInTheDocument();
    // Los nombres del backend, literales: son los que hay que poder casar con
    // la fila de PostgreSQL sin traducir nada.
    expect(screen.getByText("desired_config_version")).toBeInTheDocument();
    expect(screen.getByText("reported_config_version")).toBeInTheDocument();
    expect(screen.getByText("last_seen_at")).toBeInTheDocument();
  });

  it("un módulo que nunca ha conectado sale PENDIENTE y dice que last_seen_at es NULL", async () => {
    vi.spyOn(filaApi, "obtenerModulo").mockResolvedValue({
      ...FILA,
      online: false,
      lastSeenAt: null,
      reportedConfigVersion: null,
      desiredConfigVersion: 0,
      configState: "pending",
    });

    render(<IdentidadRedCard moduleId="m1" />);

    expect(await screen.findByText("pendiente")).toBeInTheDocument();
    expect(screen.getByText(/no ha dado señal NUNCA/)).toBeInTheDocument();
    expect(screen.getByText(/no ha reportado ninguna versión/)).toBeInTheDocument();
    // Y en ningún caso se afirma que esté en línea.
    expect(screen.queryByText("en línea")).not.toBeInTheDocument();
  });

  it("`online` a true sin ninguna señal NO se pinta como «en línea»", async () => {
    vi.spyOn(filaApi, "obtenerModulo").mockResolvedValue({
      ...FILA,
      online: true,
      lastSeenAt: null,
    });

    render(<IdentidadRedCard moduleId="m1" />);

    expect(await screen.findByText("sin confirmar")).toBeInTheDocument();
    expect(screen.queryByText("en línea")).not.toBeInTheDocument();
    // La bandera cruda se sigue enseñando: es la mitad del desacuerdo.
    expect(screen.getByText("online")).toBeInTheDocument();
  });

  it("un fallo de la consulta se dice, no se pinta como campos vacíos", async () => {
    vi.spyOn(filaApi, "obtenerModulo").mockRejectedValue(new Error("sin red"));

    render(<IdentidadRedCard moduleId="m1" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("no consta")).not.toBeInTheDocument();
  });
});
