import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';
import { assertEqualSetup } from '../../domain/game/duelo';

export interface ViewActor {
  userId: string;
  username: string;
  role: string;
}

/**
 * Vistas (G-H, Opción B): agrupan PANELES (`TargetSystem`) para jugar sobre varios a
 * la vez. Es el nivel por encima del panel. Un gestor gestiona sus vistas; el admin
 * todas. Aquí se **cablea el control de "mismos elementos" del duelo** (`assertEqualSetup`).
 */
@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly panelInclude = {
    panels: {
      orderBy: { position: 'asc' as const },
      include: { targetSystem: { select: { id: true, slug: true, name: true, _count: { select: { modules: true } } } } },
    },
    owner: { select: { id: true, username: true } },
  };

  private shape(view: any) {
    return {
      id: view.id,
      name: view.name,
      description: view.description,
      ownerId: view.ownerId,
      owner: view.owner,
      panels: view.panels.map((p: any) => ({
        targetSystemId: p.targetSystem.id,
        slug: p.targetSystem.slug,
        name: p.targetSystem.name,
        position: p.position,
        moduleCount: p.targetSystem._count.modules,
      })),
    };
  }

  private isAdmin(actor: ViewActor) {
    return actor.role === ROLE.ADMINISTRADOR;
  }

  async list(actor: ViewActor) {
    const where: Prisma.ViewWhereInput = this.isAdmin(actor) ? {} : { OR: [{ ownerId: actor.userId }, { ownerId: null }] };
    const views = await this.prisma.view.findMany({ where, include: this.panelInclude, orderBy: { name: 'asc' } });
    return views.map((v) => this.shape(v));
  }

  private async load(id: string) {
    const view = await this.prisma.view.findUnique({ where: { id }, include: this.panelInclude });
    if (!view) throw new NotFoundException(`Vista ${id} no encontrada`);
    return view;
  }

  async get(id: string) {
    return this.shape(await this.load(id));
  }

  private assertOwner(view: { ownerId: string | null }, actor: ViewActor) {
    if (!this.isAdmin(actor) && view.ownerId !== actor.userId) {
      throw new ForbiddenException('Sólo puedes gestionar tus propias vistas.');
    }
  }

  async create(input: { name: string; description?: string | null }, actor: ViewActor) {
    try {
      const view = await this.prisma.view.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          ownerId: this.isAdmin(actor) ? null : actor.userId,
          createdBy: actor.username,
        },
        include: this.panelInclude,
      });
      return this.shape(view);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(`Ya existe una vista llamada «${input.name}».`);
      }
      throw error;
    }
  }

  async remove(id: string, actor: ViewActor) {
    const view = await this.load(id);
    this.assertOwner(view, actor);
    await this.prisma.view.delete({ where: { id } });
    return { id, deleted: true as const };
  }

  /** Añade un panel a la vista (al final). Idempotente si ya está. */
  async addPanel(id: string, targetSystemId: string, actor: ViewActor) {
    const view = await this.load(id);
    this.assertOwner(view, actor);
    const system = await this.prisma.targetSystem.findUnique({ where: { id: targetSystemId } });
    if (!system) throw new NotFoundException(`Panel ${targetSystemId} no encontrado`);

    const existing = view.panels.find((p) => p.targetSystemId === targetSystemId);
    if (!existing) {
      const position = view.panels.length;
      await this.prisma.viewPanel.create({ data: { viewId: id, targetSystemId, position } });
    }
    return this.get(id);
  }

  async removePanel(id: string, targetSystemId: string, actor: ViewActor) {
    const view = await this.load(id);
    this.assertOwner(view, actor);
    await this.prisma.viewPanel.deleteMany({ where: { viewId: id, targetSystemId } });
    return this.get(id);
  }

  /**
   * ¿La vista sirve para un DUELO? Todos los paneles deben tener el MISMO número de
   * módulos (mismos elementos por jugador). Cablea `assertEqualSetup` (§6.2/G-E).
   */
  async dueloReadiness(id: string) {
    const view = this.shape(await this.load(id));
    const counts = view.panels.map((p: { moduleCount: number }) => p.moduleCount);
    try {
      assertEqualSetup(counts);
      return { ready: true, reason: null, panels: view.panels };
    } catch (e) {
      return { ready: false, reason: (e as Error).message, panels: view.panels };
    }
  }
}
