import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CalibrationPage } from "./CalibrationPage";
import * as diagnosticsApi from "../../api/diagnosticsApi";
import { ApiError } from "../../api/client";

/**
 * Esta pantalla no tenía NINGUNA prueba y colgaba del adaptador de
 * demostración: mostraba una tabla de umbrales, histéresis y ruido base que el
 * navegador se inventaba, y el backend ni siquiera expone esa configuración.
 *
 * Lo que se comprueba aquí es que ya no promete nada que no ocurra: que la
 * orden sale de verdad, que se dice cuando NO ha salido, y que el alcance real
 * (el contrato calibra el MÓDULO entero) queda claro para el operador.
 */

const ack = (over: Partial<diagnosticsApi.CommandAck> = {}): diagnosticsApi.CommandAck => ({
  module_id: "mod-a",
  action: "start_calibration",
  command_id: "c1",
  delivered: true,
  note: "",
  target_index: 3,
  scope: "module",
  ...over,
});

const sinResultados: diagnosticsApi.DiagnosticResults = {
  module: "mod-a",
  moduleRegistered: true,
  items: [],
  note: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/modulos/mod-a/calibracion"]}>
      <Routes>
        <Route path="/modulos/:moduleId/calibracion" element={<CalibrationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CalibrationPage (F6) · habla con la API real", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it("calibrar envía la orden al módulo de verdad", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(sinResultados);
    const calibrate = vi.spyOn(diagnosticsApi, "calibrateTarget").mockResolvedValue(ack());
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Calibrar desde la diana 3/ }));
    await waitFor(() => expect(calibrate).toHaveBeenCalledWith("mod-a", 3));
  });

  it("DICE que se calibra el módulo entero, no sólo esa diana", async () => {
    // El contrato v1 no calibra dianas sueltas. Callarlo dejaría al operador
    // creyendo que ha tocado sólo una.
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(sinResultados);
    vi.spyOn(diagnosticsApi, "calibrateTarget").mockResolvedValue(ack({ scope: "module" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Calibrar desde la diana 1/ }));
    expect(await screen.findByText(/MÓDULO completo/)).toBeInTheDocument();
  });

  it("si la orden NO llegó al broker se dice, en vez de darla por hecha", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(sinResultados);
    vi.spyOn(diagnosticsApi, "calibrateTarget").mockResolvedValue(ack({ delivered: false }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Calibrar desde la diana 2/ }));
    expect(await screen.findByText(/NO llegó al broker/)).toBeInTheDocument();
  });

  it("un rechazo del servidor se muestra con SU motivo, no con uno inventado", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(sinResultados);
    vi.spyOn(diagnosticsApi, "calibrateTarget").mockRejectedValue(
      new ApiError("La diana 4 está deshabilitada: no se calibra."),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Calibrar desde la diana 4/ }));
    expect(await screen.findByText(/está deshabilitada/)).toBeInTheDocument();
  });

  it("sin respuestas del módulo lo dice, en vez de inventar parámetros", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(sinResultados);
    renderPage();
    expect(await screen.findByText(/no ha respondido a ninguna calibración/)).toBeInTheDocument();
  });

  it("muestra lo que el módulo ha respondido de verdad", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue({
      ...sinResultados,
      items: [
        {
          id: "i1",
          kind: "calibration_result",
          severity: "info",
          message: "Calibración terminada",
          detail: null,
          occurredAt: "2026-08-04T10:00:00.000Z",
          receivedAt: "2026-08-04T10:00:03.000Z",
          timeBasis: "module_epoch",
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/Calibración terminada/)).toBeInTheDocument();
    expect(screen.getByText(/Hora del módulo/)).toBeInTheDocument();
  });

  it("si el módulo no tiene reloj se dice, en vez de dar la hora de ingesta como suya", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue({
      ...sinResultados,
      items: [
        {
          id: "i2",
          kind: "sensor_error",
          severity: "error",
          message: "Sensor 4 sin respuesta",
          detail: null,
          occurredAt: null,
          receivedAt: "2026-08-04T10:00:03.000Z",
          timeBasis: "ingest_received",
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/Módulo sin reloj/)).toBeInTheDocument();
  });

  it("abortar usa la orden del contrato", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(sinResultados);
    const abort = vi
      .spyOn(diagnosticsApi, "abortCalibration")
      .mockResolvedValue(ack({ action: "abort_calibration" }));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Abortar calibración" }));
    await waitFor(() => expect(abort).toHaveBeenCalledWith("mod-a"));
  });

  it("deja de consultar al salir de la pantalla", async () => {
    // Un intervalo que sobrevive al desmontaje sigue pidiendo al servidor
    // eternamente y ensucia las pruebas que vengan detrás.
    vi.useFakeTimers();
    const get = vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(sinResultados);
    const { unmount } = renderPage();
    await vi.advanceTimersByTimeAsync(3100);
    const antes = get.mock.calls.length;
    unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(get.mock.calls.length).toBe(antes);
  });
});
