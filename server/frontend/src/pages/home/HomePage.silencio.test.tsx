import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "./HomePage";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";
import { apiClient, ApiError } from "../../api";
import type { SystemStatus } from "../../types/domain";

/**
 * EL FALLO MÁS FÁCIL DE ESTE CARRIL, atado con una prueba.
 *
 * `Inicio` desestructuraba sólo `data` de `useAsync` para módulos e
 * incidencias. Con `error` descartado, «no hay alertas» y «no he podido
 * preguntar» eran EL MISMO estado en pantalla, y el panel elegía la lectura
 * tranquilizadora: «Sin alertas activas». Un panel que dice OK porque no le
 * llegó nada es peor que uno que dice «sin datos», porque el operador se va a
 * casa.
 *
 * Cada caso va con su control: el mismo componente, la misma pantalla, una vez
 * con la respuesta que falla y otra con la que llega vacía de verdad.
 */

const ADMIN: AuthUser = {
  id: "a1",
  username: "admin",
  role: "administrador",
  permissions: ["*"],
  must_change_password: false,
};

const SISTEMA: SystemStatus = {
  id: "system-a",
  slug: "system-a",
  name: "Sistema de prueba",
  state: "ready",
  coordinator_module_id: "module-01",
  modules_expected: 9,
  modules_online: 5,
  conflicts: [],
  active_game_id: null,
};

function pintar() {
  return render(
    <AuthProvider initialUser={ADMIN}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Inicio · la ausencia de datos NO se pinta como «todo correcto»", () => {
  it("NEGATIVO: si las incidencias fallan, NO dice «sin alertas» y avisa de que no ha podido preguntar", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(SISTEMA);
    vi.spyOn(apiClient, "listModules").mockResolvedValue([]);
    vi.spyOn(apiClient, "listIncidents").mockRejectedValue(
      new ApiError("No se puede contactar con el servidor."),
    );

    pintar();

    const aviso = await screen.findByText(/NO se puede afirmar que no haya alertas/);
    expect(aviso).toBeInTheDocument();
    expect(screen.queryByText(/Sin alertas activas/)).not.toBeInTheDocument();
    // Y se puede reintentar: no es un callejón sin salida.
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("POSITIVO: si el servidor responde y no hay ninguna, sí lo dice — y dice que lo ha comprobado", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(SISTEMA);
    vi.spyOn(apiClient, "listModules").mockResolvedValue([]);
    vi.spyOn(apiClient, "listIncidents").mockResolvedValue([]);

    pintar();

    expect(await screen.findByText(/Sin alertas activas \(comprobado ahora mismo\)/)).toBeInTheDocument();
    expect(screen.queryByText(/NO se puede afirmar/)).not.toBeInTheDocument();
  });

  it("NEGATIVO: si los módulos fallan, no se queda en «Cargando módulos…» para siempre", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(SISTEMA);
    vi.spyOn(apiClient, "listModules").mockRejectedValue(new ApiError("El servidor no responde."));
    vi.spyOn(apiClient, "listIncidents").mockResolvedValue([]);

    pintar();

    expect(await screen.findByText("El servidor no responde.")).toBeInTheDocument();
    expect(screen.queryByText("Cargando módulos…")).not.toBeInTheDocument();
    // Y no se inventa un recuento: «0 módulos respondiendo» sería una medida.
    expect(screen.queryByText(/módulos respondiendo/)).not.toBeInTheDocument();
  });

  it("POSITIVO: con módulos de verdad, el recuento es el medido", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(SISTEMA);
    vi.spyOn(apiClient, "listModules").mockResolvedValue([
      { module_id: "m1" },
      { module_id: "m2" },
    ] as never);
    vi.spyOn(apiClient, "listIncidents").mockResolvedValue([]);

    pintar();

    expect(await screen.findByText("2 módulos respondiendo.")).toBeInTheDocument();
  });

  it("las alertas abiertas se listan y las resueltas no", async () => {
    vi.spyOn(apiClient, "getSystemStatus").mockResolvedValue(SISTEMA);
    vi.spyOn(apiClient, "listModules").mockResolvedValue([]);
    vi.spyOn(apiClient, "listIncidents").mockResolvedValue([
      { id: "i1", created_at: "", severity: "critical", source: "ingest", message: "abierta", resolved: false },
      { id: "i2", created_at: "", severity: "info", source: "ingest", message: "cerrada", resolved: true },
    ]);

    pintar();

    expect(await screen.findByText(/abierta/)).toBeInTheDocument();
    expect(screen.queryByText(/cerrada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin alertas activas/)).not.toBeInTheDocument();
  });
});
