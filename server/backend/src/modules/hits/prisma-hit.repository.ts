import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HitClassification, HitRecord } from '../../domain/hits/hit-record';
import { HitRepositoryPort, InsertResult } from './ports';

/**
 * Persistencia de impactos sobre PostgreSQL.
 *
 * La idempotencia se delega a las restricciones de la base de datos
 * (ADR-0003): se intenta insertar y se interpreta la violación de unicidad
 * (`P2002`) como duplicado. Es lo único correcto con varios procesos de
 * ingesta: un `SELECT` previo tendría carrera.
 */
@Injectable()
export class PrismaHitRepository implements HitRepositoryPort {
  private readonly logger = new Logger(PrismaHitRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async insertIfAbsent(record: HitRecord): Promise<InsertResult> {
    try {
      const created = await this.prisma.hitEvent.create({
        data: {
          eventId: record.eventId,
          systemSlug: record.systemSlug,
          moduleSlug: record.moduleSlug,
          targetIndex: record.targetIndex,
          gameId: record.gameId,
          roundId: record.roundId,
          participantId: record.participantId,
          modulePositionX: record.modulePositionX,
          modulePositionY: record.modulePositionY,
          moduleRotation: record.moduleRotation,
          localSequence: record.localSequence,

          deviceBootId: record.deviceBootId,
          deviceUptimeUs: record.deviceUptimeUs,
          deviceEventUs: record.deviceEventUs,
          deviceEpochMs: record.deviceEpochMs,

          coordinatorRecvUs: record.coordinatorRecvUs,
          coordinatorElapsedUs: record.coordinatorElapsedUs,
          clockOffsetUs: record.clockOffsetUs,
          offsetUncertaintyUs: record.offsetUncertaintyUs,

          receivedAt: record.receivedAt,

          amplitude: record.amplitude,
          threshold: record.threshold,
          noiseFloor: record.noiseFloor,
          neighbours: (record.neighbours ?? undefined) as never,
          targetStateBefore: record.targetStateBefore as never,
          classification: record.classification as never,
          classificationReason: record.classificationReason,
          firmwareVersion: record.firmwareVersion,
          replay: record.replay,

          outOfWindow: record.outOfWindow,
          outOfWindowReason: record.outOfWindowReason,
          countsForScore: record.countsForScore,

          rawPayload: record.rawPayload as never,
        },
        select: { id: true },
      });
      return { inserted: true, id: created.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        const byEventId = target.includes('event_id');
        const existing = byEventId
          ? await this.prisma.hitEvent.findUnique({
              where: { eventId: record.eventId },
              select: { id: true },
            })
          : await this.prisma.hitEvent.findUnique({
              where: {
                hit_module_boot_sequence: {
                  moduleSlug: record.moduleSlug,
                  deviceBootId: record.deviceBootId,
                  localSequence: record.localSequence,
                },
              },
              select: { id: true },
            });
        return {
          inserted: false,
          id: existing?.id ?? '',
          duplicateBy: byEventId ? 'event_id' : 'module_boot_sequence',
        };
      }
      throw error;
    }
  }

  async findByEventId(eventId: string): Promise<HitRecord | null> {
    const row = await this.prisma.hitEvent.findUnique({ where: { eventId } });
    if (!row) return null;
    return {
      eventId: row.eventId,
      systemSlug: row.systemSlug,
      moduleSlug: row.moduleSlug,
      targetIndex: row.targetIndex,
      gameId: row.gameId,
      roundId: row.roundId,
      participantId: row.participantId,
      modulePositionX: row.modulePositionX,
      modulePositionY: row.modulePositionY,
      moduleRotation: row.moduleRotation,
      localSequence: row.localSequence,
      deviceBootId: row.deviceBootId,
      deviceUptimeUs: row.deviceUptimeUs,
      deviceEventUs: row.deviceEventUs,
      deviceEpochMs: row.deviceEpochMs,
      coordinatorRecvUs: row.coordinatorRecvUs,
      coordinatorElapsedUs: row.coordinatorElapsedUs,
      clockOffsetUs: row.clockOffsetUs,
      offsetUncertaintyUs: row.offsetUncertaintyUs,
      receivedAt: row.receivedAt,
      amplitude: row.amplitude,
      threshold: row.threshold,
      noiseFloor: row.noiseFloor,
      neighbours: row.neighbours,
      targetStateBefore: row.targetStateBefore,
      classification: row.classification as HitClassification,
      classificationReason: row.classificationReason,
      firmwareVersion: row.firmwareVersion,
      replay: row.replay,
      outOfWindow: row.outOfWindow,
      outOfWindowReason: row.outOfWindowReason,
      countsForScore: row.countsForScore,
      rawPayload: row.rawPayload,
    };
  }

  async countByRound(roundId: string): Promise<number> {
    return this.prisma.hitEvent.count({ where: { roundId } });
  }
}
