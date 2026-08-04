import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TestSensorsPage } from "./TestSensorsPage";
import * as diagnosticsApi from "../../api/diagnosticsApi";

/** Doble de la respuesta del servidor, con la forma completa del contrato. */
const ack = (
  over: Partial<diagnosticsApi.CommandAck> = {},
): diagnosticsApi.CommandAck => ({
  module_id: "m1",
  action: "led_test",
  command_id: "c",
  delivered: true,
  note: "",
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/modulos/mod-a/sensores"]}>
      <Routes>
        <Route path="/modulos/:moduleId/sensores" element={<TestSensorsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const empty: diagnosticsApi.DiagnosticResults = {
  module: "mod-a",
  moduleRegistered: true,
  items: [],
  note: "El módulo no ha respondido a ninguna prueba.",
};

describe("TestSensorsPage (F6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("dice que la prueba es del módulo entero, no de una diana", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(empty);
    renderPage();
    expect(
      await screen.findByText(/autodiagnóstico del módulo completo/),
    ).toBeInTheDocument();
  });

  it("pedir la prueba NO afirma que el sensor esté bien", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(empty);
    const test = vi
      .spyOn(diagnosticsApi, "testSensor")
      .mockResolvedValue(ack({ command_id: "c1", delivered: true, scope: "module" }));
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: "Probar" })[2]);
    await waitFor(() => expect(test).toHaveBeenCalledWith("mod-a", 3));
    expect(await screen.findByText(/Esperando la respuesta del módulo/)).toBeInTheDocument();
    // Nada de «Sensor OK» ni amplitudes inventadas.
    expect(screen.queryByText(/Sensor OK/)).toBeNull();
  });

  it("si la orden no llegó al broker se dice, no se finge que se probó", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(empty);
    vi.spyOn(diagnosticsApi, "testSensor").mockResolvedValue(ack({ command_id: "c1", delivered: false }));
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: "Probar" })[0]);
    expect(await screen.findByText(/NO llegó al broker/)).toBeInTheDocument();
  });

  it("sin respuestas del módulo no se da por buena ninguna diana", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(empty);
    renderPage();
    expect(
      await screen.findByText("El módulo no ha respondido a ninguna prueba."),
    ).toBeInTheDocument();
  });

  it("muestra lo que el módulo ha contestado de verdad", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue({
      module: "mod-a",
      moduleRegistered: true,
      note: null,
      items: [
        {
          id: "i1",
          kind: "self_test_result",
          severity: "error",
          message: "Sensor 4 sin respuesta",
          occurredAt: "2026-07-26T10:00:00Z",
          receivedAt: "2026-07-26T10:00:03Z",
          detail: null,
          timeBasis: "module_epoch",
        },
        {
          id: "i2",
          kind: "mqtt_disconnect",
          severity: "warning",
          message: "ruido que no toca",
          occurredAt: "2026-07-26T10:00:00Z",
          receivedAt: "2026-07-26T10:00:03Z",
          detail: null,
          timeBasis: "module_epoch",
        },
      ],
    });
    renderPage();
    expect(await screen.findByText("Sensor 4 sin respuesta")).toBeInTheDocument();
    // Sólo lo relacionado con la prueba: el resto de incidencias no se cuela.
    expect(screen.queryByText("ruido que no toca")).toBeNull();
  });

  it('la columna «Cuándo» distingue hora del módulo de mera recepción', async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue({
      module: "mod-a",
      moduleRegistered: true,
      note: null,
      items: [
        {
          id: "con-reloj",
          kind: "self_test_result",
          severity: "info",
          message: "Con reloj",
          occurredAt: "2026-07-26T10:00:00Z",
          receivedAt: "2026-07-26T10:00:03Z",
          detail: null,
          timeBasis: "module_epoch",
        },
        {
          id: "sin-reloj",
          kind: "calibration_result",
          severity: "info",
          message: "Sin reloj",
          occurredAt: null,
          receivedAt: "2026-07-26T10:00:05Z",
          detail: null,
          timeBasis: "ingest_received",
        },
      ],
    });

    renderPage();

    expect(await screen.findByText(/Hora del módulo:/)).toBeInTheDocument();
    expect(screen.getByText(/Módulo sin reloj · recibido:/)).toBeInTheDocument();
  });

  it("si la consulta falla lo dice", async () => {
    vi.spyOn(diagnosticsApi, "getDiagnostics").mockRejectedValue(new Error("Sin permiso"));
    renderPage();
    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();
  });
});

describe("TestSensorsPage · el sondeo existe de verdad (F6 · B3)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("vuelve a consultar sola: se podía borrar el temporizador y nada fallaba", async () => {
    vi.useFakeTimers();
    const consulta = vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(empty);
    renderPage();
    await vi.waitFor(() => expect(consulta).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3000);
    expect(consulta).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9000);
    expect(consulta).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });

  it("al salir de la pantalla deja de consultar", async () => {
    vi.useFakeTimers();
    const consulta = vi.spyOn(diagnosticsApi, "getDiagnostics").mockResolvedValue(empty);
    const { unmount } = renderPage();
    await vi.waitFor(() => expect(consulta).toHaveBeenCalledTimes(1));
    unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    // Sin `clearInterval`, la pantalla cerrada seguía pidiendo para siempre.
    expect(consulta).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
