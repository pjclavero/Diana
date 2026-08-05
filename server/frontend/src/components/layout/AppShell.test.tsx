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

  it("un jugador SÍ llega a «Acceso de gestor»: es su pantalla (F5, §3.1 paso 3)", () => {
    // Su destinatario es justo un jugador recién comprador. Con el enlace
    // filtrado por permisos, la pantalla sólo se alcanzaba tecleando la URL y
    // el paso 3 del encargo no se podía ejercer desde el panel.
    renderShell(JUGADOR);
    expect(screen.getByRole("link", { name: /acceso de gestor/i })).toBeInTheDocument();
  });

  it("no ofrece enlaces a pantallas retiradas o fusionadas (auditoría 2026-08-05 §4)", () => {
    renderShell(ADMIN);
    // G1: `backups` retirada del menú.
    expect(screen.queryByRole("link", { name: /copias/i })).not.toBeInTheDocument();
    // `results` retirada: redirige a Marcador, no tiene entrada propia.
    expect(screen.queryByRole("link", { name: "Resultados" })).not.toBeInTheDocument();
    // G4: `system` se fusionó con Inicio, no tiene entrada propia.
    expect(screen.queryByRole("link", { name: /estado del sistema/i })).not.toBeInTheDocument();
  });
});
