import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmtpService } from './smtp.service';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EXPIRY_HOURS = 24;

export interface CreateInvitationInput {
  email: string;
  displayName?: string | null;
  invitedBy?: string | null;
}

/**
 * Invitaciones de jugador por correo (G-D/F5, §3.1/§6.5).
 *
 * Se genera un código con caducidad; al aceptarlo, el invitado pasa a ser un
 * `Player` registrado (se guarda su histórico). El **envío real de correo depende de
 * configurar SMTP**; mientras, el código queda registrado, auditado y **visible en el
 * panel** (regenerable). El "mailer" es honesto: NO afirma haber enviado si no hay relay.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smtp: SmtpService,
  ) {}

  private code(length = 8): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
  }

  /** "Envía" la invitación: con SMTP configurado la deja lista para el relay; sin él,
   *  indica que el código debe entregarse a mano. En ningún caso miente sobre el envío. */
  private async dispatchNote(): Promise<string> {
    if (await this.smtp.isConfigured()) {
      return 'SMTP configurado: correo encolado (el envío real lo hará el relay).';
    }
    return 'SMTP sin configurar: entrega el código al invitado manualmente.';
  }

  async create(input: CreateInvitationInput) {
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('Correo no válido.');
    }
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 3600 * 1000);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const inv = await this.prisma.invitation.create({
          data: {
            email,
            displayName: input.displayName?.trim() || null,
            code: this.code(),
            invitedBy: input.invitedBy ?? null,
            expiresAt,
            dispatchNote: await this.dispatchNote(),
            lastDispatchAt: new Date(),
          },
        });
        this.logger.log(`Invitación creada para ${email} (código ${inv.code}).`);
        return inv;
      } catch {
        // Colisión de código único: reintenta.
      }
    }
    throw new BadRequestException('No se pudo generar la invitación; inténtelo de nuevo.');
  }

  list() {
    return this.prisma.invitation.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  /** Regenera el código y reintenta el "envío" (auditable). Sólo si sigue pendiente. */
  async resend(id: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invitación no encontrada.');
    if (inv.status !== 'pending') throw new BadRequestException('Sólo se puede reenviar una invitación pendiente.');
    return this.prisma.invitation.update({
      where: { id },
      data: {
        code: this.code(),
        expiresAt: new Date(Date.now() + EXPIRY_HOURS * 3600 * 1000),
        dispatchNote: await this.dispatchNote(),
        lastDispatchAt: new Date(),
      },
    });
  }

  async revoke(id: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invitación no encontrada.');
    if (inv.status === 'accepted') throw new BadRequestException('No se puede revocar una invitación ya aceptada.');
    return this.prisma.invitation.update({ where: { id }, data: { status: 'revoked' } });
  }

  /** Info pública de una invitación por su código (para la pantalla de aceptación). */
  async byCode(code: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { code: code.toUpperCase() } });
    if (!inv) throw new NotFoundException('Invitación no encontrada.');
    const expired = inv.expiresAt.getTime() < Date.now();
    return {
      email: inv.email,
      displayName: inv.displayName,
      status: inv.status,
      acceptable: inv.status === 'pending' && !expired,
      expired,
    };
  }

  /**
   * Acepta la invitación: crea un `Player` registrado con el nombre dado (así se
   * guarda su histórico) y marca la invitación como aceptada. Público (el código autoriza).
   */
  async accept(code: string, displayName: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { code: code.toUpperCase() } });
    if (!inv) throw new NotFoundException('Invitación no encontrada.');
    if (inv.status !== 'pending') throw new BadRequestException('Esta invitación ya no es válida.');
    if (inv.expiresAt.getTime() < Date.now()) throw new BadRequestException('Esta invitación ha caducado.');

    const name = displayName.trim();
    if (!name) throw new BadRequestException('Indica tu nombre.');

    return this.prisma.$transaction(async (tx) => {
      const player = await tx.player.create({ data: { displayName: name, notes: `Alta por invitación (${inv.email}).` } });
      await tx.invitation.update({ where: { id: inv.id }, data: { status: 'accepted', acceptedAt: new Date(), playerId: player.id } });
      return { playerId: player.id, displayName: player.displayName };
    });
  }
}
