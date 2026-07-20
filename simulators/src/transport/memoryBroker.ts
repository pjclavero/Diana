import { topicMatches } from './topicMatch.js';
import type { IncomingMessage, MessageHandler, PublishOptions, WillMessage } from './types.js';

interface Subscription {
  clientId: string;
  filter: string;
  handler: MessageHandler;
}

/**
 * Broker MQTT mínimo en memoria: retención, comodines (+, #) y Last Will.
 * No implementa QoS de verdad (no hay reintentos de red): basta para que
 * el simulador y sus tests corran sin Mosquitto (encargo: "haz que el
 * simulador pueda correr contra un transporte en memoria/mock").
 */
export class MemoryBroker {
  private readonly retained = new Map<string, IncomingMessage>();
  private readonly subscriptions: Subscription[] = [];
  private readonly wills = new Map<string, WillMessage>();
  private readonly log: IncomingMessage[] = [];

  registerWill(clientId: string, will: WillMessage | undefined): void {
    if (will) {
      this.wills.set(clientId, will);
    } else {
      this.wills.delete(clientId);
    }
  }

  clearWill(clientId: string): void {
    this.wills.delete(clientId);
  }

  /**
   * Publicación ordenada (no dispara el LWT: lo hace triggerWill).
   * Espera a que todos los manejadores coincidentes terminen antes de
   * resolver, incluidos los que a su vez publican (p.ej. el coordinador
   * consolidando un hit): así el remitente puede confiar en que, al
   * resolver publish(), el efecto en el otro extremo ya ha ocurrido.
   */
  async publish(clientId: string, topic: string, payload: unknown, options: PublishOptions): Promise<void> {
    const msg: IncomingMessage = { topic, payload, qos: options.qos, retain: options.retain };
    this.log.push(msg);
    if (options.retain) {
      this.retained.set(topic, msg);
    }
    const matching = this.subscriptions.filter((sub) => topicMatches(sub.filter, topic));
    for (const sub of matching) {
      await sub.handler(msg);
    }
  }

  /** Simula un corte de red: publica el Last Will registrado, si lo hay. */
  async triggerWill(clientId: string): Promise<void> {
    const will = this.wills.get(clientId);
    this.wills.delete(clientId);
    if (will) {
      await this.publish(clientId, will.topic, will.payload, { qos: will.qos, retain: will.retain });
    }
  }

  subscribe(clientId: string, filter: string, handler: MessageHandler): void {
    this.subscriptions.push({ clientId, filter, handler });
    for (const [topic, msg] of this.retained) {
      if (topicMatches(filter, topic)) {
        handler(msg);
      }
    }
  }

  unsubscribe(clientId: string, filter: string): void {
    for (let i = this.subscriptions.length - 1; i >= 0; i--) {
      const s = this.subscriptions[i] as Subscription;
      if (s.clientId === clientId && s.filter === filter) {
        this.subscriptions.splice(i, 1);
      }
    }
  }

  /** Todo lo publicado en la vida del broker, en orden. Útil para aserciones de test. */
  history(): readonly IncomingMessage[] {
    return this.log;
  }

  retainedSnapshot(): ReadonlyMap<string, IncomingMessage> {
    return this.retained;
  }
}
