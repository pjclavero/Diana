import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ContractValidator, RejectionCode } from '../../contracts/contract-validator';
import { parseTopic, ParsedTopic } from '../../contracts/topics';
import { HitEventPayload, markIfOutOfWindow, toHitRecord } from '../../domain/hits/hit-record';
import {
  EVENT_PUBLISHER,
  EventPublisherPort,
  HIT_REPOSITORY,
  HitRepositoryPort,
  INCIDENT_SINK,
  IncidentSinkPort,
} from '../hits/ports';

export type IngestStatus = 'accepted' | 'duplicate' | 'rejected' | 'ignored';

export interface IngestResult {
  status: IngestStatus;
  kind?: ParsedTopic['kind'];
  /** Identificador del registro persistido (o del existente si es duplicado). */
  id?: string;
  eventId?: string;
  code?: RejectionCode | 'unknown_topic';
  message?: string;
  errors?: string[];
  duplicateBy?: 'event_id' | 'module_boot_sequence';
  outOfWindow?: boolean;
}

export interface IngestMetrics {
  received: number;
  accepted: number;
  /** Duplicados: métrica normal de QoS 1, NO un error (ADR-0003). */
  duplicates: number;
  rejected: number;
  ignored: number;
  replayed: number;
  outOfWindow: number;
  byRejectionCode: Record<string, number>;
  byTopicKind: Record<string, number>;
}

export interface IngestOptions {
  /** Ventana de tolerancia entre recepción y persistencia, ms. */
  maxPersistLatencyMs: number;
}

export const INGEST_OPTIONS = Symbol('INGEST_OPTIONS');

const DEFAULT_OPTIONS: IngestOptions = { maxPersistLatencyMs: 5000 };

/**
 * Ingesta de mensajes MQTT.
 *
 * Orden de operaciones, deliberado:
 *   1. Resolver el tópico (fuera del contrato ⇒ `ignored`).
 *   2. Validar ESTRICTAMENTE contra el esquema congelado. Una `schema_version`
 *      futura o un campo desconocido se RECHAZAN (contrato §7).
 *   3. Traducir el payload a registro conservando T1 y T2 intactos (ADR-0002).
 *   4. Insertar de forma idempotente por `event_id` (ADR-0003). Un duplicado
 *      se contabiliza y se descarta sin tocar la puntuación.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly options: IngestOptions;

  private readonly metrics: IngestMetrics = {
    received: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    ignored: 0,
    replayed: 0,
    outOfWindow: 0,
    byRejectionCode: {},
    byTopicKind: {},
  };

  constructor(
    private readonly validator: ContractValidator,
    @Inject(HIT_REPOSITORY) private readonly hits: HitRepositoryPort,
    @Inject(INCIDENT_SINK) private readonly incidents: IncidentSinkPort,
    @Optional() @Inject(EVENT_PUBLISHER) private readonly publisher?: EventPublisherPort,
    @Optional() @Inject(INGEST_OPTIONS) options?: Partial<IngestOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
  }

  getMetrics(): IngestMetrics {
    return JSON.parse(JSON.stringify(this.metrics)) as IngestMetrics;
  }

  resetMetrics(): void {
    this.metrics.received = 0;
    this.metrics.accepted = 0;
    this.metrics.duplicates = 0;
    this.metrics.rejected = 0;
    this.metrics.ignored = 0;
    this.metrics.replayed = 0;
    this.metrics.outOfWindow = 0;
    this.metrics.byRejectionCode = {};
    this.metrics.byTopicKind = {};
  }

  /**
   * Punto de entrada desde el cliente MQTT.
   * @param receivedAt T3 · instante de recepción. Lo pone el backend y jamás
   *                   viaja en el payload.
   */
  async handleMessage(
    topic: string,
    raw: Buffer | string | unknown,
    receivedAt: Date = new Date(),
  ): Promise<IngestResult> {
    this.metrics.received += 1;

    const parsed = parseTopic(topic);
    if (!parsed) {
      this.metrics.ignored += 1;
      return {
        status: 'ignored',
        code: 'unknown_topic',
        message: `Tópico fuera del contrato v1: ${topic}`,
      };
    }
    this.metrics.byTopicKind[parsed.kind] = (this.metrics.byTopicKind[parsed.kind] ?? 0) + 1;

    const outcome =
      Buffer.isBuffer(raw) || typeof raw === 'string'
        ? this.validator.validateRaw(parsed.schema, raw as Buffer | string)
        : this.validator.validate(parsed.schema, raw);

    if (!outcome.ok) {
      return this.reject(parsed, topic, outcome.code, outcome.message, outcome.errors);
    }

    const payload = outcome.value;

    // El identificador del tópico debe coincidir con el del payload: un módulo
    // no puede publicar eventos en nombre de otro (dosier 23.3).
    const claimedId =
      parsed.kind.startsWith('module') ? (payload as { module_id?: string }).module_id
      : (payload as { system_id?: string }).system_id;
    if (claimedId && claimedId !== parsed.id) {
      return this.reject(
        parsed,
        topic,
        'schema_violation',
        `El identificador del payload ('${claimedId}') no coincide con el del tópico ('${parsed.id}')`,
        [],
      );
    }

    this.publisher?.publish({ type: parsed.kind, topic, payload, at: receivedAt });

    if (parsed.kind === 'module-hit') {
      return this.ingestHit(payload as unknown as HitEventPayload, receivedAt);
    }

    this.metrics.accepted += 1;
    return { status: 'accepted', kind: parsed.kind };
  }

  private async ingestHit(payload: HitEventPayload, receivedAt: Date): Promise<IngestResult> {
    let record = toHitRecord(payload, receivedAt);

    if (record.replay) this.metrics.replayed += 1;

    // Marcar (no corregir) el evento si la persistencia llega tarde.
    record = markIfOutOfWindow(record, new Date(), {
      maxLatencyMs: this.options.maxPersistLatencyMs,
    });
    if (record.outOfWindow) {
      this.metrics.outOfWindow += 1;
      await this.incidents.record({
        kind: 'hit_out_of_window',
        severity: 'warning',
        source: 'ingest',
        moduleSlug: record.moduleSlug,
        eventId: record.eventId,
        message: record.outOfWindowReason ?? 'Evento fuera de ventana',
      });
    }

    const result = await this.hits.insertIfAbsent(record);

    if (!result.inserted) {
      // ADR-0003: los duplicados son parte normal de QoS 1. Métrica, no error.
      this.metrics.duplicates += 1;
      this.logger.debug(
        `Impacto duplicado descartado: event_id=${record.eventId} (por ${result.duplicateBy})`,
      );
      return {
        status: 'duplicate',
        kind: 'module-hit',
        id: result.id,
        eventId: record.eventId,
        duplicateBy: result.duplicateBy,
      };
    }

    this.metrics.accepted += 1;
    return {
      status: 'accepted',
      kind: 'module-hit',
      id: result.id,
      eventId: record.eventId,
      outOfWindow: record.outOfWindow,
    };
  }

  private async reject(
    parsed: ParsedTopic,
    topic: string,
    code: RejectionCode,
    message: string,
    errors: string[],
  ): Promise<IngestResult> {
    this.metrics.rejected += 1;
    this.metrics.byRejectionCode[code] = (this.metrics.byRejectionCode[code] ?? 0) + 1;

    // Contrato §7: una versión de esquema no soportada se registra como incidencia.
    const severity = code === 'schema_version_unsupported' ? 'error' : 'warning';
    await this.incidents.record({
      kind: `ingest_${code}`,
      severity,
      source: 'ingest',
      moduleSlug: parsed.kind.startsWith('module') ? parsed.id : null,
      message: `${message} (tópico ${topic})`,
      detail: { errors },
    });

    this.logger.warn(`Mensaje rechazado en ${topic}: ${code} · ${message}`);
    return { status: 'rejected', kind: parsed.kind, code, message, errors };
  }
}
