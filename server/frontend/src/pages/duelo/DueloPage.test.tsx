import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DueloPage } from "./DueloPage";
import { DEMO_TARGET_COUNT } from "../demo/demoLogic";

function renderPage() {
  return render(
    <MemoryRouter>
      <DueloPage />
    </MemoryRouter>,
  );
}

/** Impacta la diana activa dentro de un contenedor concreto. */
async function clickActiveIn(container: HTMLElement) {
  const active = container.querySelector('[data-state="active"]') as HTMLElement | null;
  if (active) await userEvent.click(active);
  return active;
}

describe("DueloPage (G-E) · 1vs1 a la vez", () => {
  it("por defecto es simultáneo; el primero que completa gana con más aciertos", async () => {
    renderPage();
    // Formato simultáneo por defecto.
    expect(screen.getByLabelText(/A la vez/)).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Empezar duelo" }));
    await userEvent.click(await screen.findByRole("button", { name: "¡Ya!" }));

    // Dos rejillas (una por jugador). El jugador 1 completa toda su secuencia.
    const p1Grid = screen.getByRole("group", { name: "Dianas de Jugador 1" });
    for (let i = 0; i < DEMO_TARGET_COUNT; i++) {
      const el = await clickActiveIn(p1Grid);
      if (!el) break;
    }

    // La ronda termina en cuanto el jugador 1 completa → gana con 12 aciertos.
    expect(await screen.findByText("Resultado del duelo")).toBeInTheDocument();
    expect(screen.getByText(/Gana:/)).toHaveTextContent("Jugador 1");
    // El rival (Jugador 2) queda con 0 aciertos.
    const rows = screen.getAllByRole("row");
    const j2 = rows.find((r) => within(r).queryByRole("cell", { name: "Jugador 2" }));
    expect(within(j2!).getByRole("cell", { name: "0" })).toBeInTheDocument();
  });

  it("permite cambiar a por turnos y añadir un tercer jugador", async () => {
    renderPage();
    await userEvent.click(screen.getByLabelText(/Por turnos/));
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Añadir jugador" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });
});
