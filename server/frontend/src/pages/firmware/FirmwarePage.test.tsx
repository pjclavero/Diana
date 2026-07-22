import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("el admin ve el formulario de subir el binario y pide todos los módulos", async () => {
    const all = vi.spyOn(modulesApi, "listModules").mockResolvedValue([MODULE]);
    vi.spyOn(firmwareApi, "availableForModule").mockResolvedValue(AVAILABLE);
    vi.spyOn(firmwareApi, "listDeployments").mockResolvedValue([]);

    renderPage(ADMIN);

    expect(await screen.findByRole("button", { name: "Subir binario" })).toBeInTheDocument();
    // El campo de archivo .bin está presente.
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(all).toHaveBeenCalled();
  });

  it("el admin sube un binario y se llama a uploadFirmwareBinary con los campos", async () => {
    vi.spyOn(modulesApi, "listModules").mockResolvedValue([MODULE]);
    vi.spyOn(firmwareApi, "availableForModule").mockResolvedValue(AVAILABLE);
    vi.spyOn(firmwareApi, "listDeployments").mockResolvedValue([]);
    const upload = vi.spyOn(firmwareApi, "uploadFirmwareBinary").mockResolvedValue({
      id: "fwX", version: "1.3.0", targetBoard: "esp32-s3", url: "http://x/api/firmware/fwX/binary",
      sha256: "d".repeat(64), sizeBytes: 2048, signed: true, notes: null, releasedAt: "2026-07-22T00:00:00Z",
    });

    renderPage(ADMIN);

    const fileInput = (await screen.findByLabelText(/Archivo del firmware/)) as HTMLInputElement;
    const bin = new File([new Uint8Array([1, 2, 3])], "fw.bin", { type: "application/octet-stream" });
    await userEvent.upload(fileInput, bin);
    await userEvent.type(screen.getByPlaceholderText("1.2.0"), "1.3.0");
    await userEvent.type(screen.getByPlaceholderText("esp32-s3"), "esp32-s3");
    // Se dispara el submit del formulario directamente (evitar la validación
    // nativa de required+file de jsdom, que bloquea el click en el botón).
    fireEvent.submit(fileInput.closest("form")!);

    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][1]).toEqual(expect.objectContaining({ version: "1.3.0", targetBoard: "esp32-s3" }));
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
