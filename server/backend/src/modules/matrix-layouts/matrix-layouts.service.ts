import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';

export interface LayoutActor {
  userId: string;
  username: string;
  role: string;
}

export interface LayoutCell {
  slug: string;
  x: number;
  y: number;
  rotation: number;
}

/** Aplicar una matriz devuelve qué se colocó y qué módulos guardados no están en el panel. */
export interface ApplyResult {
  applied: LayoutCell[];
  /** Módulos de la matriz que no están en este panel: no se colocan. */
  missing: string[];
  /** Módulos del panel que ocupaban una casilla de destino y quedan SIN colocar. */
  displaced: string[];
}

const MAX_LAYOUTS_PER_OWNER = 20;

/** Misma rejilla 3×3 que el editor de paneles: no hay casillas fuera de -1..1. */
const COORD_MIN = -1;
const COORD_MAX = 1;

/**
 * Matrices favoritas (G-H): instantáneas con nombre de la colocación de módulos de
 * un panel, para recuperar configuraciones habituales sin recolocar a mano.
 *
 * Se guardan por SLUG de módulo (no por id) para que una matriz siga siendo
 * aplicable tras sustituir hardware o sobre un panel distinto.
 */
@Injectable()
export class MatrixLayoutsService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(actor: LayoutActor) {
    return actor.role === ROLE.ADMINISTRADOR;
  }

  private assertOwned(layout: { ownerId: string | null }, actor: LayoutActor) {
    if (this.isAdmin(actor)) return;
    if (layout.ownerId !== actor.userId) {
      throw new ForbiddenException('Esa matriz no es tuya');
    }
  }

  private shape(layout: {
    id: string;
    name: string;
    description: string | null;
    ownerId: string | null;
    originSystemId: string | null;
    cells: Prisma.JsonValue;
    favorite: boolean;
    createdAt: Date;
  }) {
    const cells = (Array.isArray(layout.cells) ? layout.cells : []) as unknown as LayoutCell[];
    return {
      id: layout.id,
      name: layout.name,
      description: layout.description,
      ownerId: layout.ownerId,
      originSystemId: layout.originSystemId,
      favorite: layout.favorite,
      cells,
      moduleCount: cells.length,
      createdAt: layout.createdAt,
    };
  }

  async list(actor: LayoutActor) {
    const where: Prisma.MatrixLayoutWhereInput = this.isAdmin(actor)
      ? {}
      : { OR: [{ ownerId: actor.userId }, { ownerId: null }] };
    const layouts = await this.prisma.matrixLayout.findMany({
      where,
      orderBy: [{ favorite: 'desc' }, { name: 'asc' }],
    });
    const ownCount = await this.prisma.matrixLayout.count({ where: { ownerId: actor.userId } });
    return { items: layouts.map((l) => this.shape(l)), ownCount, maxOwn: MAX_LAYOUTS_PER_OWNER };
  }

  private async load(id: string) {
    const layout = await this.prisma.matrixLayout.findUnique({ where: { id } });
    if (!layout) throw new NotFoundException(`Matriz ${id} no encontrada`);
    return layout;
  }

  async get(id: string, actor: LayoutActor) {
    const layout = await this.load(id);
    // Las públicas (sin dueño) las ve cualquiera; las ajenas, no existen para ti.
    if (!this.isAdmin(actor) && layout.ownerId !== null && layout.ownerId !== actor.userId) {
      throw new NotFoundException(`Matriz ${id} no encontrada`);
    }
    return this.shape(layout);
  }

  /** Captura la colocación actual de un panel y la guarda con nombre. */
  async captureFromSystem(
    input: { name: string; description?: string; target_system_id: string; favorite?: boolean },
    actor: LayoutActor,
  ) {
    const system = await this.prisma.targetSystem.findUnique({
      where: { id: input.target_system_id },
    });
    if (!system) throw new BadRequestException('El panel indicado no existe');

    const positions = await this.prisma.modulePosition.findMany({
      where: { targetSystemId: system.id },
      include: { module: { select: { slug: true } } },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
    });
    if (positions.length === 0) {
      throw new BadRequestException('El panel no tiene ningún módulo colocado que guardar');
    }

    const cells: LayoutCell[] = positions.map((p) => ({
      slug: p.module.slug,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
    }));

    return this.create(
      {
        name: input.name,
        description: input.description,
        cells,
        origin_system_id: system.id,
        favorite: input.favorite,
      },
      actor,
    );
  }

  async create(
    input: {
      name: string;
      description?: string;
      cells: LayoutCell[];
      origin_system_id?: string | null;
      favorite?: boolean;
    },
    actor: LayoutActor,
  ) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('La matriz necesita un nombre');
    if (!Array.isArray(input.cells) || input.cells.length === 0) {
      throw new BadRequestException('La matriz necesita al menos una posición');
    }
    for (const cell of input.cells) {
      if (!cell || typeof cell.slug !== 'string' || !cell.slug.trim()) {
        throw new BadRequestException('Cada posición necesita el slug del módulo');
      }
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
        throw new BadRequestException('Las coordenadas x/y deben ser enteras');
      }
      if (cell.x < COORD_MIN || cell.x > COORD_MAX || cell.y < COORD_MIN || cell.y > COORD_MAX) {
        throw new BadRequestException(
          `Coordenada fuera de la rejilla 3×3: (${cell.x}, ${cell.y})`,
        );
      }
    }
    const seen = new Set<string>();
    for (const cell of input.cells) {
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) throw new BadRequestException(`Dos módulos en la misma casilla (${key})`);
      seen.add(key);
    }

    const ownCount = await this.prisma.matrixLayout.count({ where: { ownerId: actor.userId } });
    if (ownCount >= MAX_LAYOUTS_PER_OWNER) {
      throw new BadRequestException(
        `Has alcanzado el máximo de ${MAX_LAYOUTS_PER_OWNER} matrices guardadas. Borra alguna antes.`,
      );
    }

    try {
      const layout = await this.prisma.matrixLayout.create({
        data: {
          name,
          description: input.description ?? null,
          ownerId: this.isAdmin(actor) ? null : actor.userId,
          originSystemId: input.origin_system_id ?? null,
          cells: input.cells.map((c) => ({
            slug: c.slug,
            x: c.x,
            y: c.y,
            rotation: c.rotation ?? 0,
          })) as unknown as Prisma.InputJsonValue,
          favorite: input.favorite ?? false,
          createdBy: actor.username,
        },
      });
      return this.shape(layout);
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async update(
    id: string,
    input: { name?: string; description?: string | null; favorite?: boolean },
    actor: LayoutActor,
  ) {
    const layout = await this.load(id);
    this.assertOwned(layout, actor);
    const data: Prisma.MatrixLayoutUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('La matriz necesita un nombre');
      data.name = name;
    }
    if (input.description !== undefined) data.description = input.description;
    if (input.favorite !== undefined) data.favorite = input.favorite;
    try {
      const updated = await this.prisma.matrixLayout.update({ where: { id }, data });
      return this.shape(updated);
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async remove(id: string, actor: LayoutActor) {
    const layout = await this.load(id);
    this.assertOwned(layout, actor);
    await this.prisma.matrixLayout.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * Aplica una matriz a un panel: recoloca los módulos cuyo slug esté en la matriz.
   * Los módulos guardados que no estén en ese panel se devuelven en `missing`. El
   * módulo que ocupase una casilla de destino queda sin colocar y se devuelve en
   * `displaced`: ningún módulo se borra, pero tampoco se desplaza en silencio.
   */
  async apply(id: string, targetSystemId: string, actor: LayoutActor): Promise<ApplyResult> {
    const layout = await this.get(id, actor);
    const system = await this.prisma.targetSystem.findUnique({ where: { id: targetSystemId } });
    if (!system) throw new BadRequestException('El panel indicado no existe');

    const slugs = layout.cells.map((c) => c.slug);
    const modules = await this.prisma.module.findMany({
      where: { slug: { in: slugs }, targetSystemId: system.id },
      select: { id: true, slug: true },
    });
    const bySlug = new Map(modules.map((m) => [m.slug, m.id]));
    const missing = slugs.filter((s) => !bySlug.has(s));
    const applicable = layout.cells.filter((c) => bySlug.has(c.slug));
    if (applicable.length === 0) {
      throw new BadRequestException(
        'Ninguno de los módulos de esa matriz está en este panel; no hay nada que aplicar.',
      );
    }

    // Quien ocupaba una casilla de destino queda sin colocar: se informa, no se
    // hace en silencio (el módulo NO se borra, sólo pierde su posición).
    const targetModuleIds = new Set(applicable.map((c) => bySlug.get(c.slug)!));
    const occupants = await this.prisma.modulePosition.findMany({
      where: {
        targetSystemId: system.id,
        OR: applicable.map((c) => ({ x: c.x, y: c.y })),
      },
      include: { module: { select: { slug: true } } },
    });
    const displaced = occupants
      .filter((p) => !targetModuleIds.has(p.moduleId))
      .map((p) => p.module.slug);

    // Se borran primero las posiciones implicadas para no chocar con @@unique(system,x,y).
    await this.prisma.$transaction([
      this.prisma.modulePosition.deleteMany({
        where: { targetSystemId: system.id, moduleId: { in: applicable.map((c) => bySlug.get(c.slug)!) } },
      }),
      this.prisma.modulePosition.deleteMany({
        where: {
          targetSystemId: system.id,
          OR: applicable.map((c) => ({ x: c.x, y: c.y })),
        },
      }),
      ...applicable.map((c) =>
        this.prisma.modulePosition.create({
          data: {
            moduleId: bySlug.get(c.slug)!,
            targetSystemId: system.id,
            x: c.x,
            y: c.y,
            rotation: c.rotation ?? 0,
            assignedBy: actor.username,
          },
        }),
      ),
    ]);

    return { applied: applicable, missing, displaced };
  }

  private mapWriteError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return new BadRequestException('Ya tienes una matriz guardada con ese nombre');
      }
      if (error.code === 'P2003') {
        return new BadRequestException('Referencia inválida al guardar la matriz');
      }
    }
    return error as Error;
  }
}
