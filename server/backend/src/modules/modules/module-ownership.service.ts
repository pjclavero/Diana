import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ManagerActivationService } from '../invitations/manager-activation.service';
import { ROLE } from '../../domain/rbac/permissions';

/**
 * Propiedad de módulos (F2, docs/product/alcance-panel-roles-firmware.md §0.b).
 *
 * Regla de negocio: **un usuario con ≥1 módulo vinculado ejerce de gestor.** Al
 * vincular el primer módulo a un `jugador`, se promociona a `gestor`; al
 * desvincular su último módulo, vuelve a `jugador`. El `administrador` nunca se
 * degrada por perder módulos (su rol no deriva de la propiedad).
 *
 * La propiedad se cambia SÓLO aquí (no por el CRUD), para que la promoción y la
 * autorización sean consistentes. En F5, el canje de un código de vinculación
 * llamará a `link` con `actor === destinatario`.
 */
@Injectable()
export class ModuleOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activations: ManagerActivationService,
  ) {}

  private async roleId(name: string): Promise<string> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name } });
    return role.id;
  }

  /** Módulos cuyo dueño es `userId`. */
  async listOwnedBy(userId: string) {
    return this.prisma.module.findMany({
      where: { ownerId: userId },
      include: {
        owner: { select: { id: true, username: true, displayName: true, role: { select: { name: true } } } },
        position: true,
        targets: true,
      },
      orderBy: { slug: 'asc' },
    });
  }

  /**
   * Vincula un módulo a un usuario. Sólo el admin puede vincular a un tercero;
   * un no-admin sólo puede vincularse el módulo a sí mismo (canje de código).
   */
  async link(moduleId: string, targetUserId: string, actor: { userId: string; role: string }) {
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    if (!isAdmin && targetUserId !== actor.userId) {
      throw new ForbiddenException('Sólo un administrador puede vincular un módulo a otro usuario.');
    }

    const module = await this.prisma.module.findUnique({ where: { id: moduleId } });
    if (!module) throw new NotFoundException(`Módulo ${moduleId} no encontrado`);
    if (module.ownerId) {
      if (module.ownerId === targetUserId) return this.get(moduleId);
      throw new BadRequestException('El módulo ya tiene dueño; desvincúlelo antes de reasignarlo.');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true } });
    if (!target) throw new NotFoundException(`Usuario ${targetUserId} no encontrado`);

    await this.prisma.module.update({ where: { id: moduleId }, data: { ownerId: targetUserId } });

    // VENDER NO ES ASCENDER (F5, §3.1). Antes, vincular convertía al comprador
    // en gestor en el acto: se encontraba con permisos que nunca había aceptado
    // y el admin no tenía constancia de haberle entregado nada. Ahora la venta
    // abre un código de activación; el acceso de gestor queda activo cuando el
    // comprador lo introduce.
    const activation = await this.activations.open(targetUserId, moduleId, actor.userId);

    const linked = await this.get(moduleId);
    return {
      ...linked,
      activation: activation
        ? {
            id: activation.id,
            expires_at: activation.expiresAt,
            dispatch_note: activation.dispatchNote,
            note:
              'El comprador NO es gestor todavía: lo será cuando introduzca su código de ' +
              'activación. Hasta entonces posee el módulo pero no ejerce.',
          }
        : null,
    };
  }

  /**
   * Desvincula un módulo. El admin puede desvincular cualquiera; un gestor sólo
   * los suyos. Si el (ex)dueño se queda sin módulos y era gestor, vuelve a jugador.
   */
  async unlink(moduleId: string, actor: { userId: string; role: string }) {
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    const module = await this.prisma.module.findUnique({ where: { id: moduleId } });
    if (!module) throw new NotFoundException(`Módulo ${moduleId} no encontrado`);
    if (!module.ownerId) return this.get(moduleId);
    if (!isAdmin && module.ownerId !== actor.userId) {
      throw new ForbiddenException('Sólo puede desvincular módulos de los que es dueño.');
    }

    const previousOwnerId = module.ownerId;
    await this.prisma.$transaction(async (tx) => {
      await tx.module.update({ where: { id: moduleId }, data: { ownerId: null } });
      const remaining = await tx.module.count({ where: { ownerId: previousOwnerId } });
      if (remaining === 0) {
        const owner = await tx.user.findUnique({ where: { id: previousOwnerId }, include: { role: true } });
        // Degradación: gestor sin módulos vuelve a jugador. El admin no se toca.
        if (owner && owner.role.name === ROLE.GESTOR) {
          await tx.user.update({ where: { id: previousOwnerId }, data: { roleId: await this.roleId(ROLE.JUGADOR) } });
        }
      }
    });

    // Un código vivo de quien ya no posee nada es una promoción esperando a
    // ocurrir sin motivo: se cierra al quedarse sin módulos (§3.1.6).
    const remaining = await this.prisma.module.count({ where: { ownerId: previousOwnerId } });
    if (remaining === 0) await this.activations.revokePendingFor(previousOwnerId);

    return this.get(moduleId);
  }

  private get(moduleId: string) {
    return this.prisma.module.findUniqueOrThrow({
      where: { id: moduleId },
      include: { owner: { select: { id: true, username: true, displayName: true, role: { select: { name: true } } } }, position: true, targets: true },
    });
  }
}
