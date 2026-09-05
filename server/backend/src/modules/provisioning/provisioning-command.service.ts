import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { parseTopic, topics } from '../../contracts/topics';
import { MqttService, PublishResult } from '../mqtt/mqtt.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import {
  COMMAND_PLANE,
  CanonicalDelegation,
  SCHEMA_VERSION,
  SIGNATURE_ALG,
  canonicalizeOrder,
} from './provisioning-canonical';
import { KEY_FILE_ENV, ProvisioningSigner, PROVISIONING_SIGNER } from './provisioning-signer';
import {
  EmittedOrderRecord,
  PROVISIONING_ORDER_REPOSITORY,
  ProvisioningAction,
  ProvisioningMode,
  ProvisioningOrderRepositoryPort,
} from './provisioning.ports';

/** Credencial que la raíz de fábrica emitió para la clave operativa. */
export interface DelegationCredential extends CanonicalDelegation {
  rootSignature: string;
}

export const PROVISIONING_DELEGATION = Symbol('PROVISIONING_DELEGATION');

export interface IssueOrderInput {
  deviceId: string;
  systemId: string;
  action: ProvisioningAction;
  mode?: ProvisioningMode;
  /** SHA-256 hex de la clave de aprovisionamiento de FÁBRICA del dispositivo. */
  provisioningKeyFingerprint: string;
  rotationId?: string;
  currentEpoch?: string;
  nextEpoch?: string;
  epoch?: string;
  provisionId?: string;
}

export interface IssuedOrder {
  requestId: string;
  provisioningSequence: string;
  topic: string;
  publish: PublishResult;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Emisión de órdenes FIRMADAS del plano DEVICE_MANAGEMENT (contrato v1.2).
 *
 * ── RETENCIÓN ────────────────────────────────────────────────────────────────
 * Este servicio NO tiene forma de publicar un retenido. No es una convención:
 *
 *   · ningún método público ni privado acepta un parámetro `retain`;
 *   · la única salida a MQTT es `publishNeverRetained()`, que pasa el literal
 *     `false` y ANTES comprueba contra `parseTopic()` que el contrato
 *     clasifica ese tópico como no retenido — de modo que si alguien moviera
 *     `module-provision-command` a la lista `RETAINED` de `topics.ts`, esto
 *     dejaría de publicar en lugar de empezar a retener en silencio.
 *
 * Importa porque un comando ejecutable retenido no es un mensaje: es un replay
 * que el broker sirve, ya firmado y válido, a cualquiera que se suscriba
 * después — incluido el propio módulo al reconectar.
 *
 * ── AUTORIDAD ────────────────────────────────────────────────────────────────
 * La autoridad la da la FIRMA, no el tópico. Publicar aquí es PROPONER: el
 * módulo verifica firma, delegación, direccionamiento, epoch y secuencia antes
 * de aplicar nada, y puede rechazar cualquier orden bien firmada.
 *
 * Este servicio NO lee jamás `provision/state`. No tiene inyectado el
 * repositorio observacional ni el sumidero de estado, y la comprobación de esa
 * ausencia es un test estructural sobre los metadatos de inyección de Nest, no
 * una promesa en un comentario.
 */
@Injectable()
export class ProvisioningCommandService {
  private readonly logger = new Logger(ProvisioningCommandService.name);

  constructor(
    private readonly mqtt: MqttService,
    @Inject(PROVISIONING_ORDER_REPOSITORY)
    private readonly orders: ProvisioningOrderRepositoryPort,
    @Inject(PROVISIONING_SIGNER) private readonly signer: ProvisioningSigner | null,
    @Inject(PROVISIONING_DELEGATION) private readonly delegation: DelegationCredential | null,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * `true` si hay clave operativa y delegación cargadas. Sin ellas el plano
   * está APAGADO: no se firma nada y las rutas devuelven 503. Es fallo cerrado
   * a propósito — la alternativa sería emitir órdenes sin firma, que el módulo
   * rechazaría, dejando al operador con un «se envió» que no significa nada.
   */
  get configured(): boolean {
    return this.signer !== null && this.delegation !== null;
  }

  /**
   * Construye, firma, valida y publica una orden.
   *
   * El orden de operaciones es deliberado: la secuencia se reserva ANTES de
   * firmar (una secuencia reservada y no usada sólo produce un hueco, que es
   * inocuo; una secuencia reutilizada produce un replay, que no lo es), y el
   * registro de emisión se escribe con el resultado real de la publicación,
   * incluido el rechazo por ACL.
   */
  async issue(input: IssueOrderInput, actor?: AuthenticatedUser | null): Promise<IssuedOrder> {
    const signer = this.signer;
    const delegation = this.delegation;
    if (!signer || !delegation) {
      throw new ServiceUnavailableException(
        'El plano de aprovisionamiento no está configurado: falta la clave operativa ' +
          `(${KEY_FILE_ENV}) o la credencial de delegación. No se firma nada.`,
      );
    }
    this.validateShape(input);

    const requestId = randomUUID();
    const sequence = await this.orders.allocateSequence(input.deviceId);
    const issuedAtMs = BigInt(Date.now());

    const canonicalFields = {
      action: input.action,
      mode: input.mode ?? null,
      systemId: input.systemId,
      deviceId: input.deviceId,
      provisioningSequence: sequence,
      rotationId: input.rotationId ?? null,
      currentEpoch: input.currentEpoch ?? null,
      nextEpoch: input.nextEpoch ?? null,
      epoch: input.epoch ?? null,
      issuedAtMs,
      provisioningKeyFingerprint: input.provisioningKeyFingerprint,
      provisionId: input.provisionId ?? null,
    } as const;

    const signature = signer.signCanonical(canonicalizeOrder(canonicalFields));

    const payload: Record<string, unknown> = {
      schema_version: SCHEMA_VERSION,
      command_plane: COMMAND_PLANE,
      request_id: requestId,
      device_id: input.deviceId,
      system_id: input.systemId,
      action: input.action,
      provisioning_sequence: Number(sequence),
      issued_at_ms: Number(issuedAtMs),
      provisioning_key_fingerprint: input.provisioningKeyFingerprint,
      signature_alg: SIGNATURE_ALG,
      signature,
    };
    // Los opcionales se AÑADEN sólo si están: el esquema prohíbe el campo
    // presente donde no toca, y —más importante— un campo con cadena vacía
    // canonicaliza igual que ausente pero viaja distinto, así que emitirlo
    // sería firmar una cosa y mandar otra.
    if (input.mode !== undefined) payload.mode = input.mode;
    if (input.rotationId !== undefined) payload.rotation_id = input.rotationId;
    if (input.currentEpoch !== undefined) payload.current_epoch = input.currentEpoch;
    if (input.nextEpoch !== undefined) payload.next_epoch = input.nextEpoch;
    if (input.epoch !== undefined) payload.epoch = input.epoch;
    if (input.provisionId !== undefined) payload.provision_id = input.provisionId;
    if (input.action === 'PROVISION') payload.delegation = this.delegationPayload(delegation);

    const topic = topics.moduleProvisionCommand(input.deviceId);
    const publish = await this.publishNeverRetained(topic, payload);

    const record: EmittedOrderRecord = {
      requestId,
      deviceId: input.deviceId,
      systemId: input.systemId,
      action: input.action,
      mode: input.mode ?? null,
      provisioningSequence: sequence,
      rotationId: input.rotationId ?? null,
      epoch: input.epoch ?? null,
      currentEpoch: input.currentEpoch ?? null,
      nextEpoch: input.nextEpoch ?? null,
      provisionId: input.provisionId ?? null,
      issuedAtMs,
      actorUserId: actor?.userId ?? null,
      actorUsername: actor?.username ?? null,
      publishOutcome: outcomeOf(publish),
      publishReasonCode: publish.reasonCode,
    };
    await this.orders.recordEmitted(record);

    // Auditoría: quién ordenó qué. La FIRMA no se audita —`signature` está en
    // la lista de redacción de AuditService, y aunque no lo estuviera, guardar
    // la firma no aporta nada que no diga ya el `request_id`—.
    await this.audit?.record({
      user: actor ?? null,
      action: `provisioning.${input.action.toLowerCase()}`,
      entity: 'provisioning_order',
      entityId: requestId,
      after: {
        device_id: input.deviceId,
        system_id: input.systemId,
        action: input.action,
        mode: input.mode ?? null,
        provisioning_sequence: sequence.toString(),
        rotation_id: input.rotationId ?? null,
        epoch: input.epoch ?? null,
        publish_outcome: record.publishOutcome,
        publish_reason_code: publish.reasonCode,
        operational_key_id: signer.keyId,
      },
    });

    if (publish.denied) {
      this.logger.error(
        `El broker DENEGÓ la orden de aprovisionamiento ${requestId} para ${input.deviceId} ` +
          `(reasonCode=${publish.reasonCode}). La orden NO ha llegado al módulo.`,
      );
    }

    return {
      requestId,
      provisioningSequence: sequence.toString(),
      topic,
      publish,
    };
  }

  /**
   * ÚNICA salida a MQTT de este módulo, y la única razón de que exista: que no
   * haya ningún camino por el que una orden de aprovisionamiento salga
   * retenida.
   */
  private async publishNeverRetained(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<PublishResult> {
    const parsed = parseTopic(topic);
    if (!parsed || parsed.kind !== 'module-provision-command') {
      throw new Error(`${topic} no es el canal de órdenes de aprovisionamiento.`);
    }
    if (parsed.retain) {
      throw new Error(
        'El contrato clasifica el canal de órdenes de aprovisionamiento como RETENIDO. ' +
          'Un comando ejecutable retenido es un replay servido por el broker: se aborta ' +
          'la publicación en vez de emitirlo.',
      );
    }
    return this.mqtt.publish(topic, payload, false);
  }

  private delegationPayload(delegation: DelegationCredential): Record<string, unknown> {
    return {
      delegation_version: Number(delegation.delegationVersion),
      delegation_id: delegation.delegationId,
      root_key_id: delegation.rootKeyId,
      operational_key_id: delegation.operationalKeyId,
      operational_public_key: delegation.operationalPublicKey,
      scope: delegation.scope,
      delegation_sequence: Number(delegation.delegationSequence),
      system_id: delegation.systemId,
      root_signature: delegation.rootSignature,
    };
  }

  /**
   * Comprueba en el backend lo que el esquema exige por acción.
   *
   * Es redundante con la validación de `MqttService.publish()` a propósito: un
   * fallo aquí devuelve un 400 con el motivo al operador, mientras que el del
   * publicador es una excepción de contrato en el camino de salida. Que exista
   * la barrera de contrato no es motivo para mandarle basura.
   */
  private validateShape(input: IssueOrderInput): void {
    if (!HEX64.test(input.provisioningKeyFingerprint)) {
      throw new BadRequestException(
        'provisioning_key_fingerprint debe ser un SHA-256 en hexadecimal minúscula (64 caracteres).',
      );
    }
    const forbid = (fields: Array<keyof IssueOrderInput>): void => {
      const present = fields.filter((f) => input[f] !== undefined);
      if (present.length > 0) {
        throw new BadRequestException(
          `El contrato prohíbe ${present.join(', ')} en una orden ${input.action}.`,
        );
      }
    };
    const require = (fields: Array<keyof IssueOrderInput>): void => {
      const missing = fields.filter((f) => input[f] === undefined);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Una orden ${input.action} exige ${missing.join(', ')}.`,
        );
      }
    };

    if (input.action === 'PROVISION') {
      require(['epoch', 'provisionId']);
      forbid(['mode', 'rotationId', 'currentEpoch', 'nextEpoch']);
    } else if (input.action === 'PREPARE') {
      require(['mode', 'rotationId', 'currentEpoch', 'nextEpoch']);
      forbid(['epoch', 'provisionId']);
    } else if (input.action === 'COMMIT') {
      require(['mode', 'rotationId']);
      forbid(['epoch', 'currentEpoch', 'nextEpoch', 'provisionId']);
    } else {
      throw new BadRequestException(`Acción desconocida: ${String(input.action)}`);
    }
  }
}

function outcomeOf(result: PublishResult): string {
  if (result.denied) return 'denied';
  if (result.delivered) return 'delivered';
  if (result.timedOut) return 'timed_out';
  return 'queued';
}
