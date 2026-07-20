import type { ConnectionStatus, GameSocket, GameSocketMessage } from "./gameSocket";
import { mockGameEngine } from "./mockGameEngine";

/** Adaptador mock del socket de directo: se suscribe al motor de partida en memoria. */
export class MockGameSocket implements GameSocket {
  status: ConnectionStatus = "disconnected";
  private messageCbs = new Set<(msg: GameSocketMessage) => void>();
  private statusCbs = new Set<(status: ConnectionStatus) => void>();
  private unsubscribe: (() => void) | null = null;

  connect(gameId: string): void {
    this.disconnect();
    this.setStatus("connecting");
    setTimeout(() => {
      this.setStatus("connected");
      this.unsubscribe = mockGameEngine.subscribe(gameId, (payload) => {
        for (const cb of this.messageCbs) cb(payload);
      });
    }, 200);
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
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
