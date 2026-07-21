import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModuleOwnershipPage } from "./ModuleOwnershipPage";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthUser } from "../../auth/authApi";
import * as modulesApi from "../../api/modulesApi";

const ADMIN: AuthUser = { id: "a1", username: "admin", role: "administrador", permissions: ["*"], must_change_password: false };
const GESTOR: AuthUser = { id: "g1", username: "paco", role: "gestor", permissions: ["modules:link", "profile:read"], must_change_password: false };

function renderPage(user: AuthUser) {
  return render(
    <AuthProvider initialUser={user}>
      <ModuleOwnershipPage />
    </AuthProvider>,
  );
}

describe("ModuleOwnershipPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("el admin ve todos los módulos, su dueño y el selector para vincular los libres", async () => {
    vi.spyOn(modulesApi, "listModules").mockResolvedValue([
      { id: "m1", slug: "module-01", friendlyName: "Diana 1", serial: null, firmwareVersion: "1.0.0", state: "ready", online: true, ownerId: null, owner: null },
      { id: "m2", slug: "module-02", friendlyName: null, serial: null, firmwareVersion: "1.0.0", state: "ready", online: false, ownerId: "g1", owner: { id: "g1", username: "paco", displayName: null, role: { name: "gestor" } } },
    ]);
    vi.spyOn(modulesApi, "listUsers").mockResolvedValue([{ id: "g1", username: "paco", displayName: null }]);

    renderPage(ADMIN);

    expect(await screen.findByText("Diana 1")).toBeInTheDocument();
    // m1 sin dueño → selector de vinculación
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vincular" })).toBeInTheDocument();
    // m2 con dueño → botón desvincular
    expect(screen.getByRole("button", { name: "Desvincular" })).toBeInTheDocument();
  });

  it("el gestor sólo pide SUS módulos y no ve el selector de vincular", async () => {
    const mine = vi.spyOn(modulesApi, "listMyModules").mockResolvedValue([
      { id: "m2", slug: "module-02", friendlyName: null, serial: null, firmwareVersion: "1.0.0", state: "ready", online: true, ownerId: "g1", owner: { id: "g1", username: "paco", displayName: null, role: { name: "gestor" } } },
    ]);
    const all = vi.spyOn(modulesApi, "listModules");

    renderPage(GESTOR);

    expect(await screen.findByRole("heading", { name: "module-02" })).toBeInTheDocument();
    expect(mine).toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desvincular" })).toBeInTheDocument();
  });
});
