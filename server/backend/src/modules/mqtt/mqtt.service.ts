import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
    });

    this.client.on('connect', () => {
      this.logger.log(`Conectado a ${this.config.mqtt.url}`);
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
    this.publish(topics.moduleCommand(moduleId), command);
    return command;
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
