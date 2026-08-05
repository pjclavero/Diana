import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewGamePage } from "./NewGamePage";

function renderPage() {
  return render(
    <MemoryRouter>
      <NewGamePage />
    </MemoryRouter>,
  );
}

describe("NewGamePage · modos de juego (auditoría 2026-08-05 §4, G2)", () => {
  it("ofrece exactamente los cinco modos que el motor implementa, con sus claves reales", () => {
    renderPage();
    const select = screen.getByLabelText(/modo de juego/i) as HTMLSelectElement;
    const options = within(select).getAllByRole("option") as HTMLOptionElement[];
    const values = options.map((o) => o.value);
    // Claves reales de `readonly key = ` en src/domain/game/strategies/*.ts.
    expect(values).toEqual(["random", "sequence", "all_against_clock", "reaction", "duelo"]);
  });

  it("no ofrece «memoria» ni «no disparar»: no existen en el motor", () => {
    renderPage();
    const select = screen.getByLabelText(/modo de juego/i);
    expect(within(select).queryByText("Memoria")).not.toBeInTheDocument();
    expect(within(select).queryByText("No disparar")).not.toBeInTheDocument();
  });

  it("no ofrece las claves incorrectas antiguas (all_vs_clock, duel)", () => {
    renderPage();
    const select = screen.getByLabelText(/modo de juego/i) as HTMLSelectElement;
    const values = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).not.toContain("all_vs_clock");
    expect(values).not.toContain("duel");
  });
});
