import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ModulesPage } from "./ModulesPage";
import * as modulesApi from "../../api/modulesApi";
import type { ModuleOverviewItem, ModulesOverview } from "../../api/modulesApi";

function item(over: Partial<ModuleOverviewItem> = {}): ModuleOverviewItem {
  return {
    id: over.id ?? "m1", slug: over.slug ?? "diana-01", friendlyName: null, online: true, state: "ready",
    role: "principal", firmwareVersion: "1.0.0", maintenance: false, lastSeenAt: null, ownerId: null, owner: null,
    position: null, updateAvailable: false, latestSignedVersion: null, ...over,
  };
}

function overview(items: ModuleOverviewItem[]): ModulesOverview {
  return {
    summary: {
      total: items.length,
      online: items.filter((i) => i.online).length,
      offline: items.filter((i) => !i.online).length,
      updatesPending: items.filter((i) => i.updateAvailable).length,
    },
    items,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ModulesPage />
    </MemoryRouter>,
  );
}

describe("ModulesPage (G-C dashboard)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("muestra el resumen y marca las actualizaciones pendientes", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(
      overview([
        item({ id: "m1", slug: "diana-01", updateAvailable: true, latestSignedVersion: "1.2.0" }),
        item({ id: "m2", slug: "diana-02", online: false }),
      ]),
    );
    renderPage();

    expect(await screen.findByText(/con actualización pendiente/)).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "strong" })).toBeInTheDocument(); // total
    // Insignia de actualización disponible presente (sólo m1).
    expect(screen.getAllByText("Actualización disponible")).toHaveLength(1);
  });

  it("al pinchar un módulo expande sus acciones en la misma ventana", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(
      overview([item({ id: "mA", slug: "diana-09", updateAvailable: true, latestSignedVersion: "1.2.0" })]),
    );
    renderPage();

    // Antes de expandir no se ven las acciones.
    expect(await screen.findByRole("heading", { name: "diana-09" })).toBeInTheDocument();
    expect(screen.queryByText("Prueba LED")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /diana-09/ }));

    expect(screen.getByRole("link", { name: "Ver 9 dianas" })).toHaveAttribute("href", "/modulos/mA");
    expect(screen.getByRole("link", { name: "Prueba LED" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Actualizar → 1.2.0/ })).toBeInTheDocument();
  });

  it("pagina cuando hay más de 9 módulos", async () => {
    const many = Array.from({ length: 11 }, (_, i) => item({ id: `m${i}`, slug: `diana-${i}` }));
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(overview(many));
    renderPage();

    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();
    // La página 1 muestra 9; el módulo 10 (índice 9) no está aún.
    expect(screen.queryByRole("heading", { name: "diana-9" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Siguientes →" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "diana-9" })).toBeInTheDocument();
  });
});
