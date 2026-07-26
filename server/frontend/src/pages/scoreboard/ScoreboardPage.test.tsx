import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { ScoreboardPage } from "./ScoreboardPage";
import * as api from "../../api/scoreboardApi";
import type { Scoreboard } from "../../api/scoreboardApi";

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
        position: 2,
      },
    ],
    board: [
      {
        moduleSlug: "mod-a",
        x: 0,
        y: 0,
        targets: [
          { targetIndex: 1, state: "hit", hits: 1, lastClassification: null },
          { targetIndex: 2, state: "invalid", hits: 1, lastClassification: "hit_on_safe" },
          { targetIndex: 3, state: "pending", hits: 0, lastClassification: null },
        ],
      },
    ],
    totals: { detected: 2, valid: 1, invalid: 1, unattributed: 0 },
    ...over,
  };
}

function renderAt(gameId = "11111111-1111-4111-8111-111111111111") {
  return render(
    <MemoryRouter initialEntries={[`/marcador/${gameId}`]}>
      <Routes>
        <Route path="/marcador/:gameId" element={<ScoreboardPage />} />
      </Routes>
    </MemoryRouter>,
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
        totals: { detected: 2, valid: 2, invalid: 0, unattributed: 2 },
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

  it("si el marcador falla lo dice, sin pintar un marcador vacío", async () => {
    vi.spyOn(api, "getScoreboard").mockRejectedValue(new Error("Partida no encontrada"));

    renderAt();

    expect(await screen.findByText("Partida no encontrada")).toBeInTheDocument();
    expect(screen.queryByText("Clasificación")).not.toBeInTheDocument();
  });
});
