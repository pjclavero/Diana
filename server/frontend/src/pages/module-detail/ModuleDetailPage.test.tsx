import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ModuleDetailPage } from "./ModuleDetailPage";
import { apiClient } from "../../api";
import { ApiError } from "../../api/client";
import type { ModuleConfig, ModuleStatus } from "../../types/domain";

function modulo(over: Partial<ModuleStatus> = {}): ModuleStatus {
  return {
    module_id: "m1",
    system_id: "system-a",
    state: "ready",
    selector: 1,
    role: "principal",
    position: { x: 0, y: 0 },
    rotation: 0,
    targets: [],
    queue_depth: 0,
    firmware_version: "1.0.0",
    uptime_s: 10,
    ...over,
  } as ModuleStatus;
}

function config(over: Partial<ModuleConfig> = {}): ModuleConfig {
  return {
    module_id: "m1",
    config_version: 3,
    system_id: "system-a",
    position: { x: 0, y: 0 },
    rotation: 0,
    friendly_name: "Diana 1",
    led_brightness_max: 0,
    telemetry_interval_ms: 0,
    network: { mode: "dhcp", ip: null, netmask: null, gateway: null },
    calibration: [],
    ...over,
  } as ModuleConfig;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/modulos/m1"]}>
      <Routes>
        <Route path="/modulos/:moduleId" element={<ModuleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ModuleDetailPage · nada se calla", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, "getModule").mockResolvedValue(modulo());
    vi.spyOn(apiClient, "getModuleConfig").mockResolvedValue(config());
    vi.spyOn(apiClient, "getModuleTelemetry").mockRejectedValue(new ApiError("telemetría no servida"));
  });

  it("si la telemetría falla, la tarjeta lo DICE en vez de desaparecer", async () => {
    renderPage();

    // El título sigue ahí (la tarjeta no se esfuma) y el motivo es visible.
    expect(await screen.findByRole("heading", { name: "Diagnóstico rápido" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/telemetría no servida/);
  });

  it("la configuración muestra lo que el backend sirve y declara lo que no", async () => {
    renderPage();

    expect(await screen.findByText("v3")).toBeInTheDocument();
    const nota = screen.getByText(/El backend no sirve todavía/);
    expect(nota).toHaveTextContent(/led_brightness_max/);
    expect(nota).toHaveTextContent(/telemetry_interval_ms/);
    // Y los ceros de relleno NO se pintan como si fueran una medida.
    expect(screen.queryByText(/0 ms/)).not.toBeInTheDocument();
  });

  it("si «Identificar» falla, la pantalla lo dice (no se queda como si hubiera ido bien)", async () => {
    vi.spyOn(apiClient, "identifyModule").mockRejectedValue(new ApiError("No tiene permiso para esta acción."));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Identificar módulo/ }));

    expect(await screen.findByText(/No tiene permiso para esta acción\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Identificar módulo/ })).toBeEnabled();
  });

  it("un acuse con `delivered: false` NO se pinta como éxito", async () => {
    vi.spyOn(apiClient, "identifyModule").mockResolvedValue({ command_id: "c1", delivered: false });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Identificar módulo/ }));

    // Hay más de un `alert` en la página (la telemetría también falla en este
    // banco): se busca el texto, no el rol.
    expect(await screen.findByText(/NO se entregó al módulo/)).toBeInTheDocument();
  });

  it("un acuse SIN `delivered` no se interpreta como entregado", async () => {
    vi.spyOn(apiClient, "identifyModule").mockResolvedValue({ command_id: "c1" });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Identificar módulo/ }));

    expect(await screen.findByText(/no informa de si la orden llegó/)).toBeInTheDocument();
  });

  it("un acuse entregado sí se confirma", async () => {
    vi.spyOn(apiClient, "identifyModule").mockResolvedValue({ command_id: "c1", delivered: true });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /Identificar módulo/ }));

    const exito = await screen.findByText(/debe estar parpadeando/);
    // Y se anuncia como estado, no como alerta.
    expect(exito).toHaveAttribute("role", "status");
    expect(screen.queryByText(/NO se entregó/)).not.toBeInTheDocument();
  });
});
