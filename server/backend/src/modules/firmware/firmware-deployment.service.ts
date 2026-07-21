import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ROLE } from '../../domain/rbac/permissions';
import { MqttService } from '../mqtt/mqtt.service';

/** Estados de un despliegue que aún no ha terminado (bloquean uno nuevo). */
const IN_FLIGHT = ['pending', 'sent', 'downloading', 'installing'] as const;

export interface Actor {
  userId: string;
  username: string;
  role: string;
}

/**
 * Firmware / OTA (F3, docs/product/alcance-panel-roles-firmware.md §3.3).
 *
 * La **subida** de versiones de firmware es del CRUD `POST /api/firmware`
 * (permiso `firmware:write`, sólo admin). Aquí vive la parte de negocio:
 *   1. Un **gestor** ve qué versiones firmadas hay disponibles para SU módulo.
 *   2. La **acepta** → se crea un `Deployment` y se dispara la OTA remota real
 *      (`MqttService.sendOtaCommand`, que valida contra el esquema y exige firma).
 *   3. El panel consulta el historial de despliegues y la versión vigente.
 *
 * Autorización: el admin actúa sobre cualquier módulo; un no-admin (gestor) sólo
 * sobre los módulos de los que es dueño (`ownerId`), igual que en la propiedad (F2).
 */
@Injectable()
export class FirmwareDeploymentService {
  private readonly logger = new Logger(FirmwareDeploymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
  ) {}

  /** Carga el módulo y comprueba que el actor puede operarlo. */
  private async authorizeModule(moduleId: string, actor: Actor) {
    const module = await this.prisma.module.findUnique({ where: { id: moduleId } });
    if (!module) throw new NotFoundException(`Módulo ${moduleId} no encontrado`);
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    if (!isAdmin && module.ownerId !== actor.userId) {
      throw new ForbiddenException('Sólo puede operar el firmware de los módulos de los que es dueño.');
    }
    return module;
  }

  /**
   * Versiones firmadas disponibles para un módulo, marcando la que corre ahora.
   * Sólo se ofrecen versiones **firmadas** (sin firma no hay OTA, dosier 23.3).
   */
  async availableForModule(moduleId: string, actor: Actor) {
    const module = await this.authorizeModule(moduleId, actor);
    const current = module.firmwareVersion ?? null;

    const versions = await this.prisma.firmwareVersion.findMany({
      where: { signed: true },
      orderBy: { releasedAt: 'desc' },
    });

    const inFlight = await this.prisma.deployment.findFirst({
      where: { moduleId, status: { in: [...IN_FLIGHT] } },
      orderBy: { startedAt: 'desc' },
    });

    return {
      module: { id: module.id, slug: module.slug, friendlyName: module.friendlyName },
      current_version: current,
      deployment_in_progress: inFlight
        ? { id: inFlight.id, status: inFlight.status, firmwareVersionId: inFlight.firmwareVersionId }
        : null,
      available: versions.map((v) => ({
        id: v.id,
        version: v.version,
        targetBoard: v.targetBoard,
        sha256: v.sha256,
        sizeBytes: v.sizeBytes,
        signed: v.signed,
        releasedAt: v.releasedAt,
        notes: v.notes,
        is_current: current !== null && v.version === current,
      })),
    };
  }

  /**
   * El gestor/admin **acepta** una versión para su módulo: crea el `Deployment`
   * y dispara la OTA real. Registra el intento aunque el envío falle (auditoría).
   */
  async deploy(moduleId: string, firmwareVersionId: string, actor: Actor) {
    const module = await this.authorizeModule(moduleId, actor);

    const firmware = await this.prisma.firmwareVersion.findUnique({ where: { id: firmwareVersionId } });
    if (!firmware) throw new NotFoundException(`Versión de firmware ${firmwareVersionId} no encontrada`);

    // Sin firma no sale una OTA (dosier 23.3): se rechaza antes de tocar la BD.
    if (!firmware.signed || !firmware.signature) {
      throw new BadRequestException('La versión de firmware no está firmada; una OTA sin firma está prohibida.');
    }
    if (module.firmwareVersion && module.firmwareVersion === firmware.version) {
      throw new BadRequestException(`El módulo ya corre la versión ${firmware.version}.`);
    }

    const inFlight = await this.prisma.deployment.findFirst({
      where: { moduleId, status: { in: [...IN_FLIGHT] } },
    });
    if (inFlight) {
      throw new ConflictException(
        `El módulo ya tiene un despliegue en curso (${inFlight.status}); espere a que termine o cancélelo.`,
      );
    }

    const deployment = await this.prisma.deployment.create({
      data: {
        firmwareVersionId: firmware.id,
        moduleId: module.id,
        status: 'pending',
        previousVersion: module.firmwareVersion ?? null,
        requestedBy: actor.username,
      },
    });

    // El identificador MQTT del módulo es su `slug` (tópico), no el UUID interno.
    const firmwareBlock: Record<string, unknown> = {
      version: firmware.version,
      url: firmware.url,
      size_bytes: firmware.sizeBytes,
      sha256: firmware.sha256,
      signature: firmware.signature,
      target_board: firmware.targetBoard,
    };

    try {
      const command = this.mqtt.sendOtaCommand(module.slug, 'update', firmwareBlock);
      return this.prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: 'sent', commandId: String(command.command_id) },
        include: { firmwareVersion: true },
      });
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      this.logger.error(`OTA de ${module.slug} → ${firmware.version} falló al publicar: ${message}`);
      await this.prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
      throw new BadRequestException(`No se pudo emitir la orden OTA: ${message}`);
    }
  }

  /** Historial de despliegues de un módulo (más recientes primero). */
  async listDeployments(moduleId: string, actor: Actor) {
    await this.authorizeModule(moduleId, actor);
    return this.prisma.deployment.findMany({
      where: { moduleId },
      include: { firmwareVersion: { select: { version: true, targetBoard: true, sha256: true } } },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }
}
