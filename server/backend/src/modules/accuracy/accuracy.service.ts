import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccuracyResult, AmmoInput, computeAccuracy } from '../../domain/accuracy/accuracy';
import { DETECTED_CLASSIFICATIONS, HitClassification } from '../../domain/hits/hit-record';

export interface RoundAccuracy extends AccuracyResult {
  round_id: string;
  participant_id: string;
}

/**
 * Cálculo de precisión de un participante en una ronda (ADR-0006).
 *
 * Los recuentos salen de los impactos REALMENTE registrados; la munición, del
 * último `shot_count` introducido. Si no hay munición restante conocida, el
 * resultado es `not_computable`: no se estima nada.
 */
@Injectable()
export class AccuracyService {
  constructor(private readonly prisma: PrismaService) {}

  async countHits(roundId: string, participantId: string) {
    const rows = await this.prisma.hitEvent.groupBy({
      by: ['classification'],
      where: { roundId, participantId },
      _count: { _all: true },
    });

    let detected = 0;
    let valid = 0;
    for (const row of rows) {
      const classification = row.classification as HitClassification;
      if (!DETECTED_CLASSIFICATIONS.includes(classification)) continue;
      detected += row._count._all;
      if (classification === 'valid_hit') valid += row._count._all;
    }
    return { detectedHits: detected, validHits: valid, invalidHits: detected - valid };
  }

  async forParticipant(roundId: string, participantId: string): Promise<RoundAccuracy> {
    const participant = await this.prisma.participant.findUnique({ where: { id: participantId } });
    if (!participant) throw new NotFoundException(`Participante ${participantId} no encontrado`);

    const shotCount = await this.prisma.shotCount.findFirst({
      where: { participantId },
      orderBy: { recordedAt: 'desc' },
    });
    const counts = await this.countHits(roundId, participantId);

    const input: AmmoInput = {
      initialAmmo: shotCount?.initialAmmo ?? null,
      remainingAmmo: shotCount?.remainingAmmo ?? null,
      remainingKnown: shotCount?.remainingKnown ?? false,
      mustUseAllAmmo: shotCount?.mustUseAllAmmo ?? false,
      ...counts,
    };

    return { ...computeAccuracy(input), round_id: roundId, participant_id: participantId };
  }

  /** Calcula y PERSISTE el resultado de la ronda para un participante. */
  async persistResult(roundId: string, participantId: string) {
    const accuracy = await this.forParticipant(roundId, participantId);

    const penalties = await this.prisma.penalty.aggregate({
      where: { roundId, participantId },
      _sum: { penaltyMs: true },
      _count: { _all: true },
    });

    // Tiempos: se leen del coordinador (T2). El backend no los recalcula.
    const first = await this.prisma.hitEvent.findFirst({
      where: { roundId, participantId, classification: 'valid_hit' },
      orderBy: { deviceEventUs: 'asc' },
      select: { coordinatorElapsedUs: true },
    });
    const last = await this.prisma.hitEvent.findFirst({
      where: { roundId, participantId, classification: 'valid_hit' },
      orderBy: { deviceEventUs: 'desc' },
      select: { coordinatorElapsedUs: true },
    });

    const data = {
      detectedHits: accuracy.detectedHits,
      validHits: accuracy.validHits,
      invalidHits: accuracy.invalidHits,
      penaltiesCount: penalties._count._all,
      penaltiesMs: penalties._sum.penaltyMs ?? 0,
      initialAmmo: accuracy.initialAmmo,
      remainingAmmo: accuracy.remainingAmmo,
      shotsFired: accuracy.shotsFired,
      accuracyTotal: accuracy.accuracyTotal,
      accuracyValid: accuracy.accuracyValid,
      accuracyStatus: accuracy.accuracyStatus,
      accuracyReason: accuracy.reason,
      firstHitUs: first?.coordinatorElapsedUs ?? null,
      totalTimeUs: last?.coordinatorElapsedUs ?? null,
      score: accuracy.validHits,
      computedAt: new Date(),
    };

    return this.prisma.result.upsert({
      where: { roundId_participantId: { roundId, participantId } },
      create: { roundId, participantId, ...data },
      update: data,
    });
  }

  async persistRound(roundId: string) {
    const participants = await this.prisma.participant.findMany({
      where: { OR: [{ roundId }, { round: { id: roundId } }] },
      select: { id: true },
    });
    const results = [];
    for (const participant of participants) {
      results.push(await this.persistResult(roundId, participant.id));
    }
    return { round_id: roundId, results };
  }
}
