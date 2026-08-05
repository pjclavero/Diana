import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "./HomePage";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";
import { apiClient } from "../../api";
import type { SystemStatus } from "../../types/domain";

const ADMIN: AuthUser = { id: "a1", username: "admin", role: "administrador", permissions: ["*"], must_change_password: false };
const JUGADOR: AuthUser = { id: "j1", username: "paco", role: "jugador", permissions: ["profile:read"], must_change_password: false };

function status(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    id: "system-a",
    slug: "system-a",
    name: "Sistema de prueba",
    state: "ready",
    coordinator_module_id: "module-01",
    modules_expected: 9,
    modules_online: 5,
    conflicts: [],
    active_game_id: null,
    ...over,
  };
}

function renderPage(user: AuthUser) {
  return render(
    <AuthProvider initialUser={user}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HomePage · fusión con `system` (auditoría 2026-08-05 §4, G4)", () => {
  it("con systems:read, muestra la tarjeta de Conflictos y no afirma «sin conflictos detectados» a secas", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(status({ conflicts: [] }));
    renderPage(ADMIN);
    expect(await screen.findByRole("heading", { name: "Conflictos" })).toBeInTheDocument();
    // La afirmación desnuda que denunciaba la auditoría no debe aparecer.
    expect(screen.queryByText("Sin conflictos detectados.")).not.toBeInTheDocument();
    // Debe decir qué se comprueba de verdad.
    expect(screen.getByText(/comprueba hoy/)).toBeInTheDocument();
  });

  it("con un conflicto real, lo lista traducido y menciona el bloqueo si aplica", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(status({ conflicts: ["dual_principal"] }));
    renderPage(ADMIN);
    expect(await screen.findByRole("alert")).toHaveTextContent(/PRINCIPAL/);
    expect(screen.getByRole("alert")).toHaveTextContent(/bloqueado/);
  });

  it("sin systems:read, no se muestra la tarjeta de Conflictos ni el estado del sistema con ese detalle", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(status({ conflicts: ["dual_principal"] }));
    renderPage(JUGADOR);
    await screen.findByText(/módulos respondiendo|cargando módulos/i);
    expect(screen.queryByRole("heading", { name: "Conflictos" })).not.toBeInTheDocument();
  });
});
