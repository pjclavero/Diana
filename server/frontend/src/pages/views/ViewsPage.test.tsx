import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewsPage } from "./ViewsPage";
import * as api from "../../api/viewsApi";
import type { View } from "../../api/viewsApi";

function view(over: Partial<View> = {}): View {
  return { id: "v1", name: "Sala", description: null, ownerId: "g1", panels: [], ...over };
}

describe("ViewsPage (G-H · vistas)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lista vistas, permite añadir un panel y comprobar si vale para duelo", async () => {
    vi.spyOn(api, "listViews").mockResolvedValue([
      view({ panels: [{ targetSystemId: "s1", slug: "s1", name: "Panel A", position: 0, moduleCount: 9 }] }),
    ]);
    vi.spyOn(api, "listPanels").mockResolvedValue([
      { id: "s1", slug: "s1", name: "Panel A" },
      { id: "s2", slug: "s2", name: "Panel B" },
    ]);
    const addPanel = vi.spyOn(api, "addViewPanel").mockResolvedValue(view());
    vi.spyOn(api, "dueloReadiness").mockResolvedValue({ ready: false, reason: "todos los jugadores deben tener el mismo número de dianas", panels: [] });

    render(<ViewsPage />);

    expect(await screen.findByText("Panel A")).toBeInTheDocument();
    // Panel A ya está en la vista → sólo Panel B disponible para añadir.
    await userEvent.selectOptions(screen.getByLabelText(/Añadir panel/), "s2");
    await userEvent.click(screen.getByRole("button", { name: "Añadir" }));
    await waitFor(() => expect(addPanel).toHaveBeenCalledWith("v1", "s2"));

    await userEvent.click(screen.getByRole("button", { name: "¿Vale para duelo?" }));
    expect(await screen.findByText("No vale para duelo")).toBeInTheDocument();
  });

  it("crea una vista", async () => {
    vi.spyOn(api, "listViews").mockResolvedValue([]);
    vi.spyOn(api, "listPanels").mockResolvedValue([]);
    const create = vi.spyOn(api, "createView").mockResolvedValue(view());

    render(<ViewsPage />);
    await userEvent.type(await screen.findByLabelText("Nombre"), "Sala grande");
    await userEvent.click(screen.getByRole("button", { name: "Crear vista" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Sala grande"));
  });
});
