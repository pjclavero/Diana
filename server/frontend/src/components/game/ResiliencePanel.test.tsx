import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResiliencePanel } from "./ResiliencePanel";
import * as api from "../../api/resilienceApi";
import type { ResilienceStatus } from "../../api/resilienceApi";

function status(over: Partial<ResilienceStatus> = {}): ResilienceStatus {
  return {
    game: { id: "g1", status: "paused", panel: "Panel A" },
    round: { id: "r1", index: 1, phase: "running" },
    coordinatorDown: false,
    missingModules: [{ slug: "mod-b", lastSeenAt: "2026-07-26T10:00:00Z" }],
    involvedModules: 3,
    countdown: { elapsedMs: 20_000, remainingMs: 40_000, expired: false },
    operatorMustDecide: true,
    canResumeWithout: true,
    note: null,
    ...over,
  };
}

describe("ResiliencePanel (G-I)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("sin caídas no ocupa sitio en pantalla", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({ missingModules: [], operatorMustDecide: false, countdown: null }),
    );
    const { container } = render(<ResiliencePanel gameId="g1" />);
    await waitFor(() => expect(api.getResilienceStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("dice qué módulo falta y cuánto queda de la ventana de reconexión", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(status());
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText("mod-b")).toBeInTheDocument();
    expect(screen.getByText(/quedan 40 s/)).toBeInTheDocument();
  });

  it("agotado el plazo, pide decidir", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({ countdown: { elapsedMs: 90_000, remainingMs: 0, expired: true } }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/Se agotó la ventana de reconexión/)).toBeInTheDocument();
  });

  it("con el coordinador caído NO deja reanudar sin él", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        coordinatorDown: true,
        canResumeWithout: false,
        missingModules: [{ slug: "mod-a", lastSeenAt: null }],
        note: "Pausa dura: sin coordinador no hay tiempos fiables. No se puede reanudar sin él.",
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/Sin coordinador no hay tiempos fiables/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reanudar sin él" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abortar la ronda" })).toBeEnabled();
  });

  it("reanudar sin el módulo llama a la decisión y avisa de que cambian las condiciones", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(status());
    const decide = vi
      .spyOn(api, "decideResilience")
      .mockResolvedValue({ action: "resume_without", missing: ["mod-b"] });

    render(<ResiliencePanel gameId="g1" />);
    await screen.findByText("mod-b");
    expect(screen.getByText(/cambia las condiciones de la prueba/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reanudar sin él" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("g1", "resume_without"));
  });

  it("abortar la ronda llama a la decisión correspondiente", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(status());
    const decide = vi
      .spyOn(api, "decideResilience")
      .mockResolvedValue({ action: "abort", missing: ["mod-b"] });

    render(<ResiliencePanel gameId="g1" />);
    await screen.findByText("mod-b");
    await userEvent.click(screen.getByRole("button", { name: "Abortar la ronda" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("g1", "abort"));
  });

  it("si la decisión falla lo dice y no se queda bloqueado", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(status());
    vi.spyOn(api, "decideResilience").mockRejectedValue(
      new Error("No se puede reanudar sin el coordinador"),
    );

    render(<ResiliencePanel gameId="g1" />);
    await screen.findByText("mod-b");
    await userEvent.click(screen.getByRole("button", { name: "Reanudar sin él" }));

    expect(await screen.findByText("No se puede reanudar sin el coordinador")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abortar la ronda" })).toBeEnabled();
  });
});
