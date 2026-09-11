import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProvisioningPage } from "./ProvisioningPage";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";
import { apiClient } from "../../api";
import { ApiError } from "../../api/client";
import type { EstadoAprovisionamientoObservado, ResultadoOrden } from "../../api/provisioningApi";

/**
 * Pruebas de la pantalla contra un DOBLE del cliente. Nada de esto habla con un
 * backend en marcha: lo que se comprueba es qué pinta la pantalla ante cada
 * respuesta posible, incluida la que un panel optimista se tragaría.
 */

const ADMIN: AuthUser = {
  id: "a1",
  username: "admin",
  role: "administrador",
  permissions: ["*"],
  must_change_password: false,
};

/** Tiene `commands:publish` y NO por eso tiene aprovisionamiento. Es el matiz del RBAC. */
const OPERADOR: AuthUser = {
  id: "o1",
  username: "opera",
  role: "operador",
  permissions: ["commands:publish", "modules:read", "profile:read"],
  must_change_password: false,
};

const OBSERVADO: EstadoAprovisionamientoObservado = {
  device_id: "module-01",
  system_id: "sistema-01",
  request_id: "r1",
  correlated: true,
  result: "OK",
  state: "PROVISIONED",
  active_epoch: "11111111-1111-1111-1111-111111111111",
  pending_epoch: null,
  rotation_id: null,
  provision_id: null,
  last_provisioning_sequence: "7",
  last_delegation_sequence: "0",
  provisioning_key_fingerprint: "a".repeat(64),
  reason: null,
  received_at: "2026-09-10T10:00:00.000Z",
  observational_only: true,
};

const ORDEN_BASE: ResultadoOrden = {
  request_id: "r1",
  provisioning_sequence: "7",
  topic: "module/module-01/provision",
  delivered: false,
  denied: false,
  timed_out: false,
  reason_code: null,
};

function renderPage(user: AuthUser = ADMIN) {
  return render(
    <AuthProvider initialUser={user}>
      <ProvisioningPage />
    </AuthProvider>,
  );
}

async function consultar(id = "module-01") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/identificador del dispositivo a consultar/i), id);
  await user.click(screen.getByRole("button", { name: /consultar estado/i }));
  return user;
}

async function emitir() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/dispositivo destino/i), "module-01");
  await user.type(screen.getByLabelText("Sistema"), "sistema-01");
  await user.type(screen.getByLabelText(/huella de la clave/i), "a".repeat(64));
  await user.click(screen.getByRole("button", { name: /emitir orden/i }));
}

afterEach(() => vi.restoreAllMocks());

describe("ProvisioningPage · estado observado", () => {
  it("404 (nunca ha reportado) se pinta como «sin estado observado», no como error", async () => {
    vi.spyOn(apiClient, "getProvisioningState").mockResolvedValue(null);
    renderPage();
    await consultar();

    expect(await screen.findByText(/sin estado observado todavía/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * EL DEFECTO QUE YA SE COLÓ UNA VEZ en este panel (Inicio: «Sin alertas
   * activas» con el backend caído). Un fallo de red NO puede pintarse como
   * ausencia de datos.
   */
  it("un fallo de red NO se pinta como «sin estado observado»", async () => {
    vi.spyOn(apiClient, "getProvisioningState").mockRejectedValue(
      new ApiError("No se puede contactar con el servidor."),
    );
    renderPage();
    await consultar();

    expect(await screen.findByRole("alert")).toHaveTextContent(/no se puede contactar con el servidor/i);
    expect(screen.queryByText(/sin estado observado todavía/i)).not.toBeInTheDocument();
  });

  it("con datos: los pinta y deja claro que es SÓLO OBSERVACIÓN", async () => {
    vi.spyOn(apiClient, "getProvisioningState").mockResolvedValue(OBSERVADO);
    renderPage();
    await consultar();

    expect(await screen.findByText("PROVISIONED")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/es lo que el módulo/i);
    expect(screen.getByRole("note")).toHaveTextContent(/no lo que el sistema sabe/i);
  });

  it("un campo no reportado se dice «no reportado», no se pinta vacío", async () => {
    vi.spyOn(apiClient, "getProvisioningState").mockResolvedValue({ ...OBSERVADO, state: null });
    renderPage();
    await consultar();

    expect(await screen.findAllByText(/no reportado/i)).not.toHaveLength(0);
  });
});

describe("ProvisioningPage · emisión de órdenes", () => {
  it("una DENEGACIÓN del broker se pinta como denegación, con su reason_code", async () => {
    vi.spyOn(apiClient, "issueProvisioningOrder").mockResolvedValue({
      ...ORDEN_BASE,
      denied: true,
      reason_code: 135,
    });
    renderPage();
    await emitir();

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/DENEGADA/);
    expect(aviso).toHaveTextContent(/135/);
    // Y NO se ha colado ninguna palabra de éxito.
    expect(aviso).not.toHaveTextContent(/entregada al broker/i);
  });

  it("tiempo agotado: no se afirma que la orden llegara", async () => {
    vi.spyOn(apiClient, "issueProvisioningOrder").mockResolvedValue({ ...ORDEN_BASE, timed_out: true });
    renderPage();
    await emitir();

    expect(await screen.findByRole("alert")).toHaveTextContent(/SIN ACUSE/);
  });

  it("entregada: se confirma la entrega AL BROKER y se aclara que no es «aplicada»", async () => {
    vi.spyOn(apiClient, "issueProvisioningOrder").mockResolvedValue({
      ...ORDEN_BASE,
      delivered: true,
      reason_code: 0,
    });
    renderPage();
    await emitir();

    const ok = await screen.findByText(/entregada al broker/i);
    expect(ok).toBeInTheDocument();
    expect(screen.getByText(/no que el módulo la haya aplicado/i)).toBeInTheDocument();
  });

  it("si la llamada falla, la pantalla dice que falló y no muestra resultado", async () => {
    vi.spyOn(apiClient, "issueProvisioningOrder").mockRejectedValue(new ApiError("No tiene permiso para esta acción."));
    renderPage();
    await emitir();

    expect(await screen.findByRole("alert")).toHaveTextContent(/no tiene permiso/i);
    expect(screen.queryByText(/entregada al broker/i)).not.toBeInTheDocument();
  });
});

describe("ProvisioningPage · permisos", () => {
  it("un operador con commands:publish NO puede operar aquí, y se le explica por qué", () => {
    const emitirSpy = vi.spyOn(apiClient, "issueProvisioningOrder");
    renderPage(OPERADOR);

    expect(screen.getByRole("alert")).toHaveTextContent(/provisioning:issue/);
    expect(screen.getByRole("alert")).toHaveTextContent(/no se heredan de/i);
    expect(screen.queryByRole("button", { name: /emitir orden/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /consultar estado/i })).not.toBeInTheDocument();
    expect(emitirSpy).not.toHaveBeenCalled();
  });

  it("el administrador ve las dos mitades", () => {
    renderPage();
    expect(screen.getByRole("button", { name: /consultar estado/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /emitir orden/i })).toBeInTheDocument();
  });

  it("el panel NO genera credenciales: la huella la aporta el operador", () => {
    renderPage();
    expect(screen.getByText(/el panel no genera claves ni secretos/i)).toBeInTheDocument();
  });
});
