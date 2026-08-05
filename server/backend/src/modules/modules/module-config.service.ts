import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MqttService } from '../mqtt/mqtt.service';

export interface NetworkConfigInput {
  mode: 'dhcp' | 'static';
  ip?: string | null;
  netmask?: string | null;
  gateway?: string | null;
}

/**
 * Configuración deseada de un módulo (`module/{id}/config/desired`, retenida).
 *
 * Cierra la DECISIÓN 1 de §6.7 por el lado del backend: permite fijar EN REMOTO
 * a qué principal debe seguir un satélite (`coordinator_module_id`), que es lo
 * que resuelve el caso de dos principales en la misma red sin depender de la
 * autoelección AUTO. La aplicación real de esta configuración depende del
 * firmware (ESP-IDF), que sigue pendiente: aquí se publica el deseo, no se
 * afirma que el módulo lo haya aplicado.
 *
 * DECISIÓN 2: si nadie ha fijado red, se envía `dhcp`.
 */
@Injectable()
export class ModuleConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
  ) {}

  /** Compone la configuración deseada a partir del estado real en la base. */
  async build(moduleId: string, network?: NetworkConfigInput) {
    const module = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        position: true,
        targetSystem: {
          select: {
            slug: true,
            coordinatorModuleId: true,
          },
        },
        targets: {
          orderBy: { targetIndex: 'asc' },
          include: { calibrations: { orderBy: { calibratedAt: 'desc' }, take: 1 } },
        },
      },
    });
    if (!module) throw new NotFoundException(`Módulo ${moduleId} no encontrado`);

    // El coordinador se identifica por SLUG en el contrato, no por UUID.
    let coordinatorSlug: string | null = null;
    if (module.targetSystem?.coordinatorModuleId) {
      const coordinator = await this.prisma.module.findUnique({
        where: { id: module.targetSystem.coordinatorModuleId },
        select: { slug: true },
      });
      coordinatorSlug = coordinator?.slug ?? null;
    }

    const calibration = module.targets
      .filter((t) => t.calibrations.length > 0)
      .map((t) => {
        const c = t.calibrations[0];
        return {
          target_index: t.targetIndex,
          threshold: c.threshold,
          hysteresis: c.hysteresis,
          noise_floor: c.noiseFloor,
          blanking_us: c.blankingUs,
          group_window_us: c.groupWindowUs,
          neighbour_ratio: c.neighbourRatio,
          enabled: c.enabled,
          calibrated_at: c.calibratedAt.toISOString(),
        };
      });

    return {
      schema_version: 1,
      module_id: module.slug,
      config_version: module.configVersion + 1,
      system_id: module.targetSystem?.slug ?? null,
      // Un satélite sigue al principal que se le indique; null = decide él (AUTO).
      coordinator_module_id: coordinatorSlug === module.slug ? null : coordinatorSlug,
      position: module.position ? { x: module.position.x, y: module.position.y } : null,
      rotation: module.position?.rotation ?? 0,
      friendly_name: module.friendlyName,
      led_brightness_max: 120,
      telemetry_interval_ms: 1000,
      // DECISIÓN 2: DHCP salvo que el operador fije una IP.
      network: {
        mode: network?.mode ?? 'dhcp',
        ip: network?.ip ?? null,
        netmask: network?.netmask ?? null,
        gateway: network?.gateway ?? null,
      },
      calibration,
    };
  }

  /**
   * Publica la configuración deseada (retenida) y sube `configVersion`.
   * Devuelve lo publicado: el módulo puede tardar en aplicarla o no aplicarla,
   * y eso se sabrá por `config/reported`, no por esta llamada.
   */
  async push(moduleId: string, network?: NetworkConfigInput) {
    if (network && network.mode === 'static' && !network.ip) {
      throw new BadRequestException('Una configuración de red estática necesita una IP.');
    }
    const payload = await this.build(moduleId, network);
    const result = await this.mqtt.publishModuleConfig(
      payload.module_id,
      payload as unknown as Record<string, unknown>,
    );
    await this.prisma.module.update({
      where: { id: moduleId },
      data: { configVersion: payload.config_version },
    });
    return {
      published: payload,
      delivered: result.delivered,
      denied: result.denied,
      note: result.denied
        ? 'ATENCIÓN: el broker DENEGÓ esta publicación (ACL). El módulo NO tiene esta configuración.'
        : 'Configuración deseada publicada. La aplicación real la confirma el módulo en config/reported.',
    };
  }
}
