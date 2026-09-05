import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { connect, MqttClient } from 'mqtt';
import {
  CommandBuilder,
  MaintenanceCommandType,
  MaintenanceRequestedBy,
} from '../../contracts/command-builder';
import { ContractValidator } from '../../contracts/contract-validator';
import { BACKEND_SUBSCRIPTIONS, parseTopic, topics } from '../../contracts/topics';
import { AppConfig, CONFIG, PUBLISH_ACK_TIMEOUT_MS_DEFAULT } from '../../config/configuration';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IngestService } from './ingest.service';

/**
 * Resultado de intentar publicar. En MQTT una denegación de ACL es SILENCIOSA
 * a nivel de transporte: el broker no cierra la conexión ni levanta un error
 * de socket, simplemente no reenvía el mensaje. La única señal que lo delata
 * es el PUBACK de MQTT5 con `reasonCode >= 0x80` (p. ej. 135 = "Not
 * authorized"), que mosquitto sí emite cuando el cliente negocia protocolo 5
 * (ver `onModuleInit`: `protocolVersion: 5`). Sin leer ese reasonCode,
 * `denied` y `delivered=true` son indistinguibles — que es exactamente el
 * defecto que este tipo viene a cerrar.
 */
export interface PublishResult {
  /** El broker confirmó la publicación (PUBACK sin reasonCode de error). */
  delivered: boolean;
  /** El broker RECHAZÓ la publicación por ACL (o error equivalente ≥0x80). */
  denied: boolean;
  /** Código de motivo del PUBACK/PUBREC, si el broker lo mandó. */
  reasonCode: number | null;
  /**
   * El broker aceptó el TCP pero NO confirmó dentro del plazo. No es lo mismo
   * que «no ha llegado»: mqtt.js puede seguir reintentando por debajo y el
   * mensaje puede acabar entregándose. Es incertidumbre, y se informa como
   * tal (`delivered: false`), nunca como éxito.
   */
  timedOut: boolean;
}

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
    private readonly prisma: PrismaService,
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
      // VM devuelve el backend a texto en claro sin romper nada visible —
      // ninguna excepción, ningún error en el log, y con el listener 1883
      // todavía escuchando para recibirlo.
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

  /**
   * Publica validando antes contra el esquema del tópico, y DICE si ha
   * salido de verdad. Antes devolvía `boolean` sincrónico (booleano derivado
   * sólo de si había socket conectado): eso distinguía «he publicado» de «se
   * ha encolado» (defecto D3 de G-I) pero era CIEGO a la denegación de ACL,
   * que es silenciosa en el protocolo — el broker no cierra la conexión, sólo
   * no reenvía el mensaje. Con `protocolVersion: 5` (ver `onModuleInit`) el
   * PUBACK trae `reasonCode`; mosquitto pone ahí 135 ("Not authorized")
   * cuando la ACL deniega la escritura. Por eso ahora es asíncrono: hay que
   * esperar la confirmación del broker, no basta con haber escrito al socket.
   */
  async publish(topic: string, payload: Record<string, unknown>, retain = false): Promise<PublishResult> {
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
      return { delivered: false, denied: false, reasonCode: null, timedOut: false };
    }
    if (!this.client.connected) {
      // mqtt.js encola en vez de fallar: la orden NO ha salido todavía, y sin
      // conexión no hay PUBACK que esperar.
      this.logger.warn(`Publicación encolada, sin conexión con el broker: ${topic}`);
      this.client.publish(topic, JSON.stringify(payload), { qos: parsed.qos, retain });
      return { delivered: false, denied: false, reasonCode: null, timedOut: false };
    }

    const client = this.client;
    const ackTimeoutMs = this.config.mqtt.publishAckTimeoutMs ?? PUBLISH_ACK_TIMEOUT_MS_DEFAULT;
    return new Promise<PublishResult>((resolve) => {
      // Un único punto de resolución: si vence el plazo y DESPUÉS llega el
      // PUBACK, el callback tardío no debe volver a resolver ni reabrir nada.
      let settled = false;
      const settle = (result: PublishResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        this.logger.error(
          `El broker no confirmó la publicación en ${topic} en ${ackTimeoutMs} ms. ` +
            'Se informa como NO entregada; mqtt.js puede seguir reintentándola por debajo.',
        );
        settle({ delivered: false, denied: false, reasonCode: null, timedOut: true });
      }, ackTimeoutMs);
      // No mantener vivo el proceso por un ACK que no llega.
      (timer as { unref?: () => void }).unref?.();
      client.publish(topic, JSON.stringify(payload), { qos: parsed.qos, retain }, (error, packet) => {
        if (error) {
          // mqtt.js convierte un PUBACK/PUBREC con reasonCode de error en un
          // `ErrorWithReasonCode` cuyo `.code` ES ese reasonCode (ver
          // node_modules/mqtt/build/lib/handlers/ack.js). >=0x80 es SIEMPRE
          // fallo en MQTT5; lo tratamos como denegación salvo que el propio
          // código diga otra cosa (p. ej. error de red, sin reasonCode).
          const reasonCode = typeof (error as { code?: number }).code === 'number'
            ? (error as { code: number }).code
            : null;
          const denied = reasonCode !== null && reasonCode >= 0x80;
          if (denied) {
            this.logger.error(
              `Publicación DENEGADA por el broker en ${topic} (reasonCode=${reasonCode}): ${error.message}`,
            );
            void this.recordPublishDenied(topic, reasonCode, error.message);
          } else {
            this.logger.error(`Fallo confirmando la publicación en ${topic}: ${error.message}`);
          }
          settle({ delivered: false, denied, reasonCode, timedOut: false });
          return;
        }
        const reasonCode =
          packet && typeof (packet as { reasonCode?: number }).reasonCode === 'number'
            ? (packet as { reasonCode: number }).reasonCode
            : null;
        settle({ delivered: true, denied: false, reasonCode, timedOut: false });
      });
    });
  }

  /**
   * Deja incidencia CONSULTABLE (no sólo log) de que el backend no ha podido
   * publicar en un tópico que su propio código necesita. Es justo el hueco
   * que dejaba `delivered`: un `delivered: true` de PUBACK aceptado por el
   * socket no decía nada del ACL, así que una denegación de producción no
   * dejaba ni rastro consultable — sólo la línea de log de mosquitto, que
   * nadie del backend lee.
   */
  private async recordPublishDenied(topic: string, reasonCode: number, reasonMessage: string): Promise<void> {
    try {
      await this.prisma.incident.create({
        data: {
          kind: 'mqtt_publish_denied',
          severity: 'critical',
          source: 'mqtt',
          message: `El broker denegó la publicación del backend en ${topic} (reasonCode=${reasonCode}).`,
          detail: { topic, reason_code: reasonCode, reason_message: reasonMessage } as never,
        },
      });
    } catch (error) {
      // No dejar que un fallo de BD tape la denegación original en los logs.
      this.logger.error(
        `No se pudo registrar la incidencia de publicación denegada (${topic}): ${(error as Error).message}`,
      );
    }
  }

  /*
   * RETIRADO: `sendModuleCommand()` — publicaba en `topics.moduleCommand()`,
   * es decir en `targets/v1/module/{id}/command`, el canal de JUEGO.
   *
   * Era el ÚNICO camino por el que el backend podía escribir en ese tópico, y
   * seguía vivo y autenticado a través de `POST /mqtt/modules/:id/command`
   * (permiso `commands:publish`, que tienen de serie `operador`, `gestor` y
   * `mantenimiento`). Lo único que lo frenaba era la ACL del broker: defensa
   * de segunda línea que una errata de despliegue, un reinicio con la
   * configuración vieja o una migración de broker convierten en nada, sin
   * tocar una línea de código.
   *
   * Se ha valorado dejarlo apagado tras una comprobación en el propio backend
   * y reorientarlo al canal de mantenimiento. Ambas se descartan: la orden
   * del operador prohíbe el puente «ni siquiera apagado», y los repertorios
   * de `action` (juego) y `command_type` (mantenimiento) son disjuntos por
   * diseño, así que reorientarlo sería inventar traducciones que el contrato
   * no define. `operator-cli` sigue siendo emisor legítimo de este canal,
   * pero publica con SUS credenciales contra el broker (ver
   * `simulators/src/domain/coordinator.ts`); no necesitaba, ni usaba, este
   * relé del backend.
   *
   * No lo reintroduzcas: `test/mqtt/no-backend-writes-game-command.spec.ts`
   * recorre el AST de todo `src/` y falla con fichero y línea.
   */

  /**
   * Orden de MANTENIMIENTO (ampliación v1.1). Publica EXCLUSIVAMENTE en
   * `module/{id}/maintenance/command` — jamás en `module/{id}/command`
   * (`topics.moduleCommand`), que es del coordinador y ni siquiera aparece
   * mencionado en este método. No añadas aquí, ni en ningún sitio de este
   * servicio, un camino que reescriba en ese tópico: es la orden expresa del
   * operador (decisión de autoridad por dominio, README §0/§2.1) y la prueba
   * `test/mqtt/no-backend-writes-game-command.spec.ts` la fija.
   */
  async sendModuleMaintenanceCommand(
    moduleId: string,
    commandType: MaintenanceCommandType,
    requestedBy: MaintenanceRequestedBy,
    params?: Record<string, unknown>,
    expiresInMs?: number,
    requestId?: string,
  ): Promise<Record<string, unknown>> {
    const command = this.commands.maintenanceCommand(moduleId, commandType, requestedBy, params, {
      expiresInMs,
      requestId,
    });
    const result = await this.publish(topics.moduleMaintenanceCommand(moduleId), command);
    return { ...command, delivered: result.delivered, denied: result.denied };
  }

  /** Comando al sistema (arm/start/pause/resume/abort/end). */
  async sendSystemCommand(
    systemId: string,
    action: string,
    extra: Record<string, unknown> = {},
    expiresInMs?: number,
  ): Promise<Record<string, unknown>> {
    const command = this.commands.systemCommand(systemId, action, extra, { expiresInMs });
    // `delivered=false` = no ha llegado (sin cliente/conexión).
    // `denied=true` = el broker LA HA RECHAZADO por ACL: quien la ordena debe
    // poder decir eso en pantalla, no sólo «no ha llegado».
    const result = await this.publish(topics.systemCommand(systemId), command);
    return { ...command, delivered: result.delivered, denied: result.denied };
  }

  /** Orden OTA. Sin firma no sale del backend. */
  async sendOtaCommand(
    moduleId: string,
    action: 'update' | 'confirm' | 'rollback' | 'cancel',
    firmware?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const command = this.commands.otaCommand(moduleId, action, firmware);
    const result = await this.publish(topics.moduleOta(moduleId), command);
    return { ...command, delivered: result.delivered, denied: result.denied };
  }

  /** Estado del sistema, retenido (contrato §2). */
  async publishSystemStatus(payload: Record<string, unknown>): Promise<PublishResult> {
    return this.publish(topics.systemStatus(String(payload.system_id)), payload, true);
  }

  /** Configuración deseada de un módulo, retenida. */
  async publishModuleConfig(moduleId: string, payload: Record<string, unknown>): Promise<PublishResult> {
    return this.publish(topics.moduleConfigDesired(moduleId), payload, true);
  }
}
