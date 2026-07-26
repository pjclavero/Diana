import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { TopologyPage } from "./TopologyPage";
import * as api from "../../api/topologyApi";
import type { MatrixLayout, PanelMatrix } from "../../api/topologyApi";

function matrix(over: Partial<PanelMatrix> = {}): PanelMatrix {
  return {
    system: { id: "s1", slug: "panel-a", name: "Panel A" },
    slots: [{ module_id: "m-a", slug: "mod-a", name: "A", online: true, x: 0, y: 0, rotation: 0 }],
    unassigned: [{ id: "m-b", slug: "mod-b", friendlyName: "B", online: false }],
    ...over,
  };
}

function layout(over: Partial<MatrixLayout> = {}): MatrixLayout {
  return {
    id: "l1",
    name: "Fila baja",
    description: null,
    ownerId: "g1",
    originSystemId: "s1",
    favorite: true,
    cells: [{ slug: "mod-a", x: -1, y: 1, rotation: 0 }],
    moduleCount: 1,
    ...over,
  };
}

function stubPanels() {
  vi.spyOn(api, "listTopologyPanels").mockResolvedValue({
    items: [
      { id: "s1", slug: "panel-a", name: "Panel A", modulesExpected: 9, moduleCount: 2, placedCount: 1 },
      { id: "s2", slug: "panel-b", name: "Panel B", modulesExpected: 9, moduleCount: 0, placedCount: 0 },
    ],
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TopologyPage />
    </MemoryRouter>,
  );
}

describe("TopologyPage (X-21 · datos reales + G-H)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("carga la matriz real del primer panel y muestra sus módulos", async () => {
    stubPanels();
    const get = vi.spyOn(api, "getPanelMatrix").mockResolvedValue(matrix());
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [], ownCount: 0, maxOwn: 20 });

    renderPage();

    await waitFor(() => expect(get).toHaveBeenCalledWith("s1"));
    expect(await screen.findByText("Matriz 3×3 · Panel A")).toBeInTheDocument();
    // El módulo colocado se identifica por su slug, no por su UUID.
    expect(screen.getByText("mod-a")).toBeInTheDocument();
    // El que no está colocado aparece en la bolsa.
    expect(screen.getByText("mod-b")).toBeInTheDocument();
  });

  it("el selector cambia de panel y recarga la matriz de ese panel", async () => {
    stubPanels();
    const get = vi.spyOn(api, "getPanelMatrix").mockResolvedValue(matrix());
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [], ownCount: 0, maxOwn: 20 });

    renderPage();
    await screen.findByText("Matriz 3×3 · Panel A");

    await userEvent.selectOptions(screen.getByLabelText(/Panel a editar/), "s2");
    await waitFor(() => expect(get).toHaveBeenCalledWith("s2"));
  });

  it("guardar envía sólo las casillas ocupadas, con coordenadas y rotación", async () => {
    stubPanels();
    vi.spyOn(api, "getPanelMatrix").mockResolvedValue(matrix());
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [], ownCount: 0, maxOwn: 20 });
    const save = vi.spyOn(api, "savePanelMatrix").mockResolvedValue(matrix());

    renderPage();
    await screen.findByText("Matriz 3×3 · Panel A");
    await userEvent.click(screen.getByRole("button", { name: /Rotar mod-a/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar disposición" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("s1", [{ module_id: "m-a", x: 0, y: 0, rotation: 90 }]),
    );
    expect(await screen.findByText("Disposición guardada.")).toBeInTheDocument();
  });

  it("guarda la colocación actual como matriz favorita", async () => {
    stubPanels();
    vi.spyOn(api, "getPanelMatrix").mockResolvedValue(matrix());
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [], ownCount: 0, maxOwn: 20 });
    const save = vi.spyOn(api, "saveLayoutFromEditor").mockResolvedValue(layout());

    renderPage();
    await screen.findByText("Matriz 3×3 · Panel A");
    await userEvent.type(screen.getByLabelText(/Nombre de la matriz/), "Fila baja");
    await userEvent.click(screen.getByRole("button", { name: "Guardar matriz actual" }));

    // Se guarda LA COLOCACIÓN EN PANTALLA, no lo que hay en la base de datos.
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("Fila baja", "s1", [
        { slug: "mod-a", x: 0, y: 0, rotation: 0 },
      ]),
    );
  });

  it("aplicar una favorita avisa de los módulos que no están en el panel", async () => {
    stubPanels();
    vi.spyOn(api, "getPanelMatrix").mockResolvedValue(matrix());
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [layout()], ownCount: 1, maxOwn: 20 });
    vi.spyOn(api, "applyLayout").mockResolvedValue({
      applied: [{ slug: "mod-a" }],
      missing: ["mod-z"],
      displaced: ["mod-c"],
    });

    renderPage();
    await screen.findByText("Fila baja");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar a este panel" }));

    expect(await screen.findByText(/No están en este panel: mod-z/)).toBeInTheDocument();
    // Y también dice a quién ha desplazado: nada se mueve en silencio.
    expect(screen.getByText(/Han quedado sin colocar .*mod-c/)).toBeInTheDocument();
  });

  it("bloquear una celda no es un cambio del panel: no avisa de cambios sin guardar", async () => {
    stubPanels();
    vi.spyOn(api, "getPanelMatrix").mockResolvedValue(matrix());
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [], ownCount: 0, maxOwn: 20 });

    renderPage();
    await screen.findByText("Matriz 3×3 · Panel A");
    await userEvent.click(screen.getByRole("button", { name: "Bloquear" }));

    expect(screen.queryByText(/Hay cambios sin guardar en el panel/)).not.toBeInTheDocument();
  });

  it("guarda como matriz los cambios AÚN NO guardados en el panel, y lo avisa", async () => {
    stubPanels();
    vi.spyOn(api, "getPanelMatrix").mockResolvedValue(matrix());
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [], ownCount: 0, maxOwn: 20 });
    const save = vi.spyOn(api, "saveLayoutFromEditor").mockResolvedValue(layout());

    renderPage();
    await screen.findByText("Matriz 3×3 · Panel A");
    await userEvent.click(screen.getByRole("button", { name: /Rotar mod-a/ }));
    expect(screen.getByText(/Hay cambios sin guardar en el panel/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Nombre de la matriz/), "Fila baja");
    await userEvent.click(screen.getByRole("button", { name: "Guardar matriz actual" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("Fila baja", "s1", [
        { slug: "mod-a", x: 0, y: 0, rotation: 90 },
      ]),
    );
    expect(await screen.findByText(/el panel sigue sin guardar/)).toBeInTheDocument();
  });

  it("si no hay ningún panel lo dice, sin inventar una matriz", async () => {
    vi.spyOn(api, "listTopologyPanels").mockResolvedValue({ items: [] });
    vi.spyOn(api, "listLayouts").mockResolvedValue({ items: [], ownCount: 0, maxOwn: 20 });
    const get = vi.spyOn(api, "getPanelMatrix");

    renderPage();
    expect(await screen.findByText(/No hay ningún panel dado de alta/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
