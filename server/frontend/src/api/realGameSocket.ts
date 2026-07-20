import type { ConnectionStatus, GameSocket, GameSocketMessage } from "./gameSocket";

const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 500;
const DEGRADED_AFTER_RETRIES = 2;

/**
 * Cliente WebSocket real contra `VITE_WS_URL` (ver README para el contrato
 * esperado del backend). Reconecta con backoff exponencial y expone un
 * estado "degraded" tras varios reintentos para que la UI lo muestre.
 */
export class RealGameSocket implements GameSocket {
  status: ConnectionStatus = "disconnected";
  private ws: WebSocket | null = null;
  private gameId: string | null = null;
  private retries = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private messageCbs = new Set<(msg: GameSocketMessage) => void>();
  private statusCbs = new Set<(status: ConnectionStatus) => void>();

  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  connect(gameId: string): void {
    this.closedByUser = false;
    this.gameId = gameId;
    this.retries = 0;
    this.open();
  }

  private open(): void {
    if (!this.gameId) return;
    this.setStatus(this.retries === 0 ? "connecting" : this.retries >= DEGRADED_AFTER_RETRIES ? "degraded" : "connecting");

    try {
      this.ws = new WebSocket(`${this.baseUrl}/games/${this.gameId}/live`);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.retries = 0;
      this.setStatus("connected");
    };

    this.ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as GameSocketMessage;
        for (const cb of this.messageCbs) cb(payload);
      } catch {
        // Mensaje no interpretable: se ignora, no se muestra traza técnica al operador.
      }
    };

    this.ws.onclose = () => {
      if (this.closedByUser) return;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    this.retries += 1;
    this.setStatus(this.retries >= DEGRADED_AFTER_RETRIES ? "degraded" : "connecting");
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** this.retries, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => this.open(), backoff);
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
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

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const cb of this.statusCbs) cb(status);
  }
}
