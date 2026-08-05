import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE } from '../../domain/rbac/permissions';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MqttService } from '../mqtt/mqtt.service';

/**
 * Estados de diana que admite el contrato (`common.schema.json#targetState`).
 *
 * NO es una lista inventada: el contrato manda. La primera versión de esto se
 * sacó de la manga unos «patrones» (`solid`, `blink`, `chase`) que el esquema
 * de comandos no admite, así que `led_test` reventaba en la validación de
 * salida y ninguna prueba de LED podía llegar al módulo. El panel, que ya
 * mandaba `TargetState`, tenía razón desde el principio.
 */
export const TARGET_STATES = [
  'off',
  'safe',
  'active',
  'hit',
  'countdown',
  'penalty',
  'error',
  'calibration',
  'locked',
  'sensor_error',
  'maintenance',
  'disabled',
] as const;
export type TargetStateName = (typeof TARGET_STATES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DiagnosticsActor {
  userId?: string;
  role?: string;
}

/**
 * Diagnóstico de módulo y diana (F6).
 *
 * Una advertencia que atraviesa todo este servicio: **ordenar una prueba no es
 * conocer su resultado**. Los comandos viajan por MQTT y el módulo responde
 * cuando puede, por `module/{id}/diagnostic`. Aquí se devuelve el comando
 * emitido y si el broker lo aceptó —nada más—. El panel esperaba de este
 * servicio un `{ok, amplitude}` inmediato; devolver eso obligaría a inventar una
 * medida que nadie ha tomado, así que se devuelve el encargo y el resultado se
 * consulta aparte.
 */
@Injectable()
export class ModuleDiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
  ) {}

  /** Comprueba que el módulo existe y que el actor puede tocarlo. */
  private async resolve(idOrSlug: string, actor: DiagnosticsActor) {
    const module = UUID.test(idOrSlug)
      ? await this.prisma.module.findUnique({ where: { id: idOrSlug } })
      : await this.prisma.module.findUnique({ where: { slug: idOrSlug } });
    if (!module) throw new NotFoundException(`Módulo ${idOrSlug} no encontrado`);
    const isAdmin = actor.role === ROLE.ADMINISTRADOR;
    // Un gestor sólo diagnostica lo suyo. Encender los LED o disparar una
    // calibración en un módulo ajeno se nota en la sala de al lado.
    if (!isAdmin && module.ownerId && module.ownerId !== actor.userId) {
      throw new NotFoundException(`Módulo ${idOrSlug} no encontrado`);
    }
    return module;
  }

  private async resolveTarget(moduleId: string, targetIndex: number) {
    if (!Number.isInteger(targetIndex) || targetIndex < 1 || targetIndex > 9) {
      throw new BadRequestException('El índice de diana debe estar entre 1 y 9.');
    }
    const target = await this.prisma.target.findFirst({
      where: { moduleId, targetIndex },
      select: { id: true, targetIndex: true, enabled: true },
    });
    if (!target) throw new NotFoundException(`El módulo no tiene la diana ${targetIndex}`);
    return target;
  }

  /** Ordena identificarse (parpadeo) para localizar el módulo físicamente. */
  async identify(idOrSlug: string, durationMs: number, actor: DiagnosticsActor) {
    const module = await this.resolve(idOrSlug, actor);
    if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > 60_000) {
      throw new BadRequestException('La duración debe estar entre 500 y 60000 ms.');
    }
    return this.dispatch(module.slug, 'identify', { duration_ms: durationMs });
  }

  /**
   * Prueba de LED de una diana. Los parámetros van como los define el contrato
   * (`targets: [{target_index, state}]`), no como a uno le venga bien: el
   * validador de salida rechaza cualquier campo que el esquema no contemple.
   */
  async testLed(idOrSlug: string, targetIndex: number, state: string, actor: DiagnosticsActor) {
    const module = await this.resolve(idOrSlug, actor);
    await this.resolveTarget(module.id, targetIndex);
    if (!TARGET_STATES.includes(state as TargetStateName)) {
      throw new BadRequestException(
        `Estado '${state}' no admitido por el contrato. Use: ${TARGET_STATES.join(', ')}.`,
      );
    }
    return this.dispatch(module.slug, 'led_test', {
      targets: [{ target_index: targetIndex, state }],
    });
  }

  /**
   * Prueba de sensor. El contrato MQTT v1 **no tiene** una acción propia para
   * esto: la más cercana es `self_test`, que el módulo ejecuta sobre todas sus
   * dianas. No se inventa una acción que el firmware no entendería; se pide el
   * autodiagnóstico y se dice, en la respuesta, qué se ha pedido de verdad.
   */
  async testSensor(idOrSlug: string, targetIndex: number, actor: DiagnosticsActor) {
    const module = await this.resolve(idOrSlug, actor);
    const target = await this.resolveTarget(module.id, targetIndex);
    const sent = await this.dispatch(module.slug, 'self_test');
    return {
      ...sent,
      target_index: target.targetIndex,
      scope: 'module' as const,
      note:
        'El contrato v1 no tiene una prueba de sensor por diana: se ha pedido el ' +
        'autodiagnóstico del módulo completo. El resultado llega por `diagnostic`, no aquí.',
    };
  }

  /**
   * Arranca la calibración. El contrato v1 NO admite parámetros en
   * `start_calibration`: la calibración es del MÓDULO, no de una diana suelta.
   * Se comprueba igualmente que la diana exista y esté habilitada —pedir
   * calibrar por una diana apagada no tiene sentido— y la respuesta declara el
   * alcance real en vez de sugerir que se calibra sólo ésa.
   */
  async calibrate(idOrSlug: string, targetIndex: number, actor: DiagnosticsActor) {
    const module = await this.resolve(idOrSlug, actor);
    const target = await this.resolveTarget(module.id, targetIndex);
    if (!target.enabled) {
      throw new BadRequestException(`La diana ${targetIndex} está deshabilitada: no se calibra.`);
    }
    const sent = await this.dispatch(module.slug, 'start_calibration');
    return {
      ...sent,
      target_index: target.targetIndex,
      scope: 'module' as const,
      note:
        'El contrato v1 calibra el MÓDULO completo, no una diana suelta. ' +
        'El resultado llega por `diagnostic`, no aquí.',
    };
  }

  async abortCalibration(idOrSlug: string, actor: DiagnosticsActor) {
    const module = await this.resolve(idOrSlug, actor);
    return this.dispatch(module.slug, 'abort_calibration');
  }

  /**
   * Últimos resultados que el módulo ha devuelto de verdad. Es lo único que
   * permite saber cómo fue una prueba: la llamada que la ordena no lo sabe.
   */
  async results(idOrSlug: string, actor: DiagnosticsActor, take = 20) {
    let module: { id: string; slug: string } | null;
    try {
      module = await this.resolve(idOrSlug, actor);
    } catch (error) {
      // Un administrador puede consultar por slug los diagnósticos de un
      // dispositivo que publica antes de estar dado de alta. Para gestores no
      // se abre este atajo: sin módulo registrado no se puede probar propiedad.
      if (
        actor.role === ROLE.ADMINISTRADOR &&
        !UUID.test(idOrSlug) &&
        error instanceof NotFoundException
      ) {
        module = null;
      } else {
        throw error;
      }
    }
    const items = await this.prisma.incident.findMany({
      // `moduleSlug` rescata diagnósticos recibidos antes de que el módulo se
      // registrara en la base; una vez conocido, aparecen en su historial.
      where: module
        ? {
            source: 'diagnostic',
            OR: [{ moduleId: module.id }, { moduleSlug: module.slug }],
          }
        : { source: 'diagnostic', moduleSlug: idOrSlug },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(take, 1), 100),
    });
    return {
      module: module?.slug ?? idOrSlug,
      moduleRegistered: module !== null,
      items: items.map((item) => ({
        ...item,
        // `occurredAt` significa aquí hora del SUCESO según el módulo. Si no
        // tenía reloj (`epoch_ms=null`) queda a null: no se suplanta con T3.
        occurredAt: item.deviceOccurredAt,
        receivedAt: item.occurredAt,
        timeBasis: item.deviceOccurredAt ? ('module_epoch' as const) : ('ingest_received' as const),
        deviceEventUs: item.deviceEventUs?.toString() ?? null,
        deviceEpochMs: item.deviceEpochMs?.toString() ?? null,
      })),
      note:
        module === null
          ? `El módulo «${idOrSlug}» no está registrado. Se muestran los diagnósticos ` +
            'conservados bajo su identificador MQTT.'
          : items.length === 0
          ? 'Sin resultados: el módulo no ha respondido a ninguna prueba todavía.'
          : null,
    };
  }

  /**
   * Emite el comando e informa de si el broker lo aceptó. `delivered: false`
   * significa que la orden se ha encolado y el módulo NO la ha recibido: sin
   * esto, «he publicado» se confundía con «ha llegado».
   */
  private async dispatch(slug: string, action: string, params?: Record<string, unknown>) {
    const command = (await this.mqtt.sendModuleCommand(slug, action as never, params)) as Record<
      string,
      unknown
    >;
    const delivered = command.delivered === true;
    const denied = command.denied === true;
    return {
      module_id: slug,
      action,
      command_id: command.command_id as string,
      delivered,
      denied,
      note: denied
        ? 'ATENCIÓN: el broker DENEGÓ la orden (ACL). El módulo NO la ha recibido; hay incidencia registrada.'
        : delivered
          ? 'Orden entregada al broker. El resultado lo publica el módulo en `diagnostic`.'
          : 'ATENCIÓN: la orden NO llegó al broker (sin conexión). Queda encolada.',
    };
  }
}
