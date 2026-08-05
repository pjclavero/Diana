import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import type { AuthUser } from "./auth/authApi";
import * as scoreboardApi from "./api/scoreboardApi";

function renderApp(initialUser: AuthUser | null, initialEntries: string[] = ["/"]) {
  return render(
    <AuthProvider initialUser={initialUser}>
      <MemoryRouter initialEntries={initialEntries}>
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

describe("App · pantallas retiradas o fusionadas (auditoría 2026-08-05 §4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("`/copias` ya no existe: retirada del menú y de las rutas (G1)", () => {
    renderApp(BASE, ["/copias"]);
    expect(screen.getByText(/página no encontrada|no encontrada/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /copias/i })).not.toBeInTheDocument();
  });

  it("`/resultados` (sin identificador) redirige al selector de Marcador, no carga ninguna partida concreta", async () => {
    const listSpy = vi.spyOn(scoreboardApi, "listRecentGames").mockResolvedValue([]);
    const getSpy = vi.spyOn(scoreboardApi, "getScoreboard");
    renderApp(BASE, ["/resultados"]);
    expect(await screen.findByRole("heading", { name: "Marcador" })).toBeInTheDocument();
    // Prueba positiva de qué pantalla es: el selector pide la lista de
    // partidas recientes (`ScoreboardPicker`), no una partida por id.
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("`/resultados/:gameId` redirige a `/marcador/:gameId` CONSERVANDO el identificador", async () => {
    // O2 (revisión independiente): la versión anterior de esta prueba sólo
    // comprobaba el encabezado «Marcador» y la ausencia de «elija una
    // partida» — cierto con o sin gameId, porque en el entorno de prueba
    // `listRecentGames` (mock) devuelve una lista vacía y ese texto sólo se
    // pinta cuando hay partidas recientes; un mutante que hiciera perder el
    // gameId en la redirección seguía en verde. Ahora se espía la llamada
    // real a `getScoreboard` y se comprueba el argumento con el que se
    // invoca: eso sí distingue "con identificador" de "sin él".
    const getSpy = vi.spyOn(scoreboardApi, "getScoreboard").mockResolvedValue(
      // No hace falta un Scoreboard completo: sólo importa que SE LLAME con
      // el id correcto; ScoreboardPage tolera una promesa que nunca resuelve
      // aquí porque no se comprueba el contenido renderizado.
      new Promise(() => {}) as never,
    );
    renderApp(BASE, ["/resultados/game-42"]);
    expect(getSpy).toHaveBeenCalledWith("game-42");
  });

  it("`/sistema` redirige a Inicio: la pantalla se fusionó, no se retiró (G4)", () => {
    renderApp(BASE, ["/sistema"]);
    expect(screen.getByRole("heading", { name: "Inicio" })).toBeInTheDocument();
  });
});
