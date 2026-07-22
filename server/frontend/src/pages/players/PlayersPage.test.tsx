import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayersPage } from "./PlayersPage";
import * as playersApi from "../../api/playersApi";
import type { PlayerRow, Team } from "../../api/playersApi";

const TEAMS: Team[] = [
  { id: "t1", name: "Rojos", description: null },
  { id: "t2", name: "Azules", description: null },
];

function player(over: Partial<PlayerRow> = {}): PlayerRow {
  return {
    id: "p1", displayName: "Paco", licence: null, active: true, teamId: null, team: null,
    userId: null, user: null, registered: false, ...over,
  };
}

describe("PlayersPage (G-D)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lista jugadores, distingue registrado/plantilla y permite cambiar de equipo", async () => {
    vi.spyOn(playersApi, "listTeams").mockResolvedValue(TEAMS);
    vi.spyOn(playersApi, "searchPlayers").mockResolvedValue([
      player({ id: "reg", displayName: "Ana", userId: "u1", user: { id: "u1", username: "ana" }, registered: true }),
      player({ id: "plt", displayName: "Paco" }),
    ]);
    const setTeam = vi.spyOn(playersApi, "setPlayerTeam").mockResolvedValue({ id: "plt" });

    render(<PlayersPage />);

    expect(await screen.findByText("registrado")).toBeInTheDocument();
    expect(screen.getByText("plantilla")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Equipo de Paco"), "t2");
    await waitFor(() => expect(setTeam).toHaveBeenCalledWith("plt", "t2"));
  });

  it("busca por término", async () => {
    vi.spyOn(playersApi, "listTeams").mockResolvedValue(TEAMS);
    const search = vi.spyOn(playersApi, "searchPlayers").mockResolvedValue([]);

    render(<PlayersPage />);
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));

    await userEvent.type(screen.getByPlaceholderText("buscar…"), "ana");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(search).toHaveBeenCalledWith("ana"));
  });

  it("da de alta un jugador de plantilla", async () => {
    vi.spyOn(playersApi, "listTeams").mockResolvedValue(TEAMS);
    vi.spyOn(playersApi, "searchPlayers").mockResolvedValue([]);
    const create = vi.spyOn(playersApi, "createPlayer").mockResolvedValue({ id: "new" });

    render(<PlayersPage />);
    await screen.findByRole("button", { name: "Añadir" });
    await userEvent.type(screen.getByLabelText("Nombre"), "Nuevo");
    await userEvent.click(screen.getByRole("button", { name: "Añadir" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({ displayName: "Nuevo", teamId: null }));
  });
});
