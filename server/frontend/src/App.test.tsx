import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import type { AuthUser } from "./auth/authApi";

function renderApp(initialUser: AuthUser | null) {
  return render(
    <AuthProvider initialUser={initialUser}>
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const BASE: AuthUser = { id: "u1", username: "admin", role: "administrador", permissions: ["*"], must_change_password: false };

describe("App · guard de sesión", () => {
  it("sin sesión muestra el login", () => {
    renderApp(null);
    expect(screen.getByRole("heading", { name: /iniciar sesión/i })).toBeInTheDocument();
  });

  it("con must_change_password fuerza el cambio de contraseña antes del panel", () => {
    renderApp({ ...BASE, must_change_password: true });
    expect(screen.getByRole("heading", { name: /cambia tu contraseña/i })).toBeInTheDocument();
    // No debe haberse renderizado el panel todavía.
    expect(screen.queryByText("Diana · Panel de control")).not.toBeInTheDocument();
  });

  it("con sesión válida y contraseña ya rotada muestra el panel", () => {
    renderApp(BASE);
    expect(screen.getByText("Diana · Panel de control")).toBeInTheDocument();
  });
});
