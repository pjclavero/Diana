import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';

export interface PresetActor {
  userId: string;
  username: string;
  role: string;
}

export interface PresetInput {
  name: string;
  description?: string | null;
  /** Clave del modo de juego (p. ej. 'random'), como en la creación de partidas. */
  mode: string;
  config: unknown;
}

/** Tope de presets propios por gestor (G-F, §6.6). Los de muestra no cuentan. */
export const MAX_PRESETS_PER_OWNER = 5;

/**
 * Presets de partida con propiedad por gestor (G-F).
 *
 * - Un **gestor** tiene sus propios presets (máx. {@link MAX_PRESETS_PER_OWNER})
 *   y ve además los de **muestra** (`isSample`, sin dueño). Nombre único por dueño.
 * - El **admin** ve y gestiona todos y crea/edita los de muestra.
 * La propiedad y el límite se aplican aquí, no en un CRUD genérico.
 */
@Injectable()
export class PresetsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    gameMode: { select: { key: true, displayName: true } },
    owner: { select: { id: true, username: true, displayName: true } },
  };

  /** Presets visibles para el actor: admin todos; gestor, los suyos + los de muestra. */
  async list(actor: PresetActor) {
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    const where: Prisma.GamePresetWhereInput = isAdmin
      ? {}
      : { OR: [{ ownerId: actor.userId }, { isSample: true }] };
    const items = await this.prisma.gamePreset.findMany({ where, include: this.include, orderBy: [{ isSample: 'desc' }, { name: 'asc' }] });
    const ownCount = await this.prisma.gamePreset.count({ where: { ownerId: actor.userId } });
    return { items, ownCount, maxOwn: MAX_PRESETS_PER_OWNER };
  }

  private async loadVisible(id: string, actor: PresetActor) {
    const preset = await this.prisma.gamePreset.findUnique({ where: { id }, include: this.include });
    if (!preset) throw new NotFoundException(`Preset ${id} no encontrado`);
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    if (!isAdmin && preset.ownerId !== actor.userId && !preset.isSample) {
      throw new NotFoundException(`Preset ${id} no encontrado`);
    }
    return preset;
  }

  get(id: string, actor: PresetActor) {
    return this.loadVisible(id, actor);
  }

  /** Crea un preset. Gestor → propio (con límite); admin → de muestra del sistema. */
  async create(input: PresetInput, actor: PresetActor) {
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    const ownerId = isAdmin ? null : actor.userId;

    if (!isAdmin) {
      const count = await this.prisma.gamePreset.count({ where: { ownerId: actor.userId } });
      if (count >= MAX_PRESETS_PER_OWNER) {
        throw new BadRequestException(`Has alcanzado el máximo de ${MAX_PRESETS_PER_OWNER} presets. Borra uno para crear otro.`);
      }
    }

    const mode = await this.prisma.gameMode.findUnique({ where: { key: input.mode } });
    if (!mode) throw new BadRequestException(`El modo de juego '${input.mode}' no existe.`);

    try {
      return await this.prisma.gamePreset.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          gameModeId: mode.id,
          config: input.config as Prisma.InputJsonValue,
          isSample: isAdmin,
          ownerId,
          createdBy: actor.username,
        },
        include: this.include,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(`Ya tienes un preset llamado «${input.name}».`);
      }
      throw error;
    }
  }

  /** Edita un preset. Un no-admin sólo los suyos (nunca los de muestra). */
  async update(id: string, input: Partial<PresetInput>, actor: PresetActor) {
    const preset = await this.loadVisible(id, actor);
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    if (!isAdmin && preset.ownerId !== actor.userId) {
      throw new ForbiddenException('Sólo puedes editar tus propios presets.');
    }
    let gameModeId: string | undefined;
    if (input.mode) {
      const mode = await this.prisma.gameMode.findUnique({ where: { key: input.mode } });
      if (!mode) throw new BadRequestException(`El modo de juego '${input.mode}' no existe.`);
      gameModeId = mode.id;
    }
    try {
      return await this.prisma.gamePreset.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          gameModeId,
          config: input.config === undefined ? undefined : (input.config as Prisma.InputJsonValue),
        },
        include: this.include,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(`Ya tienes un preset llamado «${input.name}».`);
      }
      throw error;
    }
  }

  /** Borra un preset. Un no-admin sólo los suyos. */
  async remove(id: string, actor: PresetActor) {
    const preset = await this.loadVisible(id, actor);
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    if (!isAdmin && preset.ownerId !== actor.userId) {
      throw new ForbiddenException('Sólo puedes borrar tus propios presets.');
    }
    await this.prisma.gamePreset.delete({ where: { id } });
    return { id, deleted: true as const };
  }
}
