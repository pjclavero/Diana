import { randomUUID } from 'crypto';
import { HitRecord } from '../../domain/hits/hit-record';
import { HitRepositoryPort, InsertResult } from './ports';

/**
 * Implementación en memoria del repositorio de impactos.
 *
 * Reproduce las DOS restricciones de unicidad de la base de datos (ADR-0003)
 * para poder ejercitar la idempotencia sin PostgreSQL. No es una
 * implementación de producción.
 */
export class InMemoryHitRepository implements HitRepositoryPort {
  private readonly byEventId = new Map<string, HitRecord & { id: string }>();
  private readonly byTuple = new Map<string, string>();

  private tupleKey(record: HitRecord): string {
    return `${record.moduleSlug}|${record.deviceBootId}|${record.localSequence.toString()}`;
  }

  async insertIfAbsent(record: HitRecord): Promise<InsertResult> {
    const existing = this.byEventId.get(record.eventId);
    if (existing) {
      return { inserted: false, id: existing.id, duplicateBy: 'event_id' };
    }
    const tuple = this.tupleKey(record);
    const tupleOwner = this.byTuple.get(tuple);
    if (tupleOwner) {
      return { inserted: false, id: tupleOwner, duplicateBy: 'module_boot_sequence' };
    }

    const id = randomUUID();
    this.byEventId.set(record.eventId, { ...record, id });
    this.byTuple.set(tuple, id);
    return { inserted: true, id };
  }

  async findByEventId(eventId: string): Promise<HitRecord | null> {
    return this.byEventId.get(eventId) ?? null;
  }

  async countByRound(roundId: string): Promise<number> {
    let count = 0;
    for (const record of this.byEventId.values()) {
      if (record.roundId === roundId) count += 1;
    }
    return count;
  }

  /** Todos los impactos almacenados, en orden de inserción. */
  all(): Array<HitRecord & { id: string }> {
    return [...this.byEventId.values()];
  }

  size(): number {
    return this.byEventId.size;
  }
}
