import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ParticipantsPage } from "./ParticipantsPage";
import * as participantsApi from "../../api/participantsApi";
import * as playersApi from "../../api/playersApi";
import type { GameLite, Participant } from "../../api/participantsApi";

const GAMES: GameLite[] = [{ id: "g1", name: "Partida test", status: "draft", gameMode: { key: "random", name: "Dianas aleatorias" } }];

function participant(over: Partial<Participant> = {}): Participant {
  return { id: "pt1", slot: 1, guestName: null, temporary: false, player: null, team: null, ...over };
}

describe("ParticipantsPage (G-D.2 temporales)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("añade un jugador temporal y lo marca como temporal en la lista", async () => {
    vi.spyOn(participantsApi, "listGames").mockResolvedValue(GAMES);
    const listSpy = vi
      .spyOn(participantsApi, "listParticipants")
      .mockResolvedValueOnce([])
      .mockResolvedValue([participant({ id: "t1", temporary: true, guestName: "Paco", slot: 1 })]);
    const addTemp = vi.spyOn(participantsApi, "addTemporaryParticipant").mockResolvedValue(participant({ temporary: true, guestName: "Paco" }));

    render(<ParticipantsPage />);

    await screen.findByRole("button", { name: "Añadir temporal" });
    await userEvent.type(screen.getByLabelText("Nombre"), "Paco");
    await userEvent.click(screen.getByRole("button", { name: "Añadir temporal" }));

    await waitFor(() => expect(addTemp).toHaveBeenCalledWith("g1", "Paco"));
    expect(await screen.findByText("temporal")).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalledWith("g1");
  });

  it("busca y añade un jugador registrado como participante", async () => {
    vi.spyOn(participantsApi, "listGames").mockResolvedValue(GAMES);
    vi.spyOn(participantsApi, "listParticipants").mockResolvedValue([]);
    vi.spyOn(playersApi, "searchPlayers").mockResolvedValue([
      { id: "p1", displayName: "Ana", licence: null, active: true, teamId: null, team: null, userId: "u1", user: { id: "u1", username: "ana" }, registered: true },
    ]);
    const addReg = vi.spyOn(participantsApi, "addRegisteredParticipant").mockResolvedValue(participant());

    render(<ParticipantsPage />);

    await userEvent.type(await screen.findByPlaceholderText("nombre o usuario"), "ana");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Añadir" }));

    await waitFor(() => expect(addReg).toHaveBeenCalledWith("g1", "p1"));
  });

  it("si no hay partidas, lo indica", async () => {
    vi.spyOn(participantsApi, "listGames").mockResolvedValue([]);
    render(<ParticipantsPage />);
    expect(await screen.findByText(/No hay partidas/)).toBeInTheDocument();
  });
});
