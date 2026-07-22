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

  async remove(id: string) {
    const found = await this.prisma.participant.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Participante ${id} no encontrado`);
    await this.prisma.participant.delete({ where: { id } });
    return { id, deleted: true as const };
  }
}
