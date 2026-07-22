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
