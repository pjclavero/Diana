import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DemoPage } from "./DemoPage";
import { DEMO_TARGET_COUNT } from "./demoLogic";

function renderPage() {
  return render(
    <MemoryRouter>
      <DemoPage />
    </MemoryRouter>,
  );
}

/** Impacta la diana encendida hasta completar la secuencia. */
async function playThrough() {
  for (let i = 0; i < DEMO_TARGET_COUNT; i++) {
    const active = document.querySelector('[data-state="active"]') as HTMLElement | null;
    if (!active) break;
    await userEvent.click(active);
  }
}

describe("DemoPage (G-E modo demo)", () => {
  beforeEach(() => sessionStorage.clear());

  it("al empezar enciende una sola diana y no persiste en la BD (sólo sesión)", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Empezar demo" }));
    expect(document.querySelectorAll('[data-state="active"]')).toHaveLength(1);
    expect(screen.getByText(/Diana 1 de 12/)).toBeInTheDocument();
  });

  it("completar la secuencia muestra un tiempo y lo añade a los últimos tiempos de la sesión", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Empezar demo" }));
    await playThrough();

    expect(await screen.findByText(/¡Hecho! Tiempo:/)).toBeInTheDocument();
    expect(screen.getByText("Últimos 10 tiempos (sólo esta sesión)")).toBeInTheDocument();
    // Se guardó un tiempo en la sesión.
    expect(JSON.parse(sessionStorage.getItem("diana.demo.times") ?? "[]")).toHaveLength(1);
    // El botón pasa a "Repetir".
    expect(screen.getByRole("button", { name: "Repetir" })).toBeInTheDocument();
  });
});
