import { HitRecord } from '../../domain/hits/hit-record';

export const HIT_REPOSITORY = Symbol('HIT_REPOSITORY');
export const INCIDENT_SINK = Symbol('INCIDENT_SINK');
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
export const PRESENCE_SINK = Symbol('PRESENCE_SINK');
export const HIT_ATTRIBUTOR = Symbol('HIT_ATTRIBUTOR');

export interface InsertResult {
  /** `false` cuando el evento ya existía: duplicado normal de QoS 1. */
  inserted: boolean;
  id: string;
  /** Restricción que detectó el duplicado. */
  duplicateBy?: 'event_id' | 'module_boot_sequence';
}

/**
 * Puerto de persistencia de impactos.
 *
 * La idempotencia se resuelve en la base de datos (índice único sobre
 * `event_id` y restricción sobre `(module, boot_id, local_sequence)`), no en
 * una caché en memoria: ADR-0003 lo exige porque la caché no sobrevive a un
 * reinicio ni cubre dos instancias del backend.
 */
export interface HitRepositoryPort {
  insertIfAbsent(record: HitRecord): Promise<InsertResult>;
  findByEventId(eventId: string): Promise<HitRecord | null>;
  countByRound(roundId: string): Promise<number>;
}

export interface IncidentInput {
  kind: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  moduleSlug?: string | null;
  eventId?: string | null;
  /** Ampliación v1.1: correlaciona con la orden de mantenimiento que lo originó. */
  requestId?: string | null;
  message: string;
  detail?: unknown;
  /** T3: instante exacto en que el backend recibió el mensaje. */
  receivedAt?: Date;
  /** T1 del módulo. `epochMs=null` significa que no tenía reloj de pared. */
  moduleTime?: {
    bootId: string;
    eventUs: number;
    epochMs: number | null;
  };
}

export interface IncidentSinkPort {
  record(incident: IncidentInput): Promise<void>;
}

export interface LiveEvent {
  type: string;
  topic: string;
  payload: unknown;
  at: Date;
}

export interface EventPublisherPort {
  publish(event: LiveEvent): void;
}

/**
 * Presencia de módulo (G-I). El backend estaba suscrito a `module/+/presence`
 * (que es también el Last Will) y validaba el mensaje, pero NO lo persistía:
 * `Module.online` no lo escribía nadie, así que nada detectaba una caída.
 */
export interface PresenceUpdate {
  moduleSlug: string;
  online: boolean;
  /** connect · shutdown · lwt (contrato module-presence). */
  reason: string;
  bootId?: string | null;
  firmwareVersion?: string | null;
  hardwareRevision?: string | null;
  mac?: string | null;
  ip?: string | null;
  serial?: string | null;
  /** T3: instante de recepción en el backend. */
  at: Date;
}

export interface PresenceSinkPort {
  /** Devuelve la decisión tomada sobre la ronda, o `null` si no hubo cambio. */
  record(update: PresenceUpdate): Promise<unknown>;
  /**
   * Señal de vida sin cambio de presencia (status/telemetría/impacto).
   * `revives` = el mensaje NO es retenido, así que prueba que el módulo está
   * vivo AHORA y puede deshacer una caída declarada por silencio. Un retenido
   * (`status`) se reentrega al reconectar el backend y no prueba nada.
   */
  touch(moduleSlug: string, at: Date, revives?: boolean): Promise<void>;
}

/**
 * Atribución de impacto a participante. Se resuelve en la ingesta, con el
 * estado de la ronda; el impacto MQTT no trae jugador (ver
 * `src/domain/hits/attribution.ts`).
 */
export interface HitAttributorPort {
  /** Devuelve el participante al que corresponde el impacto, o `null` si no se puede saber. */
  resolve(input: {
    gameId: string | null;
    roundId: string | null;
    moduleSlug: string;
  }): Promise<{ participantId: string | null; basis: string; reason: string }>;
}
