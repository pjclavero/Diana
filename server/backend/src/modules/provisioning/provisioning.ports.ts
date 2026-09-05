/**
 * Puertos de persistencia del plano DEVICE_MANAGEMENT.
 *
 * Están SEPARADOS a propósito en dos, y la separación es la mitad estructural
 * de la regla «`provision/state` nunca es autoridad»:
 *
 *   · `ProvisioningOrderRepositoryPort` es el lado de MANDO. Guarda lo que el
 *     backend EMITIÓ y de él sale la secuencia monotónica.
 *   · `ProvisioningStateRepositoryPort` es el lado OBSERVACIONAL. Guarda lo
 *     que el módulo REPORTÓ y no tiene ni un método que devuelva algo
 *     ejecutable.
 *
 * Ningún método del segundo alimenta al primero. En particular NO existe —ni
 * debe existir— un `nextSequenceFromReportedState()`: si la secuencia
 * siguiente se dedujera de `last_provisioning_sequence` reportado, un módulo
 * (o quien pudiera publicar en su tópico) elegiría la secuencia de la próxima
 * orden del backend, que es exactamente convertir el reported state en
 * autoridad por la puerta de atrás.
 */

export const PROVISIONING_ORDER_REPOSITORY = Symbol('PROVISIONING_ORDER_REPOSITORY');
export const PROVISIONING_STATE_REPOSITORY = Symbol('PROVISIONING_STATE_REPOSITORY');
/** Sumidero que la ingesta MQTT invoca al recibir un `provision/state`. */
export const PROVISION_STATE_SINK = Symbol('PROVISION_STATE_SINK');

export type ProvisioningAction = 'PROVISION' | 'PREPARE' | 'COMMIT';
export type ProvisioningMode = 'NORMAL' | 'EMERGENCY';

/** Orden emitida por el backend. Es el registro de MANDO y de auditoría. */
export interface EmittedOrderRecord {
  requestId: string;
  deviceId: string;
  systemId: string;
  action: ProvisioningAction;
  mode: ProvisioningMode | null;
  provisioningSequence: bigint;
  rotationId: string | null;
  epoch: string | null;
  currentEpoch: string | null;
  nextEpoch: string | null;
  provisionId: string | null;
  issuedAtMs: bigint;
  /** Quién ordenó. Es el eslabón que ata la orden firmada a una persona. */
  actorUserId: string | null;
  actorUsername: string | null;
  /** Resultado de la publicación (`delivered` / `denied` / `timed_out` / `queued`). */
  publishOutcome: string;
  publishReasonCode: number | null;
}

export interface ProvisioningOrderRepositoryPort {
  /**
   * Reserva y persiste la SIGUIENTE secuencia para el dispositivo, de forma
   * atómica y estrictamente creciente. Debe sobrevivir a un reinicio: sin
   * persistencia, un backend recién arrancado reemitiría secuencias ya
   * consumidas y el módulo las rechazaría (`provisioning_sequence_rejected`),
   * dejando el dispositivo inmanejable.
   */
  allocateSequence(deviceId: string): Promise<bigint>;
  recordEmitted(record: EmittedOrderRecord): Promise<void>;
  findByRequestId(requestId: string): Promise<EmittedOrderRecord | null>;
}

/**
 * Fotografía OBSERVACIONAL del estado de autoridad de un módulo.
 *
 * El nombre lleva `Observed` a propósito: no es «el estado del módulo» sino
 * «lo que el módulo dijo». La diferencia importa cuando alguien vaya a
 * escribir código que dependa de esto.
 */
export interface ObservedProvisionState {
  deviceId: string;
  systemId: string;
  /** `request_id` de la orden a la que responde; `null` si no correlaciona. */
  requestId: string | null;
  result: string;
  state: string;
  activeEpoch: string | null;
  pendingEpoch: string | null;
  rotationId: string | null;
  provisionId: string | null;
  lastProvisioningSequence: bigint;
  lastDelegationSequence: bigint;
  /** Huella PÚBLICA de la clave de fábrica. Identificador, no secreto. */
  provisioningKeyFingerprint: string;
  reason: string | null;
  /** T3: instante en que el backend recibió el mensaje. Lo pone el backend. */
  receivedAt: Date;
  /** `true` si el `request_id` casa con una orden que este backend emitió. */
  correlated: boolean;
}

export interface ProvisioningStateRepositoryPort {
  /** Sustituye la última fotografía observada del dispositivo. */
  upsertObserved(state: ObservedProvisionState): Promise<void>;
  findLatest(deviceId: string): Promise<ObservedProvisionState | null>;
}

export interface ProvisionStateSinkPort {
  /**
   * Se invoca desde la ingesta MQTT con el payload YA VALIDADO contra
   * `module-provision-state.schema.json`.
   */
  record(topicDeviceId: string, payload: Record<string, unknown>, receivedAt: Date): Promise<void>;
}
