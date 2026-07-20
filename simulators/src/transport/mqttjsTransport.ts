import mqtt, { type MqttClient } from 'mqtt';
import type { MessageHandler, PublishOptions, Transport, WillMessage } from './types.js';

export interface MqttJsTransportOptions {
  url: string; // p.ej. mqtt://192.168.1.209:1883
  username?: string;
  password?: string;
  /** Latencia simulada añadida a publish() en ms, para escenarios con retraso configurable. */
  simulatedLatencyMs?: number;
}

/**
 * Transporte contra un broker Mosquitto real, usando mqtt.js.
 *
 * NO se ha ejecutado contra un broker real en este entorno de desarrollo
 * (no hay daemon Mosquitto disponible aquí). La ruta de pruebas de este
 * paquete usa exclusivamente MemoryTransport. WP-08 deberá validar esta
 * clase contra el Mosquitto real desplegado en la VM, con las credenciales
 * y ACL de infrastructure/mosquitto/.
 *
 * Uso esperado en la VM:
 *
 *   npx diana-sim run --broker mqtt://192.168.1.209:1883 \
 *     --username module-01 --password *** --modules 9 --scenario ...
 */
export class MqttJsTransport implements Transport {
  readonly clientId: string;
  private readonly opts: MqttJsTransportOptions;
  private client: MqttClient | null = null;
  private readonly handlers = new Map<string, MessageHandler[]>();

  constructor(clientId: string, opts: MqttJsTransportOptions) {
    this.clientId = clientId;
    this.opts = opts;
  }

  connect(will?: WillMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(this.opts.url, {
        clientId: this.clientId,
        username: this.opts.username,
        password: this.opts.password,
        clean: true,
        reconnectPeriod: 2000,
        will: will
          ? {
              topic: will.topic,
              payload: Buffer.from(JSON.stringify(will.payload)),
              qos: will.qos,
              retain: will.retain,
            }
          : undefined,
      });

      client.on('message', (topic, payloadBuf, packet) => {
        let payload: unknown;
        try {
          payload = JSON.parse(payloadBuf.toString('utf-8'));
        } catch {
          payload = payloadBuf.toString('utf-8');
        }
        const msg = { topic, payload, qos: packet.qos as 0 | 1 | 2, retain: packet.retain };
        for (const [filter, hs] of this.handlers) {
          void filter;
          for (const h of hs) h(msg);
        }
      });

      client.once('connect', () => {
        this.client = client;
        resolve();
      });
      client.once('error', (err) => reject(err));
    });
  }

  async disconnectGracefully(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.client?.end(false, {}, () => resolve());
    });
    this.client = null;
  }

  async kill(): Promise<void> {
    // force=true cierra el socket TCP sin DISCONNECT, tal como haría un
    // corte de alimentación o de red: el broker debe publicar el LWT.
    await new Promise<void>((resolve) => {
      this.client?.end(true, {}, () => resolve());
    });
    this.client = null;
  }

  async publish(topic: string, payload: unknown, options: PublishOptions): Promise<void> {
    if (!this.client) throw new Error('MqttJsTransport: publish sin conexión');
    if (this.opts.simulatedLatencyMs) {
      await new Promise((r) => setTimeout(r, this.opts.simulatedLatencyMs));
    }
    await new Promise<void>((resolve, reject) => {
      this.client!.publish(
        topic,
        JSON.stringify(payload),
        { qos: options.qos, retain: options.retain },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  subscribe(topicFilter: string, handler: MessageHandler): void {
    const list = this.handlers.get(topicFilter) ?? [];
    list.push(handler);
    this.handlers.set(topicFilter, list);
    this.client?.subscribe(topicFilter, { qos: 1 });
  }

  unsubscribe(topicFilter: string): void {
    this.handlers.delete(topicFilter);
    this.client?.unsubscribe(topicFilter);
  }
}
