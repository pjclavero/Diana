import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ManagerActivationPage } from "./ManagerActivationPage";
import * as api from "../../api/managerActivationApi";
import * as auth from "../../auth/AuthContext";

function renderAs(role: string) {
  vi.spyOn(auth, "useAuth").mockReturnValue({
    hasRole: (r: string) => r === role,
  } as never);
  return render(
    <MemoryRouter>
      <ManagerActivationPage />
    </MemoryRouter>,
  );
}

const sinPendiente = { pending: false, expiresAt: null, note: "No tiene ningún ascenso pendiente." };
const pendiente = { pending: true, expiresAt: "2026-07-27T10:00:00Z" };

const activacion = (over: Partial<api.ManagerActivation> = {}): api.ManagerActivation => ({
  id: "a1",
  code: "ABCD2345",
  status: "pending",
  expired: false,
  dispatchNote: "SMTP sin configurar: NO se ha enviado nada.",
  expiresAt: "2026-07-27T10:00:00Z",
  activatedAt: null,
  createdAt: "2026-07-26T10:00:00Z",
  createdBy: "admin",
  user: { id: "u1", username: "ana", email: "ana@example.com", role: { name: "jugador" } },
  module: { id: "m1", slug: "mod-a", friendlyName: "Módulo A" },
  ...over,
});

describe("ManagerActivationPage (F5) · el comprador", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sin ascenso pendiente lo dice y no pide ningún código", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(sinPendiente);
    renderAs("jugador");
    expect(await screen.findByText(/No tiene ningún ascenso pendiente/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Código de activación/)).toBeNull();
  });

  it("con ascenso pendiente pide el código y dice cuándo caduca", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(pendiente);
    renderAs("jugador");
    expect(await screen.findByLabelText(/Código de activación/)).toBeInTheDocument();
    expect(screen.getByText(/Caduca el/)).toBeInTheDocument();
  });

  it("activar envía el código y muestra lo que responde el servidor", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(pendiente);
    const activate = vi.spyOn(api, "activateManager").mockResolvedValue({
      activated: true,
      note: "Acceso de gestor activo. Vuelva a iniciar sesión.",
    });
    renderAs("jugador");
    await userEvent.type(await screen.findByLabelText(/Código de activación/), "abcd2345");
    await userEvent.click(screen.getByRole("button", { name: "Activar" }));
    await waitFor(() => expect(activate).toHaveBeenCalledWith("abcd2345"));
    expect(await screen.findByText(/Vuelva a iniciar sesión/)).toBeInTheDocument();
  });

  it("si el código no vale se dice el motivo del servidor, no uno inventado", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(pendiente);
    const { ApiError } = await import("../../api/client");
    vi.spyOn(api, "activateManager").mockRejectedValue(new ApiError("El código ha caducado."));
    renderAs("jugador");
    await userEvent.type(await screen.findByLabelText(/Código de activación/), "ABCD2345");
    await userEvent.click(screen.getByRole("button", { name: "Activar" }));
    expect(await screen.findByText("El código ha caducado.")).toBeInTheDocument();
  });

  it("un jugador no ve la administración de ascensos", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(sinPendiente);
    const list = vi.spyOn(api, "listManagerActivations");
    renderAs("jugador");
    await screen.findByText(/No tiene ningún ascenso pendiente/);
    expect(screen.queryByText("Ascensos emitidos")).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("ManagerActivationPage (F5) · el administrador", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("avisa de que sin SMTP no se ha enviado ningún correo", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(sinPendiente);
    vi.spyOn(api, "listManagerActivations").mockResolvedValue({
      items: [activacion()],
      smtpConfigured: false,
    });
    renderAs("administrador");
    expect(await screen.findByText(/No hay SMTP configurado/)).toBeInTheDocument();
    // Y por eso el código tiene que estar a la vista para dictarlo.
    expect(screen.getByText("ABCD2345")).toBeInTheDocument();
  });

  it("un código ya usado o caducado NO se muestra", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(sinPendiente);
    vi.spyOn(api, "listManagerActivations").mockResolvedValue({
      items: [
        activacion({ id: "a1", status: "activated", code: "USADO123" }),
        activacion({ id: "a2", expired: true, code: "VIEJO123" }),
      ],
      smtpConfigured: true,
    });
    renderAs("administrador");
    await screen.findByText("Ascensos emitidos");
    expect(screen.queryByText("USADO123")).toBeNull();
    expect(screen.queryByText("VIEJO123")).toBeNull();
    expect(screen.getByText("Activado")).toBeInTheDocument();
    expect(screen.getByText("Caducado")).toBeInTheDocument();
  });

  it("regenerar vuelve a pedir la lista", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(sinPendiente);
    const list = vi
      .spyOn(api, "listManagerActivations")
      .mockResolvedValue({ items: [activacion()], smtpConfigured: true });
    const regen = vi.spyOn(api, "regenerateActivation").mockResolvedValue(activacion());
    renderAs("administrador");
    await userEvent.click(await screen.findByRole("button", { name: "Regenerar" }));
    await waitFor(() => expect(regen).toHaveBeenCalledWith("a1"));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("una activación ya usada no se puede regenerar ni revocar", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(sinPendiente);
    vi.spyOn(api, "listManagerActivations").mockResolvedValue({
      items: [activacion({ status: "activated" })],
      smtpConfigured: true,
    });
    renderAs("administrador");
    expect(await screen.findByRole("button", { name: "Regenerar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revocar" })).toBeDisabled();
  });

  it("sin ventas todavía lo dice en vez de mostrar una tabla vacía", async () => {
    vi.spyOn(api, "myActivation").mockResolvedValue(sinPendiente);
    vi.spyOn(api, "listManagerActivations").mockResolvedValue({ items: [], smtpConfigured: true });
    renderAs("administrador");
    expect(await screen.findByText(/Todavía no se ha vendido ningún módulo/)).toBeInTheDocument();
  });
});
