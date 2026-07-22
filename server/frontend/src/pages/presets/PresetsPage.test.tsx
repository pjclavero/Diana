import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresetsPage } from "./PresetsPage";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";
import * as presetsApi from "../../api/presetsApi";
import type { Preset, PresetList } from "../../api/presetsApi";

const GESTOR: AuthUser = { id: "g1", username: "paco", role: "gestor", permissions: ["presets:read", "presets:write"], must_change_password: false };

const modes = [
  { key: "random", name: "Dianas aleatorias", description: "" },
  { key: "sequence", name: "Secuencia fija", description: "" },
];

function preset(over: Partial<Preset> = {}): Preset {
  return {
    id: "p1", name: "Mi rápido", description: null, isSample: false, ownerId: "g1", config: {},
    gameMode: { key: "random", name: "Dianas aleatorias" }, owner: null, ...over,
  };
}

function list(items: Preset[], ownCount: number): PresetList {
  return { items, ownCount, maxOwn: 5 };
}

function renderPage(user: AuthUser = GESTOR) {
  return render(
    <AuthProvider initialUser={user}>
      <PresetsPage />
    </AuthProvider>,
  );
}

describe("PresetsPage (G-F)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("el gestor ve el uso del límite y puede borrar los suyos, no las de muestra", async () => {
    vi.spyOn(presetsApi, "listGameModes").mockResolvedValue(modes);
    vi.spyOn(presetsApi, "listPresets").mockResolvedValue(
      list([preset({ id: "p1", name: "Mi rápido" }), preset({ id: "s1", name: "Muestra", isSample: true, ownerId: null })], 1),
    );
    const del = vi.spyOn(presetsApi, "deletePreset").mockResolvedValue();

    renderPage();

    expect(await screen.findByText(/Presets propios:/)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
    // Sólo un botón "Borrar" (el propio; la muestra no es borrable por el gestor).
    const borrar = screen.getAllByRole("button", { name: "Borrar" });
    expect(borrar).toHaveLength(1);
    await userEvent.click(borrar[0]);
    await waitFor(() => expect(del).toHaveBeenCalledWith("p1"));
  });

  it("crea un preset con modo y config numérica", async () => {
    vi.spyOn(presetsApi, "listGameModes").mockResolvedValue(modes);
    vi.spyOn(presetsApi, "listPresets").mockResolvedValue(list([], 0));
    const create = vi.spyOn(presetsApi, "createPreset").mockResolvedValue(preset());

    renderPage();

    await screen.findByRole("button", { name: "Guardar preset" });
    await userEvent.type(screen.getByLabelText(/Nombre/), "Rápido");
    await userEvent.selectOptions(screen.getByLabelText(/Modo de juego/), "random");
    await userEvent.type(screen.getByLabelText(/Repeticiones/), "9");
    await userEvent.click(screen.getByRole("button", { name: "Guardar preset" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({ name: "Rápido", mode: "random", config: { repetitions: 9 } }));
  });

  it("con el límite alcanzado, el botón de crear queda deshabilitado", async () => {
    vi.spyOn(presetsApi, "listGameModes").mockResolvedValue(modes);
    vi.spyOn(presetsApi, "listPresets").mockResolvedValue(list([], 5));

    renderPage();

    expect(await screen.findByRole("button", { name: "Límite alcanzado" })).toBeDisabled();
  });
});
