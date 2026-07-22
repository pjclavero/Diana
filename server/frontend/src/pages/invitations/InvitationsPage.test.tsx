import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvitationsPage } from "./InvitationsPage";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";
import * as api from "../../api/invitationsApi";
import type { Invitation } from "../../api/invitationsApi";

const GESTOR: AuthUser = { id: "g1", username: "paco", role: "gestor", permissions: ["players:write", "players:read"], must_change_password: false };
const ADMIN: AuthUser = { id: "a1", username: "admin", role: "administrador", permissions: ["*"], must_change_password: false };

function inv(over: Partial<Invitation> = {}): Invitation {
  return {
    id: "i1", email: "paco@mail.com", displayName: null, code: "ABCD2345", status: "pending",
    dispatchNote: "SMTP sin configurar", expiresAt: "2026-07-23T00:00:00Z", createdAt: "2026-07-22T00:00:00Z", ...over,
  };
}

function renderAs(user: AuthUser) {
  return render(
    <AuthProvider initialUser={user}>
      <InvitationsPage />
    </AuthProvider>,
  );
}

describe("InvitationsPage (G-D/F5)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("el gestor crea una invitación y ve el código de las pendientes; sin panel SMTP", async () => {
    vi.spyOn(api, "listInvitations").mockResolvedValue([inv()]);
    const create = vi.spyOn(api, "createInvitation").mockResolvedValue(inv({ id: "i2" }));

    renderAs(GESTOR);

    // El código de la pendiente se muestra (SMTP sin configurar).
    expect(await screen.findByText("ABCD2345")).toBeInTheDocument();
    // El gestor NO ve la configuración SMTP.
    expect(screen.queryByText("Configuración de correo (SMTP)")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Correo/), "nuevo@mail.com");
    await userEvent.click(screen.getByRole("button", { name: "Invitar" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("nuevo@mail.com", undefined));
  });

  it("el admin ve el panel de configuración SMTP", async () => {
    vi.spyOn(api, "listInvitations").mockResolvedValue([]);
    vi.spyOn(api, "getSmtp").mockResolvedValue({ host: null, port: null, secure: true, username: null, fromAddress: null, hasPassword: false, configured: false });

    renderAs(ADMIN);
    expect(await screen.findByText("Configuración de correo (SMTP)")).toBeInTheDocument();
  });
});
