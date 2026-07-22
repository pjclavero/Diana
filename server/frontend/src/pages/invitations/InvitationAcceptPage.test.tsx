import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InvitationAcceptPage } from "./InvitationAcceptPage";
import * as api from "../../api/invitationsApi";

function renderAt(code: string) {
  return render(
    <MemoryRouter initialEntries={[`/invitacion/${code}`]}>
      <Routes>
        <Route path="/invitacion/:code" element={<InvitationAcceptPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InvitationAcceptPage (G-D/F5 · aceptación pública)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("acepta la invitación y confirma el registro", async () => {
    vi.spyOn(api, "invitationByCode").mockResolvedValue({ email: "paco@mail.com", displayName: "Paco", status: "pending", acceptable: true, expired: false });
    const accept = vi.spyOn(api, "acceptInvitation").mockResolvedValue({ playerId: "pl1", displayName: "Paco" });

    renderAt("ABCD2345");

    await userEvent.click(await screen.findByRole("button", { name: "Aceptar invitación" }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("ABCD2345", "Paco"));
    expect(await screen.findByText(/Bienvenido/)).toBeInTheDocument();
  });

  it("una invitación caducada no muestra el formulario", async () => {
    vi.spyOn(api, "invitationByCode").mockResolvedValue({ email: "x@y.com", displayName: null, status: "pending", acceptable: false, expired: true });
    renderAt("ABCD2345");
    expect(await screen.findByText(/ha caducado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar invitación" })).not.toBeInTheDocument();
  });
});
