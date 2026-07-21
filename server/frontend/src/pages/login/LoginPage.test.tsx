import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./LoginPage";
import { AuthProvider } from "../../auth/AuthContext";
import * as authApi from "../../auth/authApi";
import { ApiError } from "../../api/client";

const ADMIN = { id: "a1", username: "admin", role: "administrador", permissions: ["*"], must_change_password: false };

function renderLogin() {
  return render(
    <AuthProvider initialUser={null}>
      <LoginPage />
    </AuthProvider>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("envía usuario y contraseña al backend al enviar el formulario", async () => {
    const loginSpy = vi
      .spyOn(authApi, "login")
      .mockResolvedValue({ access_token: "tok", token_type: "Bearer", expires_in: "1h", user: { id: "a1", username: "admin", role: "administrador", must_change_password: false } });
    vi.spyOn(authApi, "fetchMe").mockResolvedValue(ADMIN);

    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/usuario/i), "admin");
    await user.type(screen.getByLabelText(/contraseña/i), "una-clave-larga");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    expect(loginSpy).toHaveBeenCalledWith("admin", "una-clave-larga");
  });

  it("muestra un mensaje de error si las credenciales son incorrectas", async () => {
    vi.spyOn(authApi, "login").mockRejectedValue(new ApiError("Usuario o contraseña incorrectos."));

    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/usuario/i), "admin");
    await user.type(screen.getByLabelText(/contraseña/i), "mal");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrectos/i);
  });
});
