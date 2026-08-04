import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig, CONFIG } from '../../config/configuration';
import { PrismaService } from '../../common/prisma/prisma.service';
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
 * Lo que no funcionaba (X-06):
 *  - El `path` cuelga de `/ws/`, que es lo que enruta el proxy. Con el `path`
 *    por defecto (`/socket.io/`) el saludo no pasaba por nginx y la vista en
 *    directo era inalcanzable desde fuera del contenedor.
 *  - La emisión iba a TODOS los clientes conectados, así que la suscripción por
 *    sala era decorativa. Se corrigió para el mensaje del panel, pero el canal
 *    de diagnóstico seguía difundiendo la manguera MQTT completa a cualquiera:
 *    ahora hay que pedir esa sala expresamente.
 *  - El canal no pedía credenciales. Los guards globales son de contexto HTTP y
 *    no llegan aquí; ahora el saludo exige un token válido.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/live',
  path: '/ws/socket.io',
  // Misma política que el REST (`main.ts`): reflejar cualquier origen aquí y
  // restringirlo allí era una incoherencia difícil de justificar. Sin orígenes
  // configurados no se admite ninguno, igual que en HTTP.
  cors: {
    origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => {
      const allowed = LiveGateway.allowedOrigins;
      cb(null, allowed.length === 0 ? false : !origin || allowed.includes(origin));
    },
    credentials: true,
  },
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

  /** Orígenes admitidos; los fija el arranque con la misma lista que el REST. */
  static allowedOrigins: string[] = [];

  constructor(
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    LiveGateway.allowedOrigins = config.corsOrigins ?? [];
  }

  /**
   * EL CANAL EXIGE CREDENCIALES. Los guards globales del REST son de contexto
   * HTTP y no se aplican aquí: sin esta comprobación, cualquiera que alcanzase
   * el puerto entraba sin pedir nada. El token viaja en el saludo
   * (`auth.token`), no en la URL, para que no acabe en los registros del proxy.
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = LiveGateway.tokenOf(client);
    if (!token) return this.reject(client, 'sin credenciales');
    let claims: { sub?: string; username?: string };
    try {
      claims = this.jwt.verify<{ sub?: string; username?: string }>(token);
    } catch {
      return this.reject(client, 'credenciales no válidas');
    }

    // La cuenta se comprueba contra la BASE, igual que en REST (F5·B4). Un
    // WebSocket dura horas: sin esto, desactivar o borrar a alguien lo echaba
    // del API pero le dejaba el canal en directo abierto hasta que caducara su
    // token. Cerrar la puerta y dejar la ventana abierta no es cerrar nada.
    const user = claims.sub
      ? await this.prisma.user
          .findUnique({ where: { id: claims.sub }, select: { id: true, active: true } })
          .catch(() => null)
      : null;
    if (!user || !user.active) return this.reject(client, 'cuenta no activa');

    client.data.user = claims;
    this.logger.debug(`Cliente conectado al canal en directo: ${client.id}`);
  }

  private reject(client: Socket, reason: string): void {
    this.logger.warn(`Conexión al canal en directo rechazada (${reason}): ${client.id}`);
    client.emit('unauthorized', { reason });
    client.disconnect(true);
  }

  private static tokenOf(client: Socket): string | null {
    const fromAuth = (client.handshake?.auth as { token?: unknown } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const header = client.handshake?.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return null;
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

  static readonly DIAGNOSTICS_ROOM = 'diagnostics';

  /** Canal de diagnóstico: hay que pedirlo, no se recibe por estar conectado. */
  @SubscribeMessage('subscribe_diagnostics')
  onSubscribeDiagnostics(client: Socket): { subscribed: string } {
    void client.join(LiveGateway.DIAGNOSTICS_ROOM);
    return { subscribed: LiveGateway.DIAGNOSTICS_ROOM };
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

    // El diagnóstico va a una sala a la que hay que pedir entrar EXPRESAMENTE.
    // Antes esto era un `server.emit` a todo el namespace: la manguera MQTT
    // completa —estados de partidas ajenas, telemetría, impactos, presencia—
    // llegaba a cualquier cliente, incluso a uno que no se hubiera suscrito a
    // nada. La corrección por salas sólo cubría el evento `live`, así que el
    // fallo seguía vivo con otro nombre de evento.
    this.server?.to(LiveGateway.DIAGNOSTICS_ROOM).emit(event.type, {
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
    // Desalojo por USO, no por inserción: `Map.set` sobre una clave existente no
    // la reordena, así que la partida EN CURSO —insertada la primera y
    // actualizada mil veces— era la primera en caer, mientras sobrevivían
    // partidas terminadas. Al operador le dejaba la pantalla en blanco justo en
    // la partida que estaba mirando.
    this.lastState.delete(gameId);
    if (this.lastState.size >= LiveGateway.MAX_GAMES) {
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
