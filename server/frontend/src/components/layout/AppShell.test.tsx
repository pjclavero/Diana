import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";

const ADMIN: AuthUser = {
  id: "a1",
  username: "admin",
  role: "administrador",
  permissions: ["*"],
  must_change_password: false,
};

const JUGADOR: AuthUser = {
  id: "j1",
  username: "paco",
  role: "jugador",
  permissions: ["profile:read"],
  must_change_password: false,
};

function renderShell(user: AuthUser) {
  return render(
    <AuthProvider initialUser={user}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<p>contenido de inicio</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("AppShell (navegación responsive)", () => {
  it("expone un botón de menú accesible por teclado que abre/cierra la navegación (comportamiento móvil)", async () => {
    const user = userEvent.setup();
    renderShell(ADMIN);
    const menuBtn = screen.getByRole("button", { name: /menú/i });
    expect(menuBtn).toHaveAttribute("aria-expanded", "false");
    await user.click(menuBtn);
    expect(menuBtn).toHaveAttribute("aria-expanded", "true");
  });

  it("incluye un enlace 'saltar al contenido' para navegación por teclado", () => {
    renderShell(ADMIN);
    expect(screen.getByText(/saltar al contenido/i)).toBeInTheDocument();
  });

  it("el administrador ve todas las secciones del encargo", () => {
    renderShell(ADMIN);
    expect(screen.getByRole("navigation", { name: /navegación principal/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /editor de matriz/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /nueva partida/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /usuarios y permisos/i })).toBeInTheDocument();
  });

  it("muestra el usuario y permite cerrar sesión", () => {
    renderShell(ADMIN);
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it("un jugador NO ve las secciones de gestión (filtrado por permisos del rol)", () => {
    renderShell(JUGADOR);
    expect(screen.getByRole("link", { name: "Inicio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /estadísticas/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /usuarios y permisos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /editor de matriz/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /firmware/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /módulos/i })).not.toBeInTheDocument();
  });
});
