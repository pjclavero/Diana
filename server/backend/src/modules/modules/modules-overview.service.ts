import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';

export interface OverviewActor {
  userId: string;
  role: string;
}

/**
 * Resumen de módulos para el dashboard (G-C). Devuelve, por módulo, lo justo para
 * el panel: estado, versión de firmware, dueño y si hay **actualización pendiente**
 * (existe una versión firmada más reciente que la que corre). El admin ve todos;
 * un no-admin (gestor) sólo los suyos.
 *
 * Nota: la compatibilidad de placa (`targetBoard` ↔ módulo) se difiere a F5/D3
 * (requiere un campo `Module.targetBoard` explícito). Hasta entonces se usa la
 * última versión firmada global como referencia de «hay algo más nuevo».
 */
@Injectable()
export class ModulesOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: OverviewActor) {
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    const where = isAdmin ? {} : { ownerId: actor.userId };

    const modules = await this.prisma.module.findMany({
      where,
      include: {
        owner: { select: { id: true, username: true, displayName: true, role: { select: { name: true } } } },
        position: true,
      },
      orderBy: { slug: 'asc' },
    });

    const latestSigned = await this.prisma.firmwareVersion.findFirst({
      where: { signed: true },
      orderBy: { releasedAt: 'desc' },
      select: { version: true, targetBoard: true },
    });

    const items = modules.map((m) => {
      const updateAvailable = latestSigned !== null && latestSigned.version !== m.firmwareVersion;
      return {
        id: m.id,
        slug: m.slug,
        friendlyName: m.friendlyName,
        online: m.online,
        state: m.state,
        role: m.role,
        firmwareVersion: m.firmwareVersion,
        maintenance: m.maintenance,
        lastSeenAt: m.lastSeenAt,
        ownerId: m.ownerId,
        owner: m.owner,
        position: m.position ? { x: m.position.x, y: m.position.y } : null,
        updateAvailable,
        latestSignedVersion: latestSigned?.version ?? null,
      };
    });

    return {
      summary: {
        total: items.length,
        online: items.filter((i) => i.online).length,
        offline: items.filter((i) => !i.online).length,
        updatesPending: items.filter((i) => i.updateAvailable).length,
      },
      items,
    };
  }
}
