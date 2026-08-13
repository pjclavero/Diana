import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { connect, MqttClient } from 'mqtt';
import { CommandBuilder } from '../../contracts/command-builder';
import { ContractValidator } from '../../contracts/contract-validator';
import { BACKEND_SUBSCRIPTIONS, parseTopic, topics } from '../../contracts/topics';
import { AppConfig, CONFIG } from '../../config/configuration';
import { IngestService } from './ingest.service';

/**
 * Cliente MQTT del backend.
 *
 * - Se suscribe a los tópicos del contrato §2 con su QoS.
 * - Toda publicación se VALIDA contra el esquema antes de salir: el backend no
 *   puede ser la fuente de un mensaje que incumple su propio contrato.
 * - Los comandos llevan `command_id`, `nonce` monotónico y `expires_in_ms`.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: MqttClient | null = null;
  readonly commands = new CommandBuilder();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly validator: ContractValidator,
    private readonly ingest: IngestService,
  ) {}

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Desde cuándo estamos oyendo al broker sin interrupción. `null` = no hay
   * conexión. Lo necesita el barrido de presencia: mientras el backend estuvo
   * desconectado no oyó a NADIE, y el silencio de ese rato es sordera nuestra,
   * no una caída de los módulos.
   */
  get connectedSince(): Date | null {
    // La ventana la corta `connected` —mientras el cliente está caído no oímos
    // nada— y la rearma el evento `connect` de la reconexión. No hacen falta
    // manejadores de `close`/`offline`: serían código sin efecto, y código sin
    // efecto sobre un guardarraíl aparenta una protección que no aporta.
    return this.client?.connected ? this.connectedAt : null;
  }
  private connectedAt: Date | null = null;

  /**
   * Opciones TLS del cliente. Devuelve `{}` para una URL en claro.
   *
   * Tres decisiones, todas de fallar cerrado:
   *
   * - Si la URL es TLS y NO hay CA configurada, esto LANZA en el arranque en
   *   lugar de conectar. Sin CA, Node validaría contra los certificados
   *   públicos del sistema, que no firman nuestro broker: o falla igualmente,
   *   o —peor— alguien "arregla" el síntoma desactivando la validación. Un
   *   arranque que muere diciendo por qué es preferible a un backend vivo
   *   hablando con un broker que no ha verificado.
   * - `rejectUnauthorized` se deja explícito en `true` aunque sea el valor por
   *   defecto de Node: es la línea que alguien tocaría con prisa, y quien la
   *   toque debe ver que está escrita a propósito.
   * - `servername` no se fija a mano: mqtt.js lo toma del host de la URL, así
   *   que la verificación de nombre se hace contra el host al que realmente
   *   nos conectamos. Fijarlo desactivaría de hecho esa comprobación.
   */
  private tlsOptions(): Record<string, unknown> {
    const isTls = /^(mqtts|wss|ssl|tls):\/\//.test(this.config.mqtt.url);
    if (!isTls) {
      // La escapatoria real de P0-2, y la única que no cerraba nada de lo
      // anterior: MQTT_URL tiene precedencia absoluta sobre protocolo, host y
      // puerto, así que un `MQTT_URL=mqtt://mosquitto:1883` en el .env de la
      // VM devolvía el backend a texto en claro sin romper nada visible —
      // ninguna excepción, ningún error en el log, y con el listener 1883
      // interno todavía escuchando para recibirlo.
      //
      // Un test no puede ver eso: es un hecho del despliegue, no del código.
      // Así que se cierra donde sí se puede, en el arranque. Fuera de
      // producción se permite (el laboratorio y las pruebas de integración lo
      // necesitan) y se avisa; en producción aborta.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `MQTT en claro (${this.config.mqtt.url}) no está permitido en producción: ` +
            'una URL sin TLS deja el transporte sin cifrar y sin validar la ' +
            'identidad del broker (P0-2). Usa mqtts:// con MQTT_CA_FILE.',
        );
      }
      this.logger.warn(
        `MQTT en claro (${this.config.mqtt.url}): el transporte NO está cifrado ` +
          'y no se valida la identidad del broker. Sólo aceptable fuera de producción.',
      );
      return {};
    }

    const caFile = this.config.mqtt.caFile;
    if (!caFile) {
      throw new Error(
        `MQTT_CA_FILE es obligatorio para conectar por TLS a ${this.config.mqtt.url}: ` +
          'sin CA no se puede validar la identidad del broker.',
      );
    }
    let ca: Buffer;
    try {
      ca = readFileSync(caFile);
    } catch (error) {
      throw new Error(
        `No se puede leer la CA de MQTT en ${caFile}: ${(error as Error).message}`,
      );
    }
    return { ca: [ca], rejectUnauthorized: true };
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.mqtt.enabled) {
      this.logger.warn('Cliente MQTT deshabilitado (MQTT_ENABLED=false)');
      return;
    }
    this.client = connect(this.config.mqtt.url, {
      clientId: this.config.mqtt.clientId,
      username: this.config.mqtt.username ?? undefined,
      password: this.config.mqtt.password ?? undefined,
      clean: true,
      reconnectPeriod: 2000,
      protocolVersion: 5,
      ...this.tlsOptions(),
    });

    this.client.on('connect', () => {
      this.logger.log(`Conectado a ${this.config.mqtt.url}`);
      this.connectedAt = new Date();
      for (const subscription of BACKEND_SUBSCRIPTIONS) {
        this.client?.subscribe(subscription.filter, { qos: subscription.qos }, (error) => {
          if (error) this.logger.error(`No se pudo suscribir a ${subscription.filter}: ${error.message}`);
        });
      }
    });

    this.client.on('error', (error) => this.logger.error(`Error MQTT: ${error.message}`));
    this.client.on('reconnect', () => this.logger.warn('Reconectando al broker…'));

    this.client.on('message', (topic, payload) => {
      // T3 se toma AQUÍ, lo más cerca posible de la llegada del mensaje.
      const receivedAt = new Date();
      void this.ingest.handleMessage(topic, payload, receivedAt).catch((error) => {
        this.logger.error(`Fallo procesando ${topic}: ${(error as Error).message}`);
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, () => resolve());
    });
  }

  /** Publica validando antes contra el esquema del tópico. */
  /**
   * Publica y DICE si ha salido. Antes devolvía void y un `return` silencioso
   * cuando no había cliente: quien ordenaba una pausa no podía distinguir
   * «ordenada» de «descartada» (defecto D3 del supervisor de G-I).
   */
  publish(topic: string, payload: Record<string, unknown>, retain = false): boolean {
    const parsed = parseTopic(topic);
    if (!parsed) throw new Error(`Tópico fuera del contrato v1: ${topic}`);

    const outcome = this.validator.validate(parsed.schema, payload);
    if (!outcome.ok) {
      throw new Error(
        `El backend intentó publicar un mensaje inválido en ${topic}: ` +
          `${outcome.message} ${outcome.errors.join('; ')}`,
      );
    }
    if (!this.client) {
      this.logger.warn(`Publicación descartada (sin cliente MQTT): ${topic}`);
      return false;
    }
    if (!this.client.connected) {
      // mqtt.js encola en vez de fallar: la orden NO ha salido todavía.
      this.logger.warn(`Publicación encolada, sin conexión con el broker: ${topic}`);
      this.client.publish(topic, JSON.stringify(payload), { qos: parsed.qos, retain });
      return false;
    }
    this.client.publish(topic, JSON.stringify(payload), { qos: parsed.qos, retain });
    return true;
  }

  /** Comando a un módulo (contrato §6). */
  sendModuleCommand(
    moduleId: string,
    action: string,
    params?: Record<string, unknown>,
    expiresInMs?: number,
  ): Record<string, unknown> {
    const command = this.commands.moduleCommand(moduleId, action, params, { expiresInMs });
    // `delivered` importa: mqtt.js ENCOLA cuando no hay conexión en vez de
    // fallar, así que sin este dato «he publicado» se confundía con «ha
    // llegado». Mismo criterio que en `sendSystemCommand`.
    const delivered = this.publish(topics.moduleCommand(moduleId), command);
    return { ...command, delivered };
  }

  /** Comando al sistema (arm/start/pause/resume/abort/end). */
  sendSystemCommand(
    systemId: string,
    action: string,
    extra: Record<string, unknown> = {},
    expiresInMs?: number,
  ): Record<string, unknown> {
    const command = this.commands.systemCommand(systemId, action, extra, { expiresInMs });
    // `delivered=false` = el broker no la ha recibido (sin cliente o sin
    // conexión). Quien la ordena debe poder decirlo en pantalla.
    const delivered = this.publish(topics.systemCommand(systemId), command);
    return { ...command, delivered };
  }

  /** Orden OTA. Sin firma no sale del backend. */
  sendOtaCommand(
    moduleId: string,
    action: 'update' | 'confirm' | 'rollback' | 'cancel',
    firmware?: Record<string, unknown>,
  ): Record<string, unknown> {
    const command = this.commands.otaCommand(moduleId, action, firmware);
    this.publish(topics.moduleOta(moduleId), command);
    return command;
  }

  /** Estado del sistema, retenido (contrato §2). */
  publishSystemStatus(payload: Record<string, unknown>): void {
    this.publish(topics.systemStatus(String(payload.system_id)), payload, true);
  }

  /** Configuración deseada de un módulo, retenida. */
  publishModuleConfig(moduleId: string, payload: Record<string, unknown>): void {
    this.publish(topics.moduleConfigDesired(moduleId), payload, true);
  }
}
