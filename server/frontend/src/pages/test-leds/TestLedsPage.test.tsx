import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TestLedsPage } from "./TestLedsPage";
import { apiClient } from "../../api";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/modulos/m1/prueba-leds"]}>
      <Routes>
        <Route path="/modulos/:moduleId/prueba-leds" element={<TestLedsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestLedsPage (G-A: toggle y apagar)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("el mismo botón enciende y, al repetir, apaga (off)", async () => {
    const led = vi.spyOn(apiClient, "testLed").mockResolvedValue({ command_id: "c" });
    renderPage();

    // Primer botón "Aplicar" de la diana 1 (estado 'safe').
    const firstApply = screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0];
    await userEvent.click(firstApply);
    await waitFor(() => expect(led).toHaveBeenCalledWith("m1", 1, "safe"));

    // Ahora ese botón pasa a "Apagar": al pulsarlo envía 'off'.
    const offBtn = await screen.findByRole("button", { name: /Apagar estado .* en la diana 1/ });
    await userEvent.click(offBtn);
    await waitFor(() => expect(led).toHaveBeenLastCalledWith("m1", 1, "off"));
  });

  it("'Apagar todas' envía off a las 9 dianas", async () => {
    const led = vi.spyOn(apiClient, "testLed").mockResolvedValue({ command_id: "c" });
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Apagar todas" }));
    await waitFor(() => expect(led).toHaveBeenCalledTimes(9));
    for (let i = 1; i <= 9; i++) expect(led).toHaveBeenCalledWith("m1", i, "off");
  });

  it("muestra el botón de volver", () => {
    vi.spyOn(apiClient, "testLed").mockResolvedValue({ command_id: "c" });
    renderPage();
    expect(screen.getByRole("button", { name: "← Volver" })).toBeInTheDocument();
  });
});

describe("TestLedsPage · no pinta lo que no ha ocurrido (F6 · B2)", () => {
  it("si el servidor rechaza la orden, la diana NO se pinta encendida", async () => {
    const { ApiError } = await import("../../api/client");
    vi.spyOn(apiClient, "testLed").mockRejectedValue(new ApiError("Estado no admitido"));
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    expect(await screen.findByText("Estado no admitido")).toBeInTheDocument();
    // Lo que importa NO es que salga el error, sino que la rejilla no mienta:
    // comprobar sólo el texto dejaba pasar el pintado optimista, que es
    // exactamente el defecto que este bloque dice cerrar.
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });

  it("si la orden no llegó al broker se dice, y tampoco se pinta", async () => {
    vi.spyOn(apiClient, "testLed").mockResolvedValue({ command_id: "c1", delivered: false });
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    expect(await screen.findByText(/NO llegó al broker/)).toBeInTheDocument();
    // Aceptada por el servidor pero encolada sin salir: tampoco se pinta.
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });

  it("cuando la orden SÍ sale, la diana se pinta (si no, no probaríamos nada)", async () => {
    // Control de la comprobación de arriba: sin este caso, unas pruebas que
    // exigen «ninguna diana encendida» pasarían aunque la pantalla no pintara
    // nunca.
    vi.spyOn(apiClient, "testLed").mockResolvedValue({ command_id: "c1", delivered: true });
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { pressed: true }).length).toBeGreaterThan(0),
    );
  });

  it("manda un ESTADO del contrato, no un patrón inventado", async () => {
    const led = vi.spyOn(apiClient, "testLed").mockResolvedValue({ command_id: "c1", delivered: true });
    renderPage();
    await userEvent.click(screen.getAllByRole("button", { name: /Aplicar estado .* en la diana 1/ })[0]);
    await waitFor(() => expect(led).toHaveBeenCalled());
    const estado = led.mock.calls[0][2];
    expect(["off", "safe", "active", "hit", "countdown", "penalty", "error", "calibration", "maintenance"]).toContain(estado);
  });
});
