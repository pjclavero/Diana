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

/**
 * Estado en directo por WebSocket (dosier 22.4).
 *
 * Reemite lo que entra por MQTT sin reinterpretarlo: el panel recibe el
 * `elapsed_us` del coordinador, no un tiempo calculado por el servidor ni por
 * el navegador (dosier 14.2).
 */
@Injectable()
@WebSocketGateway({ namespace: '/live', cors: { origin: true } })
export class LiveGateway implements EventPublisherPort, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  private readonly buffer: LiveEvent[] = [];
  private static readonly BUFFER_SIZE = 200;

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

  publish(event: LiveEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > LiveGateway.BUFFER_SIZE) this.buffer.shift();
    this.server?.emit(event.type, {
      topic: event.topic,
      payload: event.payload,
      received_at: event.at.toISOString(),
    });
  }

  /** Últimos eventos, para diagnóstico y para las pruebas. */
  recent(limit = 50): LiveEvent[] {
    return this.buffer.slice(-limit);
  }
}
