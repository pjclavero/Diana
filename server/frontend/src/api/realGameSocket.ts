import { io, type Socket } from "socket.io-client";
import type { ConnectionStatus, GameSocket, GameSocketMessage } from "./gameSocket";
import { normalizeEvent, normalizeState } from "./liveContract";
import { getToken } from "../auth/tokenStore";

const DEGRADED_AFTER_RETRIES = 2;

/** Nombre del evento que transporta el mensaje del directo (backend `LIVE_MESSAGE`). */
const LIVE_MESSAGE = "live";

/**
 * Cliente del canal en directo.
 *
 * Habla **socket.io**, que es lo que sirve el backend (`LiveGateway`, namespace
 * `/live`). Antes usaba `WebSocket` crudo contra `/games/:id/live`: son
 * protocolos distintos —socket.io tiene su propio saludo y su propio
 * entramado sobre Engine.IO—, así que la conexión no podía establecerse nunca.
 * Ésa era la mitad de X-06 que no se veía: no era un problema de enrutado del
 * proxy, era que ninguno de los dos extremos hablaba el idioma del otro.
 *
 * El `path` cuelga de `/ws/` porque es la ruta que el proxy enruta hacia el
 * backend con la cabecera `Upgrade`.
 */
export class RealGameSocket implements GameSocket {
  status: ConnectionStatus = "disconnected";
  private socket: Socket | null = null;
  private gameId: string | null = null;
  private retries = 0;
  private messageCbs = new Set<(msg: GameSocketMessage) => void>();
  private statusCbs = new Set<(status: ConnectionStatus) => void>();

  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  connect(gameId: string): void {
    this.disconnect();
    this.gameId = gameId;
    this.retries = 0;
    this.setStatus("connecting");

    // `baseUrl` es la raíz del proxy (por defecto "/ws"): el namespace del
    // backend es `/live` y el `path` de socket.io cuelga de esa raíz.
    const { origin, path } = splitBase(this.baseUrl);
    this.socket = io(`${origin}/live`, {
      path: `${path}/socket.io`,
      // El canal exige credenciales: van en el saludo, no en la URL, para que
      // no acaben en los registros del proxy.
      auth: { token: getToken() ?? "" },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 15_000,
    });

    this.socket.on("connect", () => {
      this.retries = 0;
      this.setStatus("connected");
      // Suscribirse devuelve el último estado conocido: sin esto la pantalla se
      // quedaría en blanco hasta el siguiente evento, que puede tardar toda una
      // ronda en llegar.
      this.socket?.emit(
        "subscribe_game",
        { game_id: gameId },
        (ack?: { state?: unknown } | null) => {
          const state = normalizeState(ack?.state);
          if (state) this.deliver({ state });
        },
      );
    });

    this.socket.on(LIVE_MESSAGE, (msg: { state?: unknown; event?: unknown } | null) => {
      // El mensaje se TRADUCE aquí: el contrato MQTT y el panel usan palabras
      // distintas para lo mismo (`aborted`/`cancelled`, `penalty_applied`…), y
      // `active_targets` no es obligatorio en el esquema aunque la pantalla lo
      // recorra. Ver `liveContract.ts`.
      const state = normalizeState(msg?.state);
      // Sin estado no hay nada que pintar: se descarta en vez de entregar una
      // pantalla a medias. El backend sí lo envía; es el panel quien no puede
      // hacer nada con un evento suelto.
      if (!state) return;
      const event = normalizeEvent(msg?.event);
      this.deliver(event ? { state, event } : { state });
    });

    this.socket.on("disconnect", () => {
      if (this.gameId) this.setStatus("disconnected");
    });

    this.socket.io.on("reconnect_attempt", () => {
      this.retries += 1;
      this.setStatus(this.retries >= DEGRADED_AFTER_RETRIES ? "degraded" : "connecting");
    });

    // El servidor cierra la sesión si el token no vale: decirlo en vez de
    // dejar al operador viendo un «reconectando» eterno.
    this.socket.on("unauthorized", () => {
      this.setStatus("disconnected");
    });

    this.socket.on("connect_error", () => {
      this.setStatus(this.retries >= DEGRADED_AFTER_RETRIES ? "degraded" : "connecting");
    });
  }

  disconnect(): void {
    if (this.socket) {
      if (this.gameId) this.socket.emit("unsubscribe_game", { game_id: this.gameId });
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.gameId = null;
    this.setStatus("disconnected");
  }

  onMessage(cb: (msg: GameSocketMessage) => void): () => void {
    this.messageCbs.add(cb);
    return () => this.messageCbs.delete(cb);
  }

  onStatusChange(cb: (status: ConnectionStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  private deliver(msg: GameSocketMessage): void {
    for (const cb of this.messageCbs) cb(msg);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusCbs) cb(status);
  }
}

/**
 * Parte la base en origen y ruta. Acepta tanto "/ws" (relativo, el caso normal
 * detrás del proxy) como "http://host:8080/ws" (útil en desarrollo).
 */
export function splitBase(baseUrl: string): { origin: string; path: string } {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const match = /^(https?|wss?):\/\/[^/]+/i.exec(trimmed);
  if (!match) return { origin: "", path: trimmed || "/ws" };
  return { origin: match[0], path: trimmed.slice(match[0].length) || "/ws" };
}
