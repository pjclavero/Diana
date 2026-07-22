import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Búsqueda de jugadores (G-D). El CRUD genérico no filtra por texto; aquí se busca
 * por nombre visible o por el usuario vinculado (jugador registrado). Devuelve el
 * equipo y, si lo hay, la cuenta de usuario, para distinguir registrado vs plantilla.
 */
@Injectable()
export class PlayersSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string | undefined, take = 100) {
    const term = (q ?? '').trim();
    const where: Prisma.PlayerWhereInput = term
      ? {
          OR: [
            { displayName: { contains: term, mode: 'insensitive' } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { licence: { contains: term, mode: 'insensitive' } },
            { user: { username: { contains: term, mode: 'insensitive' } } },
          ],
        }
      : {};

    const items = await this.prisma.player.findMany({
      where,
      include: {
        team: { select: { id: true, name: true } },
        user: { select: { id: true, username: true } },
      },
      orderBy: { displayName: 'asc' },
      // Guarda contra un take no finito (p. ej. ?take=abc → NaN): cae a 100 (OBS-1).
      take: Math.min(Math.max(Number.isFinite(take) ? take : 100, 1), 500),
    });

    return items.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      firstName: p.firstName,
      lastName: p.lastName,
      licence: p.licence,
      active: p.active,
      teamId: p.teamId,
      team: p.team,
      userId: p.userId,
      user: p.user,
      registered: p.userId !== null,
    }));
  }
}
