import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface AddParticipantInput {
  gameId: string;
  playerId?: string | null;
  guestName?: string | null;
  teamId?: string | null;
  lane?: string | null;
}

/**
 * Participantes de una partida (G-D.2), incluidos los **temporales** (§3.4).
 *
 * Un participante es EXACTAMENTE una identidad: o un jugador de plantilla/registrado
 * (`playerId`) o un **temporal** (`guestName`, sin `Player` ni `User`). Nunca ambos ni
 * ninguno. El temporal no acumula estadística: al no tener `Player`, ningún `Statistic`
 * (que es por jugador) le aplica — la garantía es estructural. El `slot` se asigna solo.
 */
@Injectable()
export class ParticipantsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    player: { select: { id: true, displayName: true, userId: true } },
    team: { select: { id: true, name: true } },
    targetSystem: { select: { id: true, slug: true, name: true } },
  };

  /** Participantes de una partida (los de la partida, roundId nulo). */
  async listForGame(gameId: string) {
    const items = await this.prisma.participant.findMany({
      where: { gameId, roundId: null },
      include: this.include,
      orderBy: { slot: 'asc' },
    });
    return items.map((p) => ({ ...p, temporary: p.guestName !== null }));
  }

  /** Añade un participante: registrado/plantilla (`playerId`) o temporal (`guestName`). */
  async add(input: AddParticipantInput) {
    const hasPlayer = !!input.playerId;
    const guest = input.guestName?.trim() || null;
    const hasGuest = !!guest;
    if (hasPlayer === hasGuest) {
      throw new BadRequestException('Indica un jugador (playerId) O un nombre temporal (guestName), pero no ambos ni ninguno.');
    }

    const game = await this.prisma.game.findUnique({ where: { id: input.gameId } });
    if (!game) throw new NotFoundException(`Partida ${input.gameId} no encontrada`);

    if (hasPlayer) {
      const player = await this.prisma.player.findUnique({ where: { id: input.playerId! } });
      if (!player) throw new NotFoundException(`Jugador ${input.playerId} no encontrado`);
    }

    // Slot siguiente dentro de la partida (participantes de la partida, roundId nulo).
    // Con `@@unique([gameId, slot, roundId])`, dos altas concurrentes podrían calcular
    // el mismo slot; se reintenta ante la colisión (P2002) recalculando (OBS supervisor).
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await this.prisma.participant.findFirst({
        where: { gameId: input.gameId, roundId: null },
        orderBy: { slot: 'desc' },
        select: { slot: true },
      });
      try {
        return await this.prisma.participant.create({
          data: {
            gameId: input.gameId,
            playerId: hasPlayer ? input.playerId! : null,
            guestName: hasGuest ? guest : null,
            teamId: input.teamId ?? null,
            slot: (last?.slot ?? 0) + 1,
          },
          include: this.include,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    throw new ConflictException('No se pudo asignar un puesto libre; inténtelo de nuevo.');
  }

  /**
   * Asigna el PANEL en el que juega el participante. Es lo que permite atribuir
   * los impactos a un jugador cuando hay varios (duelo sobre una vista): el
   * impacto es de quien juega en el panel del módulo que lo detectó. Dos
   * participantes en el mismo panel dejan de ser atribuibles, y se avisa.
   */
  async setPanel(id: string, targetSystemId: string | null) {
    const found = await this.prisma.participant.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Participante ${id} no encontrado`);

    if (targetSystemId) {
      const system = await this.prisma.targetSystem.findUnique({ where: { id: targetSystemId } });
      if (!system) throw new NotFoundException(`Panel ${targetSystemId} no encontrado`);
    }

    const updated = await this.prisma.participant.update({
      where: { id },
      data: { targetSystemId },
      include: this.include,
    });

    // Aviso honesto: compartir panel no es un error, pero impide atribuir.
    const sharing = targetSystemId
      ? await this.prisma.participant.count({
          where: { gameId: found.gameId, roundId: null, targetSystemId },
        })
      : 0;

    return {
      ...updated,
      attributable: targetSystemId !== null && sharing === 1,
      note:
        sharing > 1
          ? 'Hay más de un participante en este panel: sus impactos no se podrán atribuir a un jugador concreto.'
          : null,
    };
  }

  /** Reasigna (o quita, con null) el equipo de un participante dentro de la partida. */
  async setTeam(id: string, teamId: string | null) {
    const found = await this.prisma.participant.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Participante ${id} no encontrado`);
    if (teamId) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw new NotFoundException(`Equipo ${teamId} no encontrado`);
    }
    return this.prisma.participant.update({ where: { id }, data: { teamId }, include: this.include });
  }

  async remove(id: string) {
    const found = await this.prisma.participant.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Participante ${id} no encontrado`);
    await this.prisma.participant.delete({ where: { id } });
    return { id, deleted: true as const };
  }
}
