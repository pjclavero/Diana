import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { attributeHit } from '../../domain/hits/attribution';
import type { HitAttributorPort } from './ports';

/**
 * Resuelve de quién es un impacto consultando el estado real de la ronda
 * (participantes y su panel). La regla vive en el dominio; aquí sólo se leen
 * los datos. Si algo falla, el impacto se guarda SIN atribuir: nunca se
 * adivina y nunca se pierde el impacto.
 */
@Injectable()
export class PrismaHitAttributor implements HitAttributorPort {
  private readonly logger = new Logger(PrismaHitAttributor.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: { gameId: string | null; roundId: string | null; moduleSlug: string }) {
    if (!input.gameId && !input.roundId) {
      return {
        participantId: null,
        basis: 'unknown',
        reason: 'El impacto no pertenece a ninguna partida.',
      };
    }

    try {
      const [module, participants] = await Promise.all([
        this.prisma.module.findUnique({
          where: { slug: input.moduleSlug },
          select: { targetSystemId: true },
        }),
        this.prisma.participant.findMany({
          where: input.roundId
            ? { OR: [{ roundId: input.roundId }, { gameId: input.gameId ?? undefined, roundId: null }] }
            : { gameId: input.gameId ?? undefined },
          select: { id: true, targetSystemId: true, slot: true },
          orderBy: { slot: 'asc' },
        }),
      ]);

      return attributeHit({
        moduleTargetSystemId: module?.targetSystemId ?? null,
        participants,
      });
    } catch (error) {
      this.logger.error(`No se pudo atribuir el impacto: ${(error as Error).message}`);
      return {
        participantId: null,
        basis: 'unknown',
        reason: 'Error al consultar los participantes; el impacto queda sin atribuir.',
      };
    }
  }
}
