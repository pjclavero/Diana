import type { MemoryBroker } from './memoryBroker.js';
import type { MessageHandler, PublishOptions, Transport, WillMessage } from './types.js';

/**
 * Transporte para el broker en memoria. Cuando kill() se invoca, deja de
 * aceptar publish() (simula pérdida de red) y dispara el Last Will en el
 * broker, exactamente como haría Mosquitto al expirar el keepalive.
 */
export class MemoryTransport implements Transport {
  readonly clientId: string;
  private readonly broker: MemoryBroker;
  private connected = false;
  private readonly filters = new Set<string>();

  constructor(clientId: string, broker: MemoryBroker) {
    this.clientId = clientId;
    this.broker = broker;
  }

  async connect(will?: WillMessage): Promise<void> {
    this.broker.registerWill(this.clientId, will);
    this.connected = true;
  }

  async disconnectGracefully(): Promise<void> {
    this.broker.clearWill(this.clientId);
    this.connected = false;
    for (const f of this.filters) {
      this.broker.unsubscribe(this.clientId, f);
    }
    this.filters.clear();
  }

  async kill(): Promise<void> {
    this.connected = false;
    await this.broker.triggerWill(this.clientId);
    // Las suscripciones del cliente se mantienen registradas: en la vida
    // real, al reconectar con "clean session=false" se conservarían; aquí
    // simplemente el cliente re-suscribe explícitamente al reconectar.
  }

  async publish(topic: string, payload: unknown, options: PublishOptions): Promise<void> {
    if (!this.connected) {
      throw new Error(`MemoryTransport(${this.clientId}): publish con transporte desconectado`);
    }
    await this.broker.publish(this.clientId, topic, payload, options);
  }

  subscribe(topicFilter: string, handler: MessageHandler): void {
    this.filters.add(topicFilter);
    this.broker.subscribe(this.clientId, topicFilter, handler);
  }

  unsubscribe(topicFilter: string): void {
    this.filters.delete(topicFilter);
    this.broker.unsubscribe(this.clientId, topicFilter);
  }

  isConnected(): boolean {
    return this.connected;
  }
}
