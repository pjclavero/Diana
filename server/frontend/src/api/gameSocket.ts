import type { GameEvent, GameState } from "../types/domain";

export type ConnectionStatus = "connecting" | "connected" | "degraded" | "disconnected";

export interface GameSocketMessage {
  state: GameState;
  event?: GameEvent;
}

/**
 * Contrato del cliente de directo. Aislado igual que DianaApiClient: las
 * pantallas sólo conocen esta interfaz, nunca WebSocket ni el motor mock.
 */
export interface GameSocket {
  connect(gameId: string): void;
  disconnect(): void;
  onMessage(cb: (msg: GameSocketMessage) => void): () => void;
  onStatusChange(cb: (status: ConnectionStatus) => void): () => void;
  readonly status: ConnectionStatus;
}
