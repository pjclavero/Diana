import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { JoinPage } from "./JoinPage";
import * as participantsApi from "../../api/participantsApi";

function renderAt(code: string) {
  return render(
    <MemoryRouter initialEntries={[`/unirse/${code}`]}>
      <Routes>
        <Route path="/unirse/:code" element={<JoinPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("JoinPage (G-D · unión pública por QR)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("muestra la partida y permite unirse como temporal", async () => {
    vi.spyOn(participantsApi, "gameByJoinCode").mockResolvedValue({
      id: "g1", name: "Partida X", status: "draft", gameMode: { key: "random", name: "Dianas aleatorias" }, joinable: true,
    });
    const join = vi.spyOn(participantsApi, "joinByCode").mockResolvedValue({ gameId: "g1", participantId: "p1", name: "Paco" });

    renderAt("ABC234");

    await userEvent.type(await screen.findByLabelText(/Tu nombre/), "Paco");
    await userEvent.click(screen.getByRole("button", { name: "Unirme" }));

    await waitFor(() => expect(join).toHaveBeenCalledWith("ABC234", "Paco"));
    expect(await screen.findByText(/Te has unido como/)).toBeInTheDocument();
  });

  it("si la partida no admite incorporaciones, no muestra el formulario", async () => {
    vi.spyOn(participantsApi, "gameByJoinCode").mockResolvedValue({
      id: "g1", name: "Partida X", status: "finished", gameMode: null, joinable: false,
    });
    renderAt("ABC234");
    expect(await screen.findByText(/ya no admite/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unirme" })).not.toBeInTheDocument();
  });
});
