import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { EventPublisherPort, LiveEvent } from '../hits/ports';

/** Mensaje del canal en directo, tal y como lo consume el panel. */
export interface LiveMessage {
  /** Último estado conocido de la partida; `null` = todavía no ha llegado ninguno. */
  state: unknown | null;
  /** Evento que provoca este mensaje; ausente en el primer envío tras suscribirse. */
  event?: unknown;
}

/** Nombre del evento socket.io que transporta `LiveMessage`. */
export const LIVE_MESSAGE = 'live';

/**
 * Estado en directo por WebSocket (dosier 22.4).
 *
 * Reemite lo que entra por MQTT sin reinterpretarlo: el panel recibe el
 * `elapsed_us` del coordinador, no un tiempo calculado por el servidor ni por
 * el navegador (dosier 14.2).
 *
 * Dos cosas que antes no funcionaban (X-06):
 *  - El `path` cuelga de `/ws/`, que es lo que enruta el proxy. Con el `path`
 *    por defecto (`/socket.io/`) el handshake no pasaba por nginx y la vista en
 *    directo era inalcanzable desde fuera del contenedor.
 *  - La emisión iba a TODOS los clientes (`server.emit`), así que la
 *    suscripción por sala era decorativa: cualquier panel abierto recibía los
 *    eventos de cualquier partida. Ahora se emite a la sala de su partida.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/live',
  path: '/ws/socket.io',
  cors: { origin: true },
})
export class LiveGateway implements EventPublisherPort, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly buffer: LiveEvent[] = [];
  private static readonly BUFFER_SIZE = 200;

  /**
   * Último `game/state` conocido por partida. El contrato del panel pide el
   * estado en CADA mensaje, pero el estado y los eventos llegan por tópicos
   * distintos: sin recordarlo, cada evento llegaría sin estado y la pantalla no
   * podría pintarse. `game/state` es retenido, así que al reconectar el backend
   * se repuebla solo.
   */
  private readonly lastState = new Map<string, unknown>();
  private static readonly MAX_GAMES = 200;

  @WebSocketServer()
  server?: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`Cliente conectado al canal en directo: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Cliente desconectado: ${client.id}`);
  }

  /** El cliente se suscribe a un sistema concreto. */
  @SubscribeMessage('subscribe')
  onSubscribe(client: Socket, payload: { system_id?: string }): { subscribed: string } {
    const room = payload?.system_id ? `system:${payload.system_id}` : 'system:all';
    void client.join(room);
    return { subscribed: room };
  }

  /**
   * Suscripción a una PARTIDA. Devuelve de inmediato el último estado conocido:
   * si no, el panel se quedaría en blanco hasta el siguiente evento, que puede
   * tardar toda una ronda en llegar.
   */
  @SubscribeMessage('subscribe_game')
  onSubscribeGame(client: Socket, payload: { game_id?: string }): LiveMessage & { room: string } {
    const gameId = payload?.game_id;
    if (!gameId) return { room: '', state: null };
    const room = LiveGateway.roomOf(gameId);
    void client.join(room);
    return { room, state: this.lastState.get(gameId) ?? null };
  }

  @SubscribeMessage('unsubscribe_game')
  onUnsubscribeGame(client: Socket, payload: { game_id?: string }): { room: string } {
    const gameId = payload?.game_id;
    if (!gameId) return { room: '' };
    const room = LiveGateway.roomOf(gameId);
    void client.leave(room);
    return { room };
  }

  static roomOf(gameId: string): string {
    return `game:${gameId}`;
  }

  publish(event: LiveEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > LiveGateway.BUFFER_SIZE) this.buffer.shift();

    const gameId = LiveGateway.gameIdOf(event.payload);
    if (event.type === 'game-state' && gameId) {
      this.remember(gameId, event.payload);
      this.emitToGame(gameId, { state: event.payload });
    } else if (event.type === 'game-event' && gameId) {
      // El evento viaja con el último estado conocido: el panel necesita ambos.
      this.emitToGame(gameId, { state: this.lastState.get(gameId) ?? null, event: event.payload });
    }

    // Canal de diagnóstico: el resto de tópicos (telemetría, impactos crudos,
    // presencia…) se sigue reemitiendo por su nombre para quien lo observe.
    this.server?.emit(event.type, {
      topic: event.topic,
      payload: event.payload,
      received_at: event.at.toISOString(),
    });
  }

  private emitToGame(gameId: string, message: LiveMessage): void {
    this.server?.to(LiveGateway.roomOf(gameId)).emit(LIVE_MESSAGE, message);
  }

  private remember(gameId: string, state: unknown): void {
    // Cota dura: sin ella, un despliegue largo acumularía una entrada por cada
    // partida vista desde el arranque y la memoria crecería sin techo.
    if (!this.lastState.has(gameId) && this.lastState.size >= LiveGateway.MAX_GAMES) {
      const oldest = this.lastState.keys().next();
      if (!oldest.done) this.lastState.delete(oldest.value);
    }
    this.lastState.set(gameId, state);
  }

  private static gameIdOf(payload: unknown): string | null {
    const id = (payload as { game_id?: unknown } | null)?.game_id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  /** Últimos eventos, para diagnóstico y para las pruebas. */
  recent(limit = 50): LiveEvent[] {
    return this.buffer.slice(-limit);
  }
}
