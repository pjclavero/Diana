import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';
import { SmtpService } from './smtp.service';

/**
 * Cliente de Prisma dentro de una transacción: el que recibe el callback de
 * `$transaction`. No expone gestión de conexión ni transacciones anidadas.
 */
export type PrismaTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/** Sin I, O, 0 ni 1: el código se dicta por teléfono y se teclea a mano. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
export const ACTIVATION_EXPIRY_HOURS = 24;

export const ACTIVATION_STATUS = {
  pending: 'pending',
  activated: 'activated',
  revoked: 'revoked',
} as const;

/**
 * Ascenso de jugador a gestor por venta de módulo (F5, §3.1).
 *
 * El encargo describe **dos actos distintos**: el admin vincula el módulo (la
 * venta) y el comprador introduce un código para que su acceso de gestor quede
 * activo. Hasta ahora sólo existía el primero: vincular ascendía a gestor en el
 * acto, así que el comprador se encontraba con permisos que nunca había
 * aceptado y el admin no tenía constancia de haberle entregado nada.
 *
 * El envío real de correo depende de configurar SMTP, que hoy no lo está. El
 * flujo NO se bloquea por eso: el código queda registrado y visible para el
 * admin, que puede dictarlo. Lo que no se hace es **afirmar que se ha enviado**
 * cuando no hay relay.
 */
@Injectable()
export class ManagerActivationService {
  private readonly logger = new Logger(ManagerActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smtp: SmtpService,
  ) {}

  private code(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
  }

  private async dispatchNote(email: string | null): Promise<string> {
    if (!email) {
      return 'El usuario no tiene correo: entregue el código en mano y registre a quién.';
    }
    if (await this.smtp.isConfigured()) {
      return `SMTP configurado: correo encolado para ${email} (el envío real lo hace el relay).`;
    }
    return `SMTP sin configurar: NO se ha enviado nada a ${email}; entregue el código a mano.`;
  }

  private expiry(): Date {
    return new Date(Date.now() + ACTIVATION_EXPIRY_HOURS * 3600 * 1000);
  }

  /**
   * Abre el ascenso para un usuario tras venderle un módulo. Idempotente: si ya
   * tiene un código pendiente y vigente se devuelve ese, para no dejar dos
   * credenciales vivas por haber vendido dos módulos.
   */
  async open(
    userId: string,
    moduleId: string | null,
    createdBy?: string,
    /**
     * Cliente de la transacción en curso, si la hay. Vender el módulo y abrir
     * el código son UN SOLO acto: hacerlos por separado permitía que la venta
     * quedara escrita y el código no, dejando al comprador con un módulo que no
     * puede activar. Quien no necesite atomicidad puede seguir llamando sin él.
     */
    tx?: PrismaTx,
  ) {
    const db = tx ?? this.prisma;
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) throw new NotFoundException(`Usuario ${userId} no encontrado`);
    // SÓLO se asciende a un jugador. Antes se abría código a cualquier rol que
    // no fuera admin o gestor (operador, árbitro, consulta, mantenimiento), y
    // al usarlo no ascendía a nadie: se consumía el código, se respondía que ya
    // era gestor y no se podía ni regenerar ni revocar. Callejón sin salida.
    if (user.role.name !== ROLE.JUGADOR) return null;

    const existing = await db.managerActivation.findFirst({
      where: { userId, status: ACTIVATION_STATUS.pending, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const activation = await db.managerActivation.create({
          data: {
            userId,
            moduleId,
            code: this.code(),
            expiresAt: this.expiry(),
            dispatchNote: await this.dispatchNote(user.email),
            lastDispatchAt: new Date(),
            createdBy: createdBy ?? null,
          },
        });
        this.logger.log(`Ascenso a gestor abierto para ${user.username}.`);
        return activation;
      } catch (error) {
        // Sólo la colisión del código único se reintenta. Cualquier otro fallo
        // (BD caída, clave foránea) se propaga: tragarlo lo disfrazaba de
        // «no se pudo generar el código» tras cinco intentos inútiles.
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    throw new BadRequestException('No se pudo generar el código de activación; inténtelo de nuevo.');
  }

  /**
   * El comprador introduce su código y su acceso de gestor queda activo. Sólo
   * puede activarlo **él**: un código ajeno no asciende a nadie.
   */
  async activate(rawCode: string, actor: { userId: string }) {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!code) throw new BadRequestException('Introduzca el código de activación.');

    const activation = await this.prisma.managerActivation.findUnique({
      where: { code },
      include: { user: { include: { role: true } } },
    });
    // Mismo mensaje para «no existe» y «no es tuyo»: un código ajeno no debe
    // poder confirmarse a base de probar.
    if (!activation || activation.userId !== actor.userId) {
      throw new BadRequestException('Código no válido.');
    }
    if (activation.status === ACTIVATION_STATUS.activated) {
      throw new BadRequestException('Ese código ya se usó.');
    }
    if (activation.status === ACTIVATION_STATUS.revoked) {
      throw new BadRequestException('Ese código está revocado. Pida uno nuevo al administrador.');
    }
    if (activation.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('El código ha caducado. Pida al administrador que lo regenere.');
    }

    // Un ascenso sin módulos no tiene sentido: la condición del encargo es
    // POSEER un módulo, no haber recibido un código alguna vez.
    const modules = await this.prisma.module.count({ where: { ownerId: activation.userId } });
    if (modules === 0) {
      throw new BadRequestException(
        'Ya no posee ningún módulo, así que no procede el acceso de gestor.',
      );
    }

    // Si entretanto le cambiaron el rol, el código NO se quema: se rechaza y
    // sigue disponible. Consumirlo dejaba al usuario sin salida.
    const rolActual = activation.user.role.name;
    if (rolActual === ROLE.GESTOR) {
      throw new BadRequestException('Ya tiene acceso de gestor: no hace falta activar nada.');
    }
    if (rolActual !== ROLE.JUGADOR) {
      throw new BadRequestException(
        `Su cuenta tiene el rol '${rolActual}', que no se asciende con este código. ` +
          'Hable con el administrador.',
      );
    }

    const gestorId = await this.roleId(ROLE.GESTOR);
    await this.prisma.$transaction(async (tx) => {
      await tx.managerActivation.update({
        where: { id: activation.id },
        data: { status: ACTIVATION_STATUS.activated, activatedAt: new Date() },
      });
      await tx.user.update({ where: { id: activation.userId }, data: { roleId: gestorId } });
      // Cualquier otro código pendiente suyo deja de valer.
      await tx.managerActivation.updateMany({
        where: { userId: activation.userId, status: ACTIVATION_STATUS.pending },
        data: { status: ACTIVATION_STATUS.revoked },
      });
    });

    return {
      activated: true,
      role: ROLE.GESTOR,
      note: 'Acceso de gestor activo. Vuelva a iniciar sesión para que su sesión lo refleje.',
    };
  }

  /** Regenera el código y reintenta la entrega. Sólo sobre pendientes. */
  async regenerate(id: string, createdBy?: string) {
    const activation = await this.prisma.managerActivation.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!activation) throw new NotFoundException('Activación no encontrada.');
    if (activation.status === ACTIVATION_STATUS.activated) {
      throw new BadRequestException('Esa activación ya se usó: no se regenera.');
    }
    if (activation.status === ACTIVATION_STATUS.revoked) {
      // Resucitar una revocada deshacía la revocación del §3.1.6 por la puerta
      // de atrás. Si hay que volver a ascenderle, se le vuelve a vender.
      throw new BadRequestException(
        'Esa activación está revocada. Vuelva a vincularle un módulo para abrir una nueva.',
      );
    }
    return this.prisma.managerActivation.update({
      where: { id },
      data: {
        code: this.code(),
        status: ACTIVATION_STATUS.pending,
        expiresAt: this.expiry(),
        dispatchNote: await this.dispatchNote(activation.user.email),
        lastDispatchAt: new Date(),
        createdBy: createdBy ?? activation.createdBy,
      },
    });
  }

  async revoke(id: string) {
    const activation = await this.prisma.managerActivation.findUnique({ where: { id } });
    if (!activation) throw new NotFoundException('Activación no encontrada.');
    if (activation.status === ACTIVATION_STATUS.activated) {
      throw new BadRequestException('No se revoca una activación ya usada; desvincule sus módulos.');
    }
    return this.prisma.managerActivation.update({
      where: { id },
      data: { status: ACTIVATION_STATUS.revoked },
    });
  }

  /**
   * Cierra los ascensos pendientes de quien se ha quedado sin módulos (§3.1.6).
   * Un código vivo de alguien que ya no posee nada es una promoción esperando a
   * ocurrir sin motivo.
   */
  async revokePendingFor(userId: string) {
    const { count } = await this.prisma.managerActivation.updateMany({
      where: { userId, status: ACTIVATION_STATUS.pending },
      data: { status: ACTIVATION_STATUS.revoked },
    });
    return count;
  }

  /** Listado para el admin: qué se generó, a quién y si se pudo entregar. */
  async list(status?: string) {
    const items = await this.prisma.managerActivation.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, username: true, email: true, role: { select: { name: true } } } },
        module: { select: { id: true, slug: true, friendlyName: true } },
      },
    });
    const now = Date.now();
    return {
      items: items.map((a) => ({
        ...a,
        // Caducado NO es un estado guardado: se deduce del reloj, así que se
        // dice al leer en vez de dejar «pendiente» a algo que ya no sirve.
        expired: a.status === ACTIVATION_STATUS.pending && a.expiresAt.getTime() <= now,
      })),
      smtpConfigured: await this.smtp.isConfigured(),
    };
  }

  /** Lo que el propio usuario necesita saber: si tiene un ascenso pendiente. */
  async mine(userId: string) {
    const activation = await this.prisma.managerActivation.findFirst({
      where: { userId, status: ACTIVATION_STATUS.pending },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, createdAt: true },
    });
    if (!activation) return { pending: false, expiresAt: null };
    const expired = activation.expiresAt.getTime() <= Date.now();
    return {
      pending: !expired,
      expiresAt: activation.expiresAt,
      // El código NO se devuelve aquí: llega por su correo o se lo dicta el
      // administrador. Exponerlo en una ruta autenticada como suya haría que el
      // segundo factor no fuera factor de nada.
      note: expired
        ? 'Su código ha caducado. Pida al administrador que lo regenere.'
        : 'Tiene un ascenso a gestor pendiente: introduzca el código que le han facilitado.',
    };
  }

  private async roleId(name: string): Promise<string> {
    const role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) throw new BadRequestException(`El rol '${name}' no existe en la base de datos.`);
    return role.id;
  }
}
