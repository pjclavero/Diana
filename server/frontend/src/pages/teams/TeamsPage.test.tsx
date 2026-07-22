import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamsPage } from "./TeamsPage";
import * as playersApi from "../../api/playersApi";

describe("TeamsPage (G-D)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lista equipos y crea uno nuevo", async () => {
    vi.spyOn(playersApi, "listTeams").mockResolvedValue([{ id: "t1", name: "Rojos", description: "los rojos" }]);
    const create = vi.spyOn(playersApi, "createTeam").mockResolvedValue({ id: "t2", name: "Azules", description: null });

    render(<TeamsPage />);

    expect(await screen.findByText("Rojos")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Nombre/), "Azules");
    await userEvent.click(screen.getByRole("button", { name: "Añadir" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Azules", description: undefined }));
  });
});
