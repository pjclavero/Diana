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
    panels: ["s1"],
    paused: true,
    pausedByResilience: true,
    pauseCommandDelivered: true,
    brokerConnected: true,
    canResume: false,
    coordinatorDown: false,
    missingModules: [
      {
        slug: "mod-b",
        lastSeenAt: "2026-07-26T10:00:00Z",
        offlineSince: "2026-07-26T10:00:00Z",
        silentForMs: 45_000,
      },
    ],
    staleModules: [],
    sweep: { enabled: true, listening: true, blackout: false },
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

  it("sin nada que decidir no ocupa sitio en pantalla", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        missingModules: [],
        operatorMustDecide: false,
        pausedByResilience: false,
        paused: false,
        countdown: null,
      }),
    );
    const { container } = render(<ResiliencePanel gameId="g1" />);
    await waitFor(() => expect(api.getResilienceStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("dice qué módulo falta, desde cuándo y cuánto queda de la ventana", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(status());
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/mod-b \(callado desde hace 45 s\)/)).toBeInTheDocument();
    expect(screen.getByText(/quedan 40 s/)).toBeInTheDocument();
  });

  it("avisa del módulo callado ANTES de que el barrido lo dé por caído (D9)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        paused: false,
        pausedByResilience: false,
        missingModules: [],
        operatorMustDecide: false,
        canResumeWithout: false,
        countdown: null,
        staleModules: [
          { slug: "mod-c", silentForMs: 120_000, reason: "lleva 120 s sin dar señal de vida" },
        ],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText("Módulo sin señal")).toBeInTheDocument();
    expect(screen.getByText(/callado desde hace 2 min/)).toBeInTheDocument();
    // Todavía no hay caída declarada: no se ofrecen decisiones que no tocan.
    expect(screen.queryByRole("button", { name: /Abortar/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Abortar/, hidden: true })).not.toBeVisible();
  });

  it("sin escucha del broker NO promete una pausa que no va a ocurrir (N-D1)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        sweep: { enabled: true, listening: false, blackout: false },
        staleModules: [{ slug: "mod-c", silentForMs: 120_000, reason: "callado" }],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/puede ser suyo y no de los módulos/)).toBeInTheDocument();
    expect(screen.queryByText(/se pausará sola en unos segundos/)).toBeNull();
  });

  it("con apagón dice que no se declara ninguna caída de momento (N-D1)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        sweep: { enabled: true, listening: true, blackout: true },
        staleModules: [
          { slug: "mod-c", silentForMs: 120_000, reason: "callado" },
          { slug: "mod-d", silentForMs: 120_000, reason: "callado" },
        ],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(
      await screen.findByText(/Han callado a la vez TODOS los módulos en línea del sistema/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Revise el broker y la alimentación/)).toBeInTheDocument();
    expect(screen.queryByText(/se pausará sola en unos segundos/)).toBeNull();
  });

  it("con la detección desactivada dice que nadie va a pausar la ronda (B2)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        sweep: { enabled: false, listening: true, blackout: false },
        staleModules: [{ slug: "mod-c", silentForMs: 120_000, reason: "callado" }],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/DESACTIVADA por configuración/)).toBeInTheDocument();
    expect(screen.queryByText(/se pausará sola en unos segundos/)).toBeNull();
  });

  it("con el apagón dice que la tolerancia caduca y la ronda acabará pausándose", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        sweep: { enabled: true, listening: true, blackout: true },
        staleModules: [
          { slug: "mod-c", silentForMs: 120_000, reason: "callado" },
          { slug: "mod-d", silentForMs: 120_000, reason: "callado" },
        ],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    // Sin esta frase, el operador creería que el silencio se tolera para siempre.
    expect(
      await screen.findByText(/Si el silencio persiste unos minutos, se declararán igualmente/),
    ).toBeInTheDocument();
  });

  it("con varios módulos callados se da la antigüedad de CADA uno", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        staleModules: [
          { slug: "mod-c", silentForMs: 120_000, reason: "callado" },
          { slug: "mod-d", silentForMs: 300_000, reason: "callado" },
        ],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/callado desde hace 2 min/)).toBeInTheDocument();
    expect(screen.getByText(/callado desde hace 5 min/)).toBeInTheDocument();
  });

  it("un silencio de horas se dice en horas, no en minutos inflados", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        staleModules: [{ slug: "mod-c", silentForMs: 2 * 60 * 60_000, reason: "callado" }],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/callado desde hace 2 h/)).toBeInTheDocument();
  });

  it("un módulo caído no oculta a otro que lleva minutos callado (N6)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        staleModules: [
          { slug: "mod-c", silentForMs: 180_000, reason: "lleva 180 s sin dar señal de vida" },
        ],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    // El caído se enumera…
    expect(await screen.findByText(/mod-b \(callado desde hace 45 s\)/)).toBeInTheDocument();
    // …y el callado NO desaparece por haber ya una caída declarada.
    expect(screen.getByText("mod-c")).toBeInTheDocument();
    expect(screen.getByText(/callado desde hace 3 min/)).toBeInTheDocument();
  });

  it("un módulo caído sin señal de vida previa no inventa una antigüedad", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        missingModules: [
          { slug: "mod-d", lastSeenAt: null, offlineSince: null, silentForMs: null },
        ],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(
      await screen.findByText(/mod-d \(sin señal de vida registrada\)/),
    ).toBeInTheDocument();
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
        missingModules: [{ slug: "mod-a", lastSeenAt: null, offlineSince: null, silentForMs: null }],
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
    await screen.findByText(/mod-b/);
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
    await screen.findByText(/mod-b/);
    await userEvent.click(screen.getByRole("button", { name: "Abortar la ronda" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("g1", "abort"));
  });

  it("si la decisión falla lo dice y no se queda bloqueado", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(status());
    vi.spyOn(api, "decideResilience").mockRejectedValue(
      new Error("No se puede reanudar sin el coordinador"),
    );

    render(<ResiliencePanel gameId="g1" />);
    await screen.findByText(/mod-b/);
    await userEvent.click(screen.getByRole("button", { name: "Reanudar sin él" }));

    expect(await screen.findByText("No se puede reanudar sin el coordinador")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abortar la ronda" })).toBeEnabled();
  });

  it("si el módulo vuelve, la ronda NO queda sin salida: se puede reanudar (D1)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        missingModules: [],
        countdown: null,
        canResume: true,
        canResumeWithout: false,
        operatorMustDecide: true,
      }),
    );
    const decide = vi
      .spyOn(api, "decideResilience")
      .mockResolvedValue({ action: "resume", missing: [] });

    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/Todos los módulos han vuelto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("g1", "resume"));
  });

  it("avisa cuando la orden de pausa NO llegó al coordinador (D3)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({ pauseCommandDelivered: false, brokerConnected: false }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/no llegó al coordinador/)).toBeInTheDocument();
    expect(screen.getByText(/sin conexión con el broker MQTT/)).toBeInTheDocument();
  });

  it("no afirma una pausa que no existe (D7)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({ paused: false, pausedByResilience: false }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText(/La ronda NO está en pausa/)).toBeInTheDocument();
  });

  it("no habla de pausa sobre una ronda que no está en curso (N3)", async () => {
    vi.spyOn(api, "getResilienceStatus").mockResolvedValue(
      status({
        game: { id: "g1", status: "armed", panel: "Panel A" },
        paused: false,
        pausedByResilience: false,
        coordinatorDown: true,
        canResumeWithout: false,
        missingModules: [{ slug: "mod-a", lastSeenAt: null, offlineSince: null, silentForMs: null }],
      }),
    );
    render(<ResiliencePanel gameId="g1" />);
    expect(await screen.findByText("Ha caído el coordinador")).toBeInTheDocument();
    expect(screen.getByText(/no hay nada que pausar/)).toBeInTheDocument();
    // Y no se ofrece abortar algo que no está en marcha.
    expect(screen.getByRole("button", { name: "Abortar la ronda" })).toBeDisabled();
  });
});
