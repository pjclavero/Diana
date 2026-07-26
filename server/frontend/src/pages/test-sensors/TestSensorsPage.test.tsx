import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TestSensorsPage } from "./TestSensorsPage";
import { apiClient } from "../../api";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/modulos/mod-a/sensores"]}>
      <Routes>
        <Route path="/modulos/:moduleId/sensores" element={<TestSensorsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const empty = { module: "mod-a", items: [], note: "El módulo no ha respondido a ninguna prueba." };

describe("TestSensorsPage (F6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("dice que la prueba es del módulo entero, no de una diana", async () => {
    vi.spyOn(apiClient, "getModuleDiagnostics").mockResolvedValue(empty);
    renderPage();
    expect(
      await screen.findByText(/autodiagnóstico del módulo completo/),
    ).toBeInTheDocument();
  });

  it("pedir la prueba NO afirma que el sensor esté bien", async () => {
    vi.spyOn(apiClient, "getModuleDiagnostics").mockResolvedValue(empty);
    const test = vi
      .spyOn(apiClient, "testSensor")
      .mockResolvedValue({ command_id: "c1", delivered: true, scope: "module" });
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: "Probar" })[2]);
    await waitFor(() => expect(test).toHaveBeenCalledWith("mod-a", 3));
    expect(await screen.findByText(/Esperando la respuesta del módulo/)).toBeInTheDocument();
    // Nada de «Sensor OK» ni amplitudes inventadas.
    expect(screen.queryByText(/Sensor OK/)).toBeNull();
  });

  it("si la orden no llegó al broker se dice, no se finge que se probó", async () => {
    vi.spyOn(apiClient, "getModuleDiagnostics").mockResolvedValue(empty);
    vi.spyOn(apiClient, "testSensor").mockResolvedValue({ command_id: "c1", delivered: false });
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: "Probar" })[0]);
    expect(await screen.findByText(/NO llegó al broker/)).toBeInTheDocument();
  });

  it("sin respuestas del módulo no se da por buena ninguna diana", async () => {
    vi.spyOn(apiClient, "getModuleDiagnostics").mockResolvedValue(empty);
    renderPage();
    expect(
      await screen.findByText("El módulo no ha respondido a ninguna prueba."),
    ).toBeInTheDocument();
  });

  it("muestra lo que el módulo ha contestado de verdad", async () => {
    vi.spyOn(apiClient, "getModuleDiagnostics").mockResolvedValue({
      module: "mod-a",
      note: null,
      items: [
        {
          id: "i1",
          kind: "self_test_result",
          severity: "error",
          message: "Sensor 4 sin respuesta",
          occurredAt: "2026-07-26T10:00:00Z",
        },
        {
          id: "i2",
          kind: "mqtt_disconnect",
          severity: "warning",
          message: "ruido que no toca",
          occurredAt: "2026-07-26T10:00:00Z",
        },
      ],
    });
    renderPage();
    expect(await screen.findByText("Sensor 4 sin respuesta")).toBeInTheDocument();
    // Sólo lo relacionado con la prueba: el resto de incidencias no se cuela.
    expect(screen.queryByText("ruido que no toca")).toBeNull();
  });

  it("si la consulta falla lo dice", async () => {
    vi.spyOn(apiClient, "getModuleDiagnostics").mockRejectedValue(new Error("Sin permiso"));
    renderPage();
    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();
  });
});
