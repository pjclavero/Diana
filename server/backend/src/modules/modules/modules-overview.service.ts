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
 * Compatibilidad de placa (F3/D3, ya cerrada): la versión candidata es la más
 * reciente firmada **para la placa del módulo**. Si la placa del módulo no
 * consta, no se afirma que haya actualización: se dice que no se puede saber.
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

    // Una candidata por placa: ofrecer firmware de otra placa sería mentir.
    const boards = [...new Set(modules.map((m) => m.targetBoard).filter(Boolean))] as string[];
    const signedByBoard = new Map<string, { version: string; targetBoard: string }>();
    for (const board of boards) {
      const latest = await this.prisma.firmwareVersion.findFirst({
        where: { signed: true, targetBoard: board },
        orderBy: { releasedAt: 'desc' },
        select: { version: true, targetBoard: true },
      });
      if (latest) signedByBoard.set(board, latest);
    }

    const items = modules.map((m) => {
      const latestSigned = m.targetBoard ? (signedByBoard.get(m.targetBoard) ?? null) : null;
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
        targetBoard: m.targetBoard,
        // Sin placa declarada no se puede afirmar ni negar que haya actualización.
        updateUnknownReason: m.targetBoard
          ? null
          : 'No consta la placa del módulo: no se puede saber qué firmware le corresponde.',
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
