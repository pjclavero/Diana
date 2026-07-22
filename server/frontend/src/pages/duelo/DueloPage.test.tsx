import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DueloPage } from "./DueloPage";
import { DEMO_TARGET_COUNT } from "../demo/demoLogic";

async function playTurn() {
  for (let i = 0; i < DEMO_TARGET_COUNT; i++) {
    const active = document.querySelector('[data-state="active"]') as HTMLElement | null;
    if (!active) break;
    await userEvent.click(active);
  }
}

describe("DueloPage (G-E práctica de duelo)", () => {
  it("juega dos turnos con la misma secuencia y muestra un ganador", async () => {
    render(
      <MemoryRouter>
        <DueloPage />
      </MemoryRouter>,
    );

    // Setup con 2 jugadores por defecto.
    await userEvent.click(screen.getByRole("button", { name: "Empezar duelo" }));

    // Turno del jugador 1.
    expect(await screen.findByText(/Turno de Jugador 1/)).toBeInTheDocument();
    await playTurn();

    // Pausa entre turnos → jugador 2 empieza su turno.
    await userEvent.click(await screen.findByRole("button", { name: "Empezar mi turno" }));
    expect(await screen.findByText(/Turno de Jugador 2/)).toBeInTheDocument();
    await playTurn();

    // Resultado con ganador y tabla.
    expect(await screen.findByText("Resultado del duelo")).toBeInTheDocument();
    expect(screen.getByText(/Gana:/)).toBeInTheDocument();
    // Ambos jugadores en la tabla.
    expect(screen.getByRole("cell", { name: "Jugador 1" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Jugador 2" })).toBeInTheDocument();
  });

  it("permite añadir un tercer jugador en el setup", async () => {
    render(
      <MemoryRouter>
        <DueloPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Añadir jugador" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });
});
