import { describe, expect, it, vi, beforeEach } from "vitest";

/** Doble de socket.io: registra listeners y deja dispararlos a mano. */
const handlers = new Map<string, (...args: unknown[]) => void>();
const managerHandlers = new Map<string, (...args: unknown[]) => void>();
const emit = vi.fn();
const disconnect = vi.fn();
const removeAllListeners = vi.fn();
const ioSpy = vi.fn();

vi.mock("socket.io-client", () => ({
  io: (url: string, opts: unknown) => {
    ioSpy(url, opts);
    return {
      on: (ev: string, cb: (...args: unknown[]) => void) => handlers.set(ev, cb),
      emit,
      disconnect,
      removeAllListeners,
      io: { on: (ev: string, cb: (...args: unknown[]) => void) => managerHandlers.set(ev, cb) },
    };
  },
}));

vi.mock("../auth/tokenStore", () => ({ getToken: () => "token-de-prueba" }));

const { RealGameSocket, splitBase } = await import("./realGameSocket");

const fire = (ev: string, ...args: unknown[]) => handlers.get(ev)?.(...args);
const state = { game_id: "g1", phase: "running", elapsed_us: 1 };

describe("splitBase", () => {
  it("una base relativa deja el origen vacío y conserva la ruta", () => {
    expect(splitBase("/ws")).toEqual({ origin: "", path: "/ws" });
  });

  it("una base absoluta separa origen y ruta", () => {
    expect(splitBase("http://192.168.1.209:8080/ws")).toEqual({
      origin: "http://192.168.1.209:8080",
      path: "/ws",
    });
  });

  it("la barra final no duplica la ruta", () => {
    expect(splitBase("/ws/")).toEqual({ origin: "", path: "/ws" });
  });
});

describe("RealGameSocket · habla socket.io, no WebSocket crudo (X-06)", () => {
  beforeEach(() => {
    handlers.clear();
    managerHandlers.clear();
    vi.clearAllMocks();
  });

  it("manda el token en el saludo: el canal exige credenciales", () => {
    new RealGameSocket("/ws").connect("g1");
    const [, opts] = ioSpy.mock.calls[0] as [string, { auth: { token: string } }];
    expect(opts.auth.token).toBe("token-de-prueba");
  });

  it("si el servidor rechaza las credenciales se dice, no se finge reconectar", () => {
    const socket = new RealGameSocket("/ws");
    socket.connect("g1");
    fire("connect");
    fire("unauthorized", { reason: "credenciales no válidas" });
    expect(socket.status).toBe("disconnected");
  });

  it("traduce el vocabulario del contrato al del panel", () => {
    const socket = new RealGameSocket("/ws");
    const received: { state: { phase: string; mode: string } }[] = [];
    socket.onMessage((m) => received.push(m as never));
    socket.connect("g1");
    // Tal y como lo publica el coordinador, según el esquema.
    fire("live", {
      state: { game_id: "g1", phase: "aborted", mode: "all_against_clock" },
      event: { kind: "penalty_applied" },
    });
    expect(received[0].state.phase).toBe("cancelled");
    expect(received[0].state.mode).toBe("all_vs_clock");
    expect((received[0] as unknown as { event: { kind: string } }).event.kind).toBe("penalty");
  });

  it("un estado sin `active_targets` no rompe: llega como lista vacía", () => {
    const socket = new RealGameSocket("/ws");
    const received: { state: { active_targets: unknown[] } }[] = [];
    socket.onMessage((m) => received.push(m as never));
    socket.connect("g1");
    // `active_targets` NO es obligatorio en el contrato y la pantalla lo recorría.
    fire("live", { state: { game_id: "g1", phase: "running" } });
    expect(received[0].state.active_targets).toEqual([]);
  });

  it("se conecta al namespace /live con el path que enruta el proxy", () => {
    new RealGameSocket("/ws").connect("g1");
    const [url, opts] = ioSpy.mock.calls[0] as [string, { path: string }];
    expect(url).toBe("/live");
    // Con el path por defecto (/socket.io) el saludo no pasa por nginx.
    expect(opts.path).toBe("/ws/socket.io");
  });

  it("al conectar se suscribe a SU partida", () => {
    new RealGameSocket("/ws").connect("g1");
    fire("connect");
    expect(emit).toHaveBeenCalledWith("subscribe_game", { game_id: "g1" }, expect.any(Function));
  });

  it("el estado que devuelve la suscripción se entrega ya, sin esperar a un evento", () => {
    const socket = new RealGameSocket("/ws");
    const received: unknown[] = [];
    socket.onMessage((m) => received.push(m));
    socket.connect("g1");
    fire("connect");
    // El servidor responde al `subscribe_game` con el último estado conocido.
    const ack = emit.mock.calls[0][2] as (a: unknown) => void;
    ack({ state });
    expect(received).toEqual([{ state: { ...state, active_targets: [] } }]);
  });

  it("un ack sin estado no entrega nada: no se pinta una pantalla a medias", () => {
    const socket = new RealGameSocket("/ws");
    const received: unknown[] = [];
    socket.onMessage((m) => received.push(m));
    socket.connect("g1");
    fire("connect");
    (emit.mock.calls[0][2] as (a: unknown) => void)({ state: null });
    expect(received).toEqual([]);
  });

  it("los mensajes en directo llegan a los suscriptores", () => {
    const socket = new RealGameSocket("/ws");
    const received: unknown[] = [];
    socket.onMessage((m) => received.push(m));
    socket.connect("g1");
    fire("live", { state, event: { kind: "target_hit" } });
    expect(received).toEqual([
      { state: { ...state, active_targets: [] }, event: { kind: "target_hit" } },
    ]);
  });

  it("un mensaje sin estado se descarta", () => {
    const socket = new RealGameSocket("/ws");
    const received: unknown[] = [];
    socket.onMessage((m) => received.push(m));
    socket.connect("g1");
    fire("live", { state: null, event: { kind: "target_hit" } });
    fire("live", null);
    expect(received).toEqual([]);
  });

  it("el estado de conexión pasa por conectando → conectado", () => {
    const socket = new RealGameSocket("/ws");
    const seen: string[] = [];
    socket.onStatusChange((s) => seen.push(s));
    socket.connect("g1");
    fire("connect");
    expect(seen).toEqual(["connecting", "connected"]);
    expect(socket.status).toBe("connected");
  });

  it("tras varios reintentos se declara degradado en vez de fingir normalidad", () => {
    const socket = new RealGameSocket("/ws");
    socket.connect("g1");
    fire("connect");
    const attempt = managerHandlers.get("reconnect_attempt")!;
    attempt();
    expect(socket.status).toBe("connecting");
    attempt();
    expect(socket.status).toBe("degraded");
  });

  it("desconectar da de baja la suscripción y cierra el socket", () => {
    const socket = new RealGameSocket("/ws");
    socket.connect("g1");
    fire("connect");
    socket.disconnect();
    expect(emit).toHaveBeenCalledWith("unsubscribe_game", { game_id: "g1" });
    expect(disconnect).toHaveBeenCalled();
    expect(socket.status).toBe("disconnected");
  });

  it("reconectar a otra partida no deja la anterior abierta", () => {
    const socket = new RealGameSocket("/ws");
    socket.connect("g1");
    fire("connect");
    socket.connect("g2");
    expect(disconnect).toHaveBeenCalledTimes(1);
    fire("connect");
    expect(emit).toHaveBeenLastCalledWith(
      "subscribe_game",
      { game_id: "g2" },
      expect.any(Function),
    );
  });
});
