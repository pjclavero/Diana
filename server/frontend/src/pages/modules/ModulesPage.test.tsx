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

/**
 * LOS CINCO ESTADOS EN PANTALLA (T3). Lo que se comprueba aquí no es que la
 * función `diagnosticarModulo` acierte —eso está en `utils/estadoModulo.test.ts`—
 * sino que la PANTALLA los distingue: que un fallo de consulta no se parece a
 * «no hay módulos», y que un módulo callado no se pinta «en línea».
 */
describe("ModulesPage · los cinco estados, distinguibles", () => {
  beforeEach(() => vi.restoreAllMocks());

  const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("con 0 módulos dice 0 y dice que lo ha comprobado (no «cargando» ni «error»)", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(overview([]));
    renderPage();

    expect(await screen.findByText(/0 módulos registrados/)).toBeInTheDocument();
    expect(screen.getByText(/comprobado ahora mismo/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si la consulta FALLA no dice «no hay módulos»: dice que no ha podido preguntar", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockRejectedValue(new Error("boom"));
    renderPage();

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/No se puede afirmar cuántos módulos hay/i);
    expect(screen.queryByText(/0 módulos registrados/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Resumen de módulos" })).not.toBeInTheDocument();
  });

  it("un módulo que consta en línea pero lleva 10 min callado sale «sin señal reciente», no «en línea»", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(
      overview([item({ id: "m1", slug: "diana-01", online: true, lastSeenAt: hace(10 * 60_000) })]),
    );
    renderPage();

    // La insignia de la fila (no el recuento del resumen, que también lo dice).
    expect(await screen.findByText("sin señal reciente", { selector: "span.badge" })).toBeInTheDocument();
    expect(screen.queryByText("en línea", { selector: "span.badge" })).not.toBeInTheDocument();
    const resumen = screen.getByRole("group", { name: "Resumen de módulos" });
    expect(resumen).toHaveTextContent(/0\s*en línea/);
    expect(resumen).toHaveTextContent(/1\s*sin señal reciente/);
  });

  it("un módulo nunca conectado sale «pendiente», no «desconectado»", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(
      overview([item({ id: "m1", slug: "diana-01", online: false, lastSeenAt: null })]),
    );
    renderPage();

    expect(await screen.findByText("pendiente", { selector: "span.badge" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Resumen de módulos" })).toHaveTextContent(
      /1\s*pendientes de primera conexión/,
    );
  });

  it("un módulo con señal fresca sí sale «en línea»", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(
      overview([item({ id: "m1", slug: "diana-01", online: true, lastSeenAt: hace(3_000) })]),
    );
    renderPage();

    expect(await screen.findByText("en línea", { selector: "span.badge" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Resumen de módulos" })).toHaveTextContent(/1\s*en línea/);
  });

  it("sin dato de configuración, la ficha dice «desconocida» y no «aplicada»", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(
      overview([item({ id: "m1", slug: "diana-01", online: true, lastSeenAt: hace(1_000) })]),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /diana-01/ }));

    // El veredicto es «desconocida». La palabra «aplicada» sólo puede
    // aparecer NEGADA («no se puede afirmar que esté aplicada»), nunca como
    // veredicto.
    expect(screen.getByText(/Configuración:/)).toHaveTextContent(/Configuración:\s*desconocida/);
    expect(screen.getByText(/Configuración:/)).not.toHaveTextContent(/Configuración:\s*aplicada/);
  });

  it("con `configStatus: pending` del backend, la ficha lo dice", async () => {
    vi.spyOn(modulesApi, "modulesOverview").mockResolvedValue(
      overview([
        item({
          id: "m1",
          slug: "diana-01",
          online: true,
          lastSeenAt: hace(1_000),
          configStatus: "pending",
          configVersionDesired: 5,
          configVersionReported: 4,
        }),
      ]),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /diana-01/ }));

    expect(screen.getByText(/Configuración:/)).toHaveTextContent(/pendiente/);
    expect(screen.getByText(/Configuración:/)).toHaveTextContent(/v5/);
  });
});
