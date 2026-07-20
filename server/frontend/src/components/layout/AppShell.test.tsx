import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>contenido de inicio</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell (navegación responsive)", () => {
  it("expone un botón de menú accesible por teclado que abre/cierra la navegación (comportamiento móvil)", async () => {
    const user = userEvent.setup();
    renderShell();
    const menuBtn = screen.getByRole("button", { name: /menú/i });
    expect(menuBtn).toHaveAttribute("aria-expanded", "false");
    await user.click(menuBtn);
    expect(menuBtn).toHaveAttribute("aria-expanded", "true");
  });

  it("incluye un enlace 'saltar al contenido' para navegación por teclado", () => {
    renderShell();
    expect(screen.getByText(/saltar al contenido/i)).toBeInTheDocument();
  });

  it("renderiza la navegación principal con las secciones del encargo", () => {
    renderShell();
    expect(screen.getByRole("navigation", { name: /navegación principal/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /editor de matriz/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /nueva partida/i })).toBeInTheDocument();
  });
});
