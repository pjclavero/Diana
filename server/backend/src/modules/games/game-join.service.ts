import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ParticipantsService } from '../participants/participants.service';

/** Estados en los que ya no se admiten nuevas incorporaciones. */
const CLOSED = ['finished', 'aborted'];

/** Alfabeto sin caracteres ambiguos (0/O, 1/I) para códigos legibles. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Unirse a una partida por QR (G-D). Cada partida tiene un código corto único; el
 * QR codifica la URL de unión. Al escanear, un jugador se une como TEMPORAL (por
 * nombre, sin cuenta) — el código actúa de autorización, por eso el alta pública.
 */
@Injectable()
export class GameJoinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly participants: ParticipantsService,
  ) {}

  private code(length = 6): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
  }

  /** Devuelve el código de unión, generándolo si no existe. `regenerate` fuerza uno nuevo. */
  async ensureCode(gameId: string, regenerate = false) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new NotFoundException(`Partida ${gameId} no encontrada`);
    if (game.joinCode && !regenerate) return { id: game.id, joinCode: game.joinCode };

    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = this.code();
      try {
        const updated = await this.prisma.game.update({ where: { id: gameId }, data: { joinCode } });
        return { id: updated.id, joinCode: updated.joinCode };
      } catch {
        // Colisión de código único: reintenta con otro.
      }
    }
    throw new BadRequestException('No se pudo generar un código de unión; inténtelo de nuevo.');
  }

  /** Información pública mínima de una partida por su código (para la pantalla de unión). */
  async byCode(joinCode: string) {
    const game = await this.prisma.game.findUnique({
      where: { joinCode: joinCode.toUpperCase() },
      select: { id: true, name: true, status: true, gameMode: { select: { key: true, name: true } } },
    });
    if (!game) throw new NotFoundException('Partida no encontrada para ese código.');
    return { ...game, joinable: !CLOSED.includes(game.status) };
  }

  /** Alta de un jugador TEMPORAL vía código de unión (público; el código autoriza). */
  async joinAsGuest(joinCode: string, guestName: string) {
    const game = await this.prisma.game.findUnique({ where: { joinCode: joinCode.toUpperCase() } });
    if (!game) throw new NotFoundException('Partida no encontrada para ese código.');
    if (CLOSED.includes(game.status)) {
      throw new BadRequestException('Esta partida ya no admite nuevas incorporaciones.');
    }
    const participant = await this.participants.add({ gameId: game.id, guestName });
    return { gameId: game.id, participantId: participant.id, name: participant.guestName };
  }
}
