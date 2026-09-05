import { Inject, Injectable, Logger } from '@nestjs/common';

import { ContractValidator } from '../../contracts/contract-validator';
import { TOPIC_SCHEMA } from '../../contracts/topics';
import {
  ObservedProvisionState,
  PROVISIONING_ORDER_REPOSITORY,
  PROVISIONING_STATE_REPOSITORY,
  ProvisionStateSinkPort,
  ProvisioningOrderRepositoryPort,
  ProvisioningStateRepositoryPort,
} from './provisioning.ports';

export type StateIngestStatus = 'accepted' | 'rejected';

export interface StateIngestResult {
  status: StateIngestStatus;
  code?: string;
  message?: string;
  errors?: string[];
  correlated?: boolean;
}

/**
 * Ingesta de `targets/v1/module/{id}/provision/state`.
 *
 * ── `provision/state` NUNCA ES AUTORIDAD ─────────────────────────────────────
 *
 * La regla no vive en un comentario: vive en lo que esta clase NO tiene.
 *
 *   · Sus dependencias son un validador y DOS repositorios. No tiene
 *     `MqttService`, ni `ProvisioningCommandService`, ni ningún puerto capaz
 *     de publicar, de ordenar o de escribir configuración. No puede disparar
 *     una acción porque no tiene con qué. `test/provisioning/state-not-authority.spec.ts`
 *     lo comprueba leyendo los metadatos de inyección de Nest —estructura, no
 *     una búsqueda de texto—, así que añadir esa dependencia pone el test rojo.
 *   · Del repositorio de ÓRDENES sólo usa `findByRequestId`, que es una
 *     lectura para correlacionar. La secuencia de la siguiente orden sale de
 *     `allocateSequence()`, del lado de mando, y jamás de
 *     `last_provisioning_sequence` reportado: si se dedujera de ahí, quien
 *     pudiera publicar en el tópico del módulo elegiría la secuencia de la
 *     próxima orden del backend.
 *   · Lo persistido es una `ObservedProvisionState` —«lo que el módulo dijo»—,
 *     y el repositorio observacional no expone ningún método que devuelva algo
 *     ejecutable.
 *
 * ── ORDEN DE OPERACIONES ─────────────────────────────────────────────────────
 *
 *   1. VALIDAR contra `module-provision-state.schema.json`. Nada se toca antes.
 *      La validación es estricta (`additionalProperties: false`), que es la
 *      mitad de la barrera NO_SECRET_IN_STATE: un mensaje que traiga
 *      `root_key`, `mqtt_password` o cualquier campo no declarado se rechaza
 *      entero, no se «limpia».
 *   2. Comprobar que el `device_id` del payload coincide con el del tópico. La
 *      ingesta general no cubre esto para este mensaje: su comprobación mira
 *      `module_id`, y aquí el campo se llama `device_id`, así que sin esta
 *      línea un módulo podría reportar el estado de autoridad de otro.
 *   3. Correlacionar por `request_id` con una orden emitida.
 *   4. Persistir la fotografía.
 */
@Injectable()
export class ProvisioningStateService implements ProvisionStateSinkPort {
  private readonly logger = new Logger(ProvisioningStateService.name);

  constructor(
    private readonly validator: ContractValidator,
    @Inject(PROVISIONING_STATE_REPOSITORY)
    private readonly states: ProvisioningStateRepositoryPort,
    @Inject(PROVISIONING_ORDER_REPOSITORY)
    private readonly orders: ProvisioningOrderRepositoryPort,
  ) {}

  /** Entrada desde la ingesta MQTT (sumidero). */
  async record(
    topicDeviceId: string,
    payload: Record<string, unknown>,
    receivedAt: Date,
  ): Promise<void> {
    await this.ingest(topicDeviceId, payload, receivedAt);
  }

  /**
   * Igual que `record`, pero DEVUELVE el veredicto. Es la que usan las pruebas
   * y la que permite afirmar que un mensaje se rechazó, en vez de suponerlo
   * porque no lanzó.
   */
  async ingest(
    topicDeviceId: string,
    raw: Buffer | string | Record<string, unknown>,
    receivedAt: Date = new Date(),
  ): Promise<StateIngestResult> {
    const schema = TOPIC_SCHEMA['module-provision-state'];
    const outcome =
      Buffer.isBuffer(raw) || typeof raw === 'string'
        ? this.validator.validateRaw(schema, raw)
        : this.validator.validate(schema, raw);

    if (!outcome.ok) {
      this.logger.warn(
        `provision/state rechazado para ${topicDeviceId}: ${outcome.message}`,
      );
      return {
        status: 'rejected',
        code: outcome.code,
        message: outcome.message,
        errors: outcome.errors,
      };
    }

    const payload = outcome.value as unknown as ProvisionStatePayload;

    if (payload.device_id !== topicDeviceId) {
      this.logger.warn(
        `provision/state con device_id '${payload.device_id}' publicado en el tópico ` +
          `de '${topicDeviceId}': un módulo no reporta la autoridad de otro.`,
      );
      return {
        status: 'rejected',
        code: 'device_mismatch',
        message: `El device_id del payload ('${payload.device_id}') no coincide con el del tópico ('${topicDeviceId}').`,
      };
    }

    // Correlación. Un `request_id` que este backend no emitió NO invalida el
    // mensaje: el módulo también declara su autoridad al conectar, sin orden
    // previa. Se anota como no correlacionado y punto.
    let correlated = false;
    if (payload.request_id) {
      try {
        correlated = (await this.orders.findByRequestId(payload.request_id)) !== null;
      } catch (error) {
        this.logger.error(
          `No se pudo correlacionar request_id=${payload.request_id}: ${(error as Error).message}`,
        );
      }
    }

    // Se construye campo a campo desde una lista CERRADA. Aunque el validador
    // ya rechaza los campos desconocidos, esto impide que un `...payload`
    // futuro arrastre a la base de datos algo que el esquema no declaró.
    const observed: ObservedProvisionState = {
      deviceId: payload.device_id,
      systemId: payload.system_id,
      requestId: payload.request_id ?? null,
      result: payload.result,
      state: payload.state,
      activeEpoch: payload.active_epoch ?? null,
      pendingEpoch: payload.pending_epoch ?? null,
      rotationId: payload.rotation_id ?? null,
      provisionId: payload.provision_id ?? null,
      lastProvisioningSequence: BigInt(payload.last_provisioning_sequence),
      lastDelegationSequence: BigInt(payload.last_delegation_sequence),
      provisioningKeyFingerprint: payload.provisioning_key_fingerprint,
      reason: payload.reason ?? null,
      receivedAt,
      correlated,
    };

    try {
      await this.states.upsertObserved(observed);
    } catch (error) {
      // Un fallo de persistencia no puede tumbar la ingesta, pero tiene que
      // verse: sin este registro nadie sabe en qué estado quedó el módulo.
      this.logger.error(
        `provision/state aceptado pero NO persistido (${payload.device_id}): ${(error as Error).message}`,
      );
      return { status: 'rejected', code: 'persistence_failure', message: (error as Error).message };
    }

    return { status: 'accepted', correlated };
  }

  /** Lectura observacional. Devuelve «lo que el módulo dijo», no una verdad. */
  async latestObserved(deviceId: string): Promise<ObservedProvisionState | null> {
    return this.states.findLatest(deviceId);
  }
}

interface ProvisionStatePayload {
  schema_version: number;
  command_plane: string;
  request_id?: string;
  device_id: string;
  system_id: string;
  result: string;
  state: string;
  active_epoch: string | null;
  pending_epoch: string | null;
  rotation_id?: string;
  provision_id?: string;
  last_provisioning_sequence: number;
  last_delegation_sequence: number;
  provisioning_key_fingerprint: string;
  reason?: string;
}
