import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';

export interface PanelActor {
  userId: string;
  username: string;
  role: string;
}

export interface PanelSlotInput {
  module_id: string | null;
  x: number;
  y: number;
  rotation?: number;
}

const COORD_MIN = -1;
const COORD_MAX = 1;

/**
 * Matriz REAL de un panel (cierra el hallazgo X-21: el editor dejaba de leer
 * datos simulados). Un panel es un `TargetSystem` con hasta 9 módulos colocados
 * en una rejilla 3×3 de coordenadas -1..1.
 */
@Injectable()
export class TopologyPanelsService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(actor: PanelActor) {
    return actor.role === ROLE.ADMINISTRADOR;
  }

  /**
   * Acotado por propiedad (deuda D9 del supervisor de G-H). Un panel no tiene
   * dueño propio en el modelo, pero los MÓDULOS sí (`Module.ownerId`, que se
   * asigna al vincular): un gestor gestiona los paneles donde hay módulos suyos.
   * El admin, todos. Mismo criterio que el dashboard de módulos (G-C).
   */
  private scopeFor(actor: PanelActor) {
    return this.isAdmin(actor) ? {} : { modules: { some: { ownerId: actor.userId } } };
  }

  /** Paneles disponibles para el selector del editor. */
  async listPanels(actor: PanelActor) {
    const systems = await this.prisma.targetSystem.findMany({
      where: this.scopeFor(actor),
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        modulesExpected: true,
        _count: { select: { modules: true, positions: true } },
      },
    });
    const items = systems.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      modulesExpected: s.modulesExpected,
      moduleCount: s._count.modules,
      placedCount: s._count.positions,
    }));
    return { items, total: items.length };
  }

  private async loadSystem(idOrSlug: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const system = isUuid
      ? await this.prisma.targetSystem.findUnique({ where: { id: idOrSlug } })
      : await this.prisma.targetSystem.findUnique({ where: { slug: idOrSlug } });
    if (!system) throw new NotFoundException(`Panel ${idOrSlug} no encontrado`);
    return system;
  }

  /** Un panel ajeno no existe para ti: no se filtra ni su nombre. */
  private async assertVisible(systemId: string, actor: PanelActor, idOrSlug: string) {
    if (this.isAdmin(actor)) return;
    const mine = await this.prisma.module.count({
      where: { targetSystemId: systemId, ownerId: actor.userId },
    });
    if (mine === 0) throw new NotFoundException(`Panel ${idOrSlug} no encontrado`);
  }

  /** Matriz del panel + módulos del panel aún sin colocar. */
  async getPanel(idOrSlug: string, actor: PanelActor) {
    const system = await this.loadSystem(idOrSlug);
    await this.assertVisible(system.id, actor, idOrSlug);
    const [positions, modules] = await Promise.all([
      this.prisma.modulePosition.findMany({
        where: { targetSystemId: system.id },
        include: { module: { select: { id: true, slug: true, friendlyName: true, online: true } } },
        orderBy: [{ y: 'asc' }, { x: 'asc' }],
      }),
      this.prisma.module.findMany({
        where: { targetSystemId: system.id },
        select: { id: true, slug: true, friendlyName: true, online: true },
        orderBy: { slug: 'asc' },
      }),
    ]);
    const placed = new Set(positions.map((p) => p.moduleId));
    return {
      system: { id: system.id, slug: system.slug, name: system.name },
      slots: positions.map((p) => ({
        module_id: p.moduleId,
        slug: p.module.slug,
        name: p.module.friendlyName,
        online: p.module.online,
        x: p.x,
        y: p.y,
        rotation: p.rotation,
      })),
      unassigned: modules.filter((m) => !placed.has(m.id)),
    };
  }

  /**
   * Sustituye la matriz del panel por la recibida. Es un reemplazo completo:
   * lo que no venga en `slots` queda sin colocar (el módulo NO se borra).
   */
  async savePanel(idOrSlug: string, slots: PanelSlotInput[], actor: PanelActor) {
    const system = await this.loadSystem(idOrSlug);
    await this.assertVisible(system.id, actor, idOrSlug);
    const filled = slots.filter((s) => s.module_id);

    const seenCell = new Set<string>();
    const seenModule = new Set<string>();
    for (const slot of filled) {
      if (
        !Number.isInteger(slot.x) ||
        !Number.isInteger(slot.y) ||
        slot.x < COORD_MIN ||
        slot.x > COORD_MAX ||
        slot.y < COORD_MIN ||
        slot.y > COORD_MAX
      ) {
        throw new BadRequestException(`Coordenada fuera de la rejilla 3×3: (${slot.x}, ${slot.y})`);
      }
      const cell = `${slot.x},${slot.y}`;
      if (seenCell.has(cell)) {
        throw new BadRequestException(`Dos módulos en la misma casilla (${cell})`);
      }
      seenCell.add(cell);
      if (seenModule.has(slot.module_id!)) {
        throw new BadRequestException(`El módulo ${slot.module_id} aparece dos veces en la matriz`);
      }
      seenModule.add(slot.module_id!);
    }

    const owned = await this.prisma.module.findMany({
      where: { id: { in: [...seenModule] } },
      select: { id: true, targetSystemId: true, ownerId: true },
    });
    const byId = new Map(owned.map((m) => [m.id, m]));
    for (const id of seenModule) {
      const module = byId.get(id);
      if (!module) throw new BadRequestException(`El módulo ${id} no existe`);
      if (module.targetSystemId !== system.id) {
        throw new BadRequestException(`El módulo ${id} no pertenece a este panel`);
      }
      // Un gestor no recoloca módulos ajenos, aunque compartan panel.
      if (!this.isAdmin(actor) && module.ownerId !== actor.userId) {
        throw new ForbiddenException(`El módulo ${id} no es suyo`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.modulePosition.deleteMany({ where: { targetSystemId: system.id } }),
      ...filled.map((slot) =>
        this.prisma.modulePosition.create({
          data: {
            moduleId: slot.module_id!,
            targetSystemId: system.id,
            x: slot.x,
            y: slot.y,
            rotation: slot.rotation ?? 0,
            assignedBy: actor.username ?? null,
          },
        }),
      ),
    ]);

    return this.getPanel(system.id, actor);
  }
}
