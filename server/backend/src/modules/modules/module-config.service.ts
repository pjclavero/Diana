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

  /**
   * Compone la configuración deseada a partir del estado real en la base.
   *
   * `configVersion` se pasa DESDE FUERA porque componer no es reservar: quien
   * publica de verdad (`push`) reserva antes la versión de forma atómica y
   * pasa la que le tocó. Antes se calculaba aquí como `configVersion + 1`, y
   * eso significaba que dos empujones concurrentes leían el mismo N y
   * publicaban los dos la N+1 — dos configuraciones DISTINTAS con el mismo
   * número, que es exactamente lo que la versión existe para impedir.
   *
   * Sin `configVersion`, `build` devuelve la SIGUIENTE que se emitiría. Es una
   * vista previa y no escribe nada, así que llamarla no consume número.
   */
  async build(moduleId: string, network?: NetworkConfigInput, configVersion?: number) {
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
      config_version: configVersion ?? module.desiredConfigVersion + 1,
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
   * Publica la configuración deseada (retenida) y sube la versión DESEADA
   * exactamente UNA vez por empujón.
   *
   * ── El orden importa y es este ───────────────────────────────────────────
   *   1. RESERVAR la versión con un incremento atómico (`increment: 1`), y
   *      quedarse con la que devuelve la propia base.
   *   2. Componer y publicar CON esa versión.
   *   3. Anotar el resultado del envío en `config_state`.
   *
   * Antes era al revés: se componía leyendo `configVersion + 1`, se publicaba
   * y sólo después se escribía. Dos empujones a la vez leían el mismo N,
   * publicaban dos configuraciones distintas numeradas N+1 y la base acababa
   * en N+1 tras dos incrementos. Reservar primero hace que cada empujón se
   * lleve un número propio; si algo falla después, ese número queda quemado,
   * que es el lado correcto del error (un hueco en la secuencia no rompe nada,
   * un número repetido sí).
   *
   * Reservar no afirma nada sobre el módulo: `desiredConfigVersion` es lo que
   * el sistema QUIERE. Lo que el módulo tenga se sabe por `config/reported`, y
   * hasta que llegue el estado es `pending` (o `failed` si el broker denegó).
   */
  async push(moduleId: string, network?: NetworkConfigInput) {
    if (network && network.mode === 'static' && !network.ip) {
      throw new BadRequestException('Una configuración de red estática necesita una IP.');
    }

    // Existencia comprobada ANTES de reservar: si el módulo no existe no se
    // quema un número (y `update` sobre un id inexistente lanzaría un error de
    // Prisma que no dice qué pasó).
    const exists = await this.prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Módulo ${moduleId} no encontrado`);

    // (1) Reserva atómica. `increment` lo resuelve PostgreSQL en la fila; dos
    // llamadas simultáneas obtienen números distintos, no el mismo leído dos
    // veces. `configState` vuelve a `pending`: hay una deseada nueva que el
    // módulo no ha confirmado, y eso es cierto desde este instante.
    const reserved = await this.prisma.module.update({
      where: { id: moduleId },
      data: {
        desiredConfigVersion: { increment: 1 },
        configState: 'pending',
        configAppliedAt: null,
      },
      select: { desiredConfigVersion: true },
    });
    const configVersion = reserved.desiredConfigVersion;

    // (2) Publicar CON el número reservado.
    const payload = await this.build(moduleId, network, configVersion);
    const result = await this.mqtt.publishModuleConfig(
      payload.module_id,
      payload as unknown as Record<string, unknown>,
    );

    // (3) Una denegación de ACL es un fallo del empujón, y se deja escrito. El
    // número NO se devuelve: retroceder la deseada la haría no monotónica, y
    // un reintento posterior emitiría dos payloads distintos con el mismo
    // número. El hueco es el precio correcto.
    if (result.denied) {
      await this.prisma.module.update({
        where: { id: moduleId },
        data: { configState: 'failed' },
      });
    }

    return {
      published: payload,
      delivered: result.delivered,
      denied: result.denied,
      desiredConfigVersion: configVersion,
      configState: result.denied ? 'failed' : 'pending',
      note: result.denied
        ? 'ATENCIÓN: el broker DENEGÓ esta publicación (ACL). El módulo NO tiene esta configuración.'
        : 'Configuración deseada publicada. La aplicación real la confirma el módulo en config/reported.',
    };
  }
}
