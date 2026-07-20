export interface PublishOptions {
  qos: 0 | 1 | 2;
  retain: boolean;
}

export interface IncomingMessage {
  topic: string;
  payload: unknown;
  qos: 0 | 1 | 2;
  retain: boolean;
}

/**
 * Puede devolver una promesa: MemoryBroker espera a que todos los
 * manejadores terminen antes de resolver publish(), para que en los tests
 * (y en el escenario runner) un `await transport.publish(comando)` sólo se
 * considere completado cuando el módulo destino ya ha aplicado su efecto.
 * mqtt.js real no ofrece esta garantía (es asíncrono de verdad); ver
 * mqttjsTransport.ts.
 */
export type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;

export interface WillMessage {
  topic: string;
  payload: unknown;
  qos: 0 | 1 | 2;
  retain: boolean;
}

/**
 * Transporte MQTT abstracto. Dos implementaciones:
 *  - MemoryTransport (transport/memoryTransport.ts): broker en memoria para
 *    tests y para correr escenarios sin Mosquitto disponible.
 *  - MqttJsTransport (transport/mqttjsTransport.ts): mqtt.js contra un
 *    broker real (Mosquitto), para WP-08 en la VM.
 *
 * connect() debe registrar el Last Will ANTES de anunciarse conectado, tal
 * como exige contracts/mqtt/README.md §3.
 */
export interface Transport {
  readonly clientId: string;

  connect(will?: WillMessage): Promise<void>;

  /** Desconexión ordenada: el broker NO debe disparar el Last Will. */
  disconnectGracefully(): Promise<void>;

  /**
   * Corte de conexión abrupto (para simular pérdida de red / apagón):
   * el broker SÍ debe disparar el Last Will registrado en connect().
   */
  kill(): Promise<void>;

  publish(topic: string, payload: unknown, options: PublishOptions): Promise<void>;

  subscribe(topicFilter: string, handler: MessageHandler): void;

  unsubscribe(topicFilter: string): void;
}
