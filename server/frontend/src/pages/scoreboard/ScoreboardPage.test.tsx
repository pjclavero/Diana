import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { ScoreboardPage } from "./ScoreboardPage";
import * as api from "../../api/scoreboardApi";
import type { Scoreboard } from "../../api/scoreboardApi";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";

function board(over: Partial<Scoreboard> = {}): Scoreboard {
  return {
    game: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Torneo",
      status: "finished",
      mode: { key: "sequence", name: "Secuencia" },
      panel: { id: "s1", slug: "panel-a", name: "Panel A" },
    },
    round: { id: "r1", index: 1, phase: "finished", mode: "sequence" },
    panels: ["s1"],
    multiPanel: false,
    warnings: [],
    ranking: [
      {
        participantId: "p1",
        name: "Ana",
        temporary: false,
        teamName: "Rojo",
        validHits: 5,
        invalidHits: 1,
        totalTimeUs: 7_250_000,
        penaltiesMs: 0,
        accuracyValid: 0.83,
        provisional: false,
        attributed: true,
        inferred: false,
        position: 1,
      },
      {
        participantId: "p2",
        name: "Invitado",
        temporary: true,
        teamName: null,
        validHits: 2,
        invalidHits: 0,
        totalTimeUs: null,
        penaltiesMs: 0,
        accuracyValid: null,
        provisional: true,
        attributed: true,
        inferred: false,
        position: 2,
      },
    ],
    board: [
      {
        moduleSlug: "mod-a",
        targetSystemId: "s1",
        panelName: "Panel A",
        x: 0,
        y: 0,
        targets: [
          { targetIndex: 1, state: "hit", hits: 1, lastClassification: null },
          { targetIndex: 2, state: "invalid", hits: 1, lastClassification: "hit_on_safe" },
          { targetIndex: 3, state: "pending", hits: 0, lastClassification: null },
        ],
      },
    ],
    totals: { detected: 2, valid: 1, invalid: 1, unattributed: 0, inferred: 0 },
    ...over,
  };
}

/** Jugador raso: no tiene `stats:reset`, así que no ve el reinicio. */
const JUGADOR: AuthUser = {
  id: "u-jug",
  username: "jugador",
  role: "jugador",
  permissions: ["profile:read"],
  must_change_password: false,
};

const GESTOR: AuthUser = {
  id: "u-ges",
  username: "gestor",
  role: "gestor",
  permissions: ["statistics:read", "stats:reset"],
  must_change_password: false,
};

function renderAt(gameId = "11111111-1111-4111-8111-111111111111", user: AuthUser = JUGADOR) {
  return render(
    <AuthProvider initialUser={user}>
      <MemoryRouter initialEntries={[`/marcador/${gameId}`]}>
        <Routes>
          <Route path="/marcador/:gameId" element={<ScoreboardPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("ScoreboardPage (G-G · marcador tipo dardos)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it("muestra clasificación, tiempos y estado de cada diana", async () => {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(board());

    renderAt();

    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("7.25 s")).toBeInTheDocument();
    expect(screen.getByText("83.0 %")).toBeInTheDocument();
    // Estado de las 3 dianas del módulo.
    expect(screen.getByText("acertada")).toBeInTheDocument();
    expect(screen.getByText("impacto no válido")).toBeInTheDocument();
    expect(screen.getByText("pendiente")).toBeInTheDocument();
  });

  it("no presenta como cero lo que no es calculable, y avisa de lo provisional", async () => {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(board());

    renderAt();

    expect(await screen.findByText("no calculable")).toBeInTheDocument();
    expect(screen.getByText("provisional")).toBeInTheDocument();
    // El temporal se identifica como tal.
    expect(screen.getByText("temporal")).toBeInTheDocument();
  });

  it("la ficha del jugador dice que un temporal no acumula histórico", async () => {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(board());
    vi.spyOn(api, "getParticipantHistory").mockResolvedValue({
      participantId: "p2",
      name: "Invitado",
      temporary: true,
      history: null,
      note: "Jugador temporal: no acumula estadística histórica.",
    });

    renderAt();
    await screen.findByText("Invitado");
    await userEvent.click(screen.getAllByRole("button", { name: "Ver jugador" })[1]);

    expect(await screen.findByText(/no acumula estadística histórica/)).toBeInTheDocument();
  });

  it("la ficha de un jugador registrado muestra su histórico real", async () => {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(board());
    vi.spyOn(api, "getParticipantHistory").mockResolvedValue({
      participantId: "p1",
      name: "Ana",
      temporary: false,
      note: null,
      history: {
        playerId: "pl1",
        rounds: 3,
        totalValidHits: 12,
        averageAccuracyValid: 0.75,
        roundsWithoutAccuracy: 1,
        bestTimeUs: 5_000_000,
        recent: [
          {
            roundId: "r1",
            validHits: 5,
            invalidHits: 1,
            totalTimeUs: 7_250_000,
            accuracyValid: null,
            computedAt: "2026-07-26T10:00:00Z",
          },
        ],
      },
    });

    renderAt();
    await screen.findByText("Ana");
    await userEvent.click(screen.getAllByRole("button", { name: "Ver jugador" })[0]);

    expect(await screen.findByText("Rondas registradas: 3")).toBeInTheDocument();
    expect(screen.getByText("Mejor tiempo: 5.00 s")).toBeInTheDocument();
    expect(screen.getByText(/Rondas sin precisión calculable: 1/)).toBeInTheDocument();
  });

  it("con la partida en curso se refresca solo; terminada, no", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const get = vi
      .spyOn(api, "getScoreboard")
      .mockResolvedValue(board({ game: { ...board().game, status: "running" } }));

    renderAt();
    await screen.findByText("Ana");
    expect(get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));

    // La partida pasa a finished: el refresco automático debe pararse.
    get.mockResolvedValue(board());
    await vi.advanceTimersByTimeAsync(3100);
    await waitFor(() =>
      expect(screen.getByText(/no está en curso: el marcador no se actualiza solo/)).toBeInTheDocument(),
    );
    const afterFinish = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9100);
    expect(get.mock.calls.length).toBe(afterFinish);
  });

  it("con impactos sin atribuir no muestra ceros: lo declara en la fila y en un aviso", async () => {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(
      board({
        warnings: ["2 impacto(s) de esta ronda no están atribuidos a ningún jugador."],
        totals: { detected: 2, valid: 2, invalid: 0, unattributed: 2, inferred: 0 },
        ranking: [
          {
            participantId: "p1",
            name: "Ana",
            temporary: false,
            teamName: null,
            validHits: null,
            invalidHits: null,
            totalTimeUs: null,
            penaltiesMs: null,
            accuracyValid: null,
            provisional: true,
            attributed: false,
            inferred: false,
            position: null,
          },
        ],
      }),
    );

    renderAt();

    expect(await screen.findByText(/no están atribuidos a ningún jugador/)).toBeInTheDocument();
    expect(screen.getAllByText("sin atribuir").length).toBeGreaterThan(0);
    expect(screen.getByText("sin datos")).toBeInTheDocument();
    // Y la fila no reclama posición: se muestra un guion, no un «1».
    const fila = screen.getByText("Ana").closest("tr")!;
    expect(fila.querySelectorAll("td")[0].textContent).toBe("—");
  });

  it("distingue un acierto DEDUCIDO de uno medido, sin alarma de «sin atribuir»", async () => {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(
      board({
        warnings: [
          "Los 7 impacto(s) de esta ronda no vienen atribuidos a ningún jugador; se adjudican al único participante de la partida. Es una deducción, no una medida.",
        ],
        totals: { detected: 7, valid: 7, invalid: 0, unattributed: 0, inferred: 7 },
        ranking: [
          {
            participantId: "p1",
            name: "Ana",
            temporary: false,
            teamName: null,
            validHits: 7,
            invalidHits: 0,
            totalTimeUs: 4_000_000,
            penaltiesMs: null,
            accuracyValid: null,
            provisional: true,
            attributed: true,
            inferred: true,
            position: 1,
          },
        ],
      }),
    );

    renderAt();

    expect(await screen.findByText("deducido")).toBeInTheDocument();
    expect(screen.getByText(/deducción, no una medida/)).toBeInTheDocument();
    // Nada queda sin repartir: la alarma de «sin atribuir» no debe aparecer.
    expect(screen.queryByText(/impacto\(s\) sin atribuir/)).not.toBeInTheDocument();
  });

  it("con varios paneles identifica a cuál pertenece cada módulo", async () => {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(
      board({
        panels: ["s1", "s2"],
        multiPanel: true,
        board: [
          {
            moduleSlug: "mod-a",
            targetSystemId: "s1",
            panelName: "Panel A",
            x: 0,
            y: 0,
            targets: [{ targetIndex: 1, state: "hit", hits: 1, lastClassification: null }],
          },
          {
            moduleSlug: "mod-k",
            targetSystemId: "s2",
            panelName: "Panel B",
            x: 0,
            y: 0,
            targets: [{ targetIndex: 1, state: "pending", hits: 0, lastClassification: null }],
          },
        ],
      }),
    );

    renderAt();

    // Mismas coordenadas (0,0) en dos paneles: sin el panel serían el mismo módulo.
    expect(await screen.findByText("Panel: Panel A")).toBeInTheDocument();
    expect(screen.getByText("Panel: Panel B")).toBeInTheDocument();
    expect(screen.getByText(/2 paneles \(vista\)/)).toBeInTheDocument();
  });

  it("el botón de refresco manual vuelve a pedir el marcador", async () => {
    const get = vi.spyOn(api, "getScoreboard").mockResolvedValue(board());

    renderAt();
    await screen.findByText("Ana");
    expect(get).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Actualizar ahora" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("si el marcador falla lo dice, sin pintar un marcador vacío", async () => {
    vi.spyOn(api, "getScoreboard").mockRejectedValue(new Error("Partida no encontrada"));

    renderAt();

    expect(await screen.findByText("Partida no encontrada")).toBeInTheDocument();
    expect(screen.queryByText("Clasificación")).not.toBeInTheDocument();
  });
});

describe("ScoreboardPage · reinicio de estadística por partida (F4 · §3.4)", () => {
  beforeEach(() => vi.restoreAllMocks());

  const anaHistory: api.ParticipantHistory = {
    participantId: "p1",
    name: "Ana",
    temporary: false,
    note: null,
    history: {
      playerId: "pl1",
      rounds: 3,
      totalValidHits: 12,
      averageAccuracyValid: 0.75,
      roundsWithoutAccuracy: 0,
      bestTimeUs: 5_000_000,
      recent: [],
    },
  };

  const outcome: api.StatsResetOutcome = {
    gameId: "11111111-1111-4111-8111-111111111111",
    participantId: "p1",
    participantIds: ["p1"],
    playerId: "pl1",
    playerName: "Ana",
    temporary: false,
    selfReset: false,
    deleted: { results: 2, penalties: 1, shotCounts: 1, statistics: 0 },
    hitsDetached: 3,
    aggregatesPendingRecompute: 0,
    notes: ["La estadística global del jugador se calcula a partir de los resultados de sus partidas."],
  };

  async function openFicha(user: AuthUser, history: api.ParticipantHistory = anaHistory) {
    vi.spyOn(api, "getScoreboard").mockResolvedValue(board());
    vi.spyOn(api, "getParticipantHistory").mockResolvedValue(history);
    renderAt(undefined, user);
    await screen.findByText("Ana");
    await userEvent.click(screen.getAllByRole("button", { name: "Ver jugador" })[0]);
    await screen.findByText("Ficha del jugador");
  }

  it("un jugador sin permiso NO ve el botón de reinicio", async () => {
    await openFicha(JUGADOR);
    expect(screen.queryByRole("button", { name: /Reiniciar estadística/ })).not.toBeInTheDocument();
  });

  it("el gestor ve el botón, y no borra nada hasta confirmar", async () => {
    const reset = vi.spyOn(api, "resetParticipantStats").mockResolvedValue(outcome);
    await openFicha(GESTOR);

    await userEvent.click(await screen.findByRole("button", { name: /Reiniciar estadística de Ana/ }));

    // La confirmación tiene que decir la verdad sobre el alcance.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/resultados, penalizaciones y munición de esta partida/);
    expect(dialog).toHaveTextContent(/dejarán de estar atribuidos/);
    expect(dialog).toHaveTextContent(/ninguna otra partida/);
    expect(reset).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(reset).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("al confirmar reinicia, recarga y cuenta lo que se ha borrado de verdad", async () => {
    const reset = vi.spyOn(api, "resetParticipantStats").mockResolvedValue(outcome);
    await openFicha(GESTOR);
    const board1 = vi.mocked(api.getScoreboard).mock.calls.length;

    await userEvent.click(await screen.findByRole("button", { name: /Reiniciar estadística de Ana/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sí, reiniciar" }));

    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "p1"),
    );
    expect(await screen.findByText(/Borrados: 2 resultado\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Impactos conservados pero sin atribuir: 3/)).toBeInTheDocument();
    // El marcador se recarga: lo que se ve ya no es lo de antes del borrado.
    await waitFor(() => expect(vi.mocked(api.getScoreboard).mock.calls.length).toBeGreaterThan(board1));
  });

  it("con un temporal, la confirmación no promete descontar un acumulado que no existe", async () => {
    vi.spyOn(api, "resetParticipantStats").mockResolvedValue(outcome);
    await openFicha(GESTOR, {
      participantId: "p1",
      name: "Invitado",
      temporary: true,
      history: null,
      note: "Jugador temporal: no acumula estadística histórica.",
    });

    await userEvent.click(await screen.findByRole("button", { name: /Reiniciar estadística de Invitado/ }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      /no tiene estadística acumulada/,
    );
  });

  it("si el backend rechaza el reinicio, se enseña su motivo tal cual", async () => {
    vi.spyOn(api, "resetParticipantStats").mockRejectedValue(
      new Error('La partida está en curso (estado «running»): termínela o abórtela antes de reiniciar.'),
    );
    await openFicha(GESTOR);

    await userEvent.click(await screen.findByRole("button", { name: /Reiniciar estadística de Ana/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sí, reiniciar" }));

    expect(await screen.findByText(/La partida está en curso/)).toBeInTheDocument();
    expect(screen.queryByText(/Borrados:/)).not.toBeInTheDocument();
  });
});
