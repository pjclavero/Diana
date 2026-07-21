import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirmwarePage } from "./FirmwarePage";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";
import * as modulesApi from "../../api/modulesApi";
import * as firmwareApi from "../../api/firmwareApi";

const ADMIN: AuthUser = { id: "a1", username: "admin", role: "administrador", permissions: ["*"], must_change_password: false };
const GESTOR: AuthUser = { id: "g1", username: "paco", role: "gestor", permissions: ["firmware:read", "firmware:deploy", "profile:read"], must_change_password: false };

const MODULE: modulesApi.ModuleEntity = {
  id: "m1", slug: "diana-01", friendlyName: "Diana 1", serial: null, firmwareVersion: "1.0.0", state: "ready", online: true, ownerId: "g1", owner: null,
};

const AVAILABLE: firmwareApi.AvailableFirmware = {
  module: { id: "m1", slug: "diana-01", friendlyName: "Diana 1" },
  current_version: "1.0.0",
  deployment_in_progress: null,
  available: [
    { id: "fw2", version: "1.2.0", targetBoard: "esp32-s3", sha256: "a".repeat(64), sizeBytes: 1024, signed: true, releasedAt: "2026-07-21T00:00:00Z", notes: null, is_current: false },
    { id: "fw1", version: "1.0.0", targetBoard: "esp32-s3", sha256: "b".repeat(64), sizeBytes: 1024, signed: true, releasedAt: "2026-07-01T00:00:00Z", notes: null, is_current: true },
  ],
};

function renderPage(user: AuthUser) {
  return render(
    <AuthProvider initialUser={user}>
      <FirmwarePage />
    </AuthProvider>,
  );
}

describe("FirmwarePage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("el gestor pide SUS módulos y puede aceptar una versión más reciente firmada", async () => {
    const mine = vi.spyOn(modulesApi, "listMyModules").mockResolvedValue([MODULE]);
    const all = vi.spyOn(modulesApi, "listModules");
    vi.spyOn(firmwareApi, "availableForModule").mockResolvedValue(AVAILABLE);
    vi.spyOn(firmwareApi, "listDeployments").mockResolvedValue([]);
    const deploy = vi.spyOn(firmwareApi, "deployFirmware").mockResolvedValue({
      id: "dep1", status: "sent", previousVersion: "1.0.0", requestedBy: "paco", error: null, startedAt: "2026-07-21T00:00:00Z", finishedAt: null,
      firmwareVersion: { version: "1.2.0", targetBoard: "esp32-s3", sha256: "a".repeat(64) },
    });

    renderPage(GESTOR);

    expect(await screen.findByRole("heading", { name: "Diana 1" })).toBeInTheDocument();
    expect(mine).toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();

    // Sólo la versión NO vigente aparece como opción (1.2.0, no 1.0.0).
    const select = await screen.findByLabelText("Versión para diana-01");
    await userEvent.selectOptions(select, "fw2");
    await userEvent.click(screen.getByRole("button", { name: "Aceptar y actualizar" }));

    await waitFor(() => expect(deploy).toHaveBeenCalledWith("m1", "fw2"));
  });

  it("el admin ve el formulario de subir versión y pide todos los módulos", async () => {
    const all = vi.spyOn(modulesApi, "listModules").mockResolvedValue([MODULE]);
    vi.spyOn(firmwareApi, "availableForModule").mockResolvedValue(AVAILABLE);
    vi.spyOn(firmwareApi, "listDeployments").mockResolvedValue([]);

    renderPage(ADMIN);

    expect(await screen.findByRole("button", { name: "Registrar versión" })).toBeInTheDocument();
    expect(all).toHaveBeenCalled();
  });

  it("con un despliegue en curso no ofrece lanzar otro", async () => {
    vi.spyOn(modulesApi, "listMyModules").mockResolvedValue([MODULE]);
    vi.spyOn(firmwareApi, "availableForModule").mockResolvedValue({
      ...AVAILABLE,
      deployment_in_progress: { id: "depX", status: "installing", firmwareVersionId: "fw2" },
    });
    vi.spyOn(firmwareApi, "listDeployments").mockResolvedValue([]);

    renderPage(GESTOR);

    expect(await screen.findByText(/Despliegue en curso/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar y actualizar" })).not.toBeInTheDocument();
  });
});
