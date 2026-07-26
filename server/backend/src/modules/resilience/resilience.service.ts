import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  decidePresenceChange,
  reconnectCountdown,
  type ResilienceDecision,
} from '../../domain/resilience/resilience';
import type { TargetRef } from '../../domain/game/types';
import type { PresenceSinkPort, PresenceUpdate } from '../hits/ports';
import { MqttService } from '../mqtt/mqtt.service';

/** Plazo por defecto de reconexión antes de pedir decisión al operador. */
export const RECONNECT_GRACE_MS = 60_000;

const INCIDENT_KIND = {
  offline: 'module_offline',
  online: 'module_online',
  autoPause: 'round_auto_paused',
  hardPause: 'round_hard_paused',
  pauseFailed: 'pause_command_failed',
  resumed: 'round_resumed',
} as const;

/**
 * Resiliencia y reconexión (G-I, §6.3).
 *
 * Hace dos cosas que antes no hacía nadie:
 *  1. PERSISTE la presencia de los módulos (`Module.online`, `lastSeenAt`,
 *     `bootId`…) a partir de `module/+/presence` y su Last Will.
 *  2. Ante la caída de un módulo implicado, PAUSA la ronda y abre una ventana
 *     de reconexión. La decisión de reanudar sin él o abortar es SIEMPRE del
 *     operador: reanudar sin un módulo cambia las condiciones de la prueba.
 */
@Injectable()
export class ResilienceService implements PresenceSinkPort {
  private readonly logger = new Logger(ResilienceService.name);

  /**
   * `MqttService` se resuelve BAJO DEMANDA, no por constructor: la ingesta
   * inyecta este servicio como sumidero de presencia, y `MqttService` inyecta a
   * su vez la ingesta. Pedirlo en el constructor cerraba el ciclo y la
   * inyección de dependencias se quedaba colgada al arrancar.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get mqtt(): Pick<MqttService, 'sendSystemCommand'> {
    return this.moduleRef.get(MqttService, { strict: false });
  }

  /**
   * Señal de vida sin cambio de presencia. Sólo cuenta para un módulo que ya
   * consta EN LÍNEA: los mensajes retenidos se reentregan al reconectar el
   * backend y reiniciaban la ventana de reconexión de un módulo muerto (D6).
   */
  async touch(moduleSlug: string, at: Date): Promise<void> {
    await this.prisma.module.updateMany({
      where: { slug: moduleSlug, online: true },
      data: { lastSeenAt: at },
    });
  }

  async record(update: PresenceUpdate): Promise<ResilienceDecision | null> {
    const module = await this.prisma.module.findUnique({
      where: { slug: update.moduleSlug },
      select: { id: true, slug: true, online: true, targetSystemId: true },
    });
    if (!module) {
      // No se pierde en silencio: un módulo real que no esté dado de alta es
      // invisible para la detección de caídas, y eso hay que poder verlo (D8).
      this.logger.warn(`Presencia de un módulo desconocido: ${update.moduleSlug}`);
      await this.prisma.incident
        .create({
          data: {
            kind: 'presence_unknown_module',
            severity: 'warning',
            source: 'resilience',
            message:
              `Presencia de '${update.moduleSlug}', que no está dado de alta: ` +
              'sus caídas no se detectarán hasta registrarlo.',
            detail: { online: update.online, reason: update.reason } as never,
          },
        })
        .catch(() => undefined);
      return null;
    }

    const changed = module.online !== update.online;
    await this.prisma.module.update({
      where: { id: module.id },
      data: {
        online: update.online,
        // `lastSeenAt` sólo avanza si el módulo está VIVO. Al caer, la última
        // vez que se le vio es la de antes, no el instante en que nos enteramos
        // (defecto D6). Y así un LWT retenido reentregado no reinicia la cuenta.
        lastSeenAt: update.online ? update.at : undefined,
        // Instante de la caída: se fija sólo en la transición a offline.
        offlineSince: update.online ? null : changed ? update.at : undefined,
        // Los datos de identidad sólo se refrescan si el módulo los envía.
        bootId: update.bootId ?? undefined,
        firmwareVersion: update.firmwareVersion ?? undefined,
        hardwareRevision: update.hardwareRevision ?? undefined,
        mac: update.mac ?? undefined,
        ip: update.ip ?? undefined,
        serial: update.serial ?? undefined,
      },
    });

    // Sin cambio real de presencia no hay nada que decidir (los mensajes
    // retenidos se reciben al reconectar el backend y repetirían la decisión).
    if (!changed) return null;

    return this.reactToPresence(module, update);
  }

  private async reactToPresence(
    module: { id: string; slug: string; targetSystemId: string | null },
    update: PresenceUpdate,
  ): Promise<ResilienceDecision> {
    const game = module.targetSystemId
      ? await this.prisma.game.findFirst({
          where: {
            status: { in: ['running', 'paused'] },
            OR: [
              { targetSystemId: module.targetSystemId },
              { view: { panels: { some: { targetSystemId: module.targetSystemId } } } },
            ],
          },
          include: { rounds: { orderBy: { roundIndex: 'desc' }, take: 1 }, targetSystem: true },
        })
      : null;

    // El coordinador que manda es el de la PARTIDA (quien consolida T2), no el
    // del panel del módulo: en una vista multipanel, el principal de un panel
    // secundario no es la autoridad temporal de esa ronda (D10).
    const coordinatorId = game
      ? game.targetSystem.coordinatorModuleId
      : module.targetSystemId
        ? (
            await this.prisma.targetSystem.findUnique({
              where: { id: module.targetSystemId },
              select: { coordinatorModuleId: true },
            })
          )?.coordinatorModuleId ?? null
        : null;

    const round = game?.rounds[0] ?? null;
    const decision = decidePresenceChange({
      moduleSlug: module.slug,
      online: update.online,
      isCoordinator: coordinatorId === module.id,
      involvedInRound: round ? this.roundInvolves(round.plan, module.slug) : false,
      gameStatus: game?.status ?? null,
    });

    await this.prisma.incident.create({
      data: {
        kind: update.online ? INCIDENT_KIND.online : INCIDENT_KIND.offline,
        severity: decision.severity,
        source: 'resilience',
        moduleId: module.id,
        targetSystemId: module.targetSystemId,
        message: decision.reason,
        detail: {
          reason: update.reason,
          action: decision.action,
          game_id: game?.id ?? null,
          round_id: round?.id ?? null,
        } as never,
      },
    });

    if (decision.action === 'auto_pause' || decision.action === 'hard_pause') {
      await this.pauseRound(game!, decision, module.slug);
    }

    return decision;
  }

  /** ¿El plan de la ronda usa dianas de este módulo? */
  private roundInvolves(plan: unknown, moduleSlug: string): boolean {
    const activations = (plan as { activations?: Array<{ targets?: TargetRef[] }> } | null)
      ?.activations;
    if (!Array.isArray(activations)) return false;
    return activations.some((a) => (a.targets ?? []).some((t) => t.module_id === moduleSlug));
  }

  private async pauseRound(
    game: { id: string; status: string; targetSystem: { slug: string } },
    decision: ResilienceDecision,
    moduleSlug: string,
  ): Promise<void> {
    // Transición CONDICIONAL: si dos módulos caen a la vez, sólo la primera
    // llamada pasa de `running` a `paused` y sólo ella ordena la pausa. Con un
    // `update` por id se publicaban dos `pause_game` (defecto D5).
    const transitioned = await this.prisma.game.updateMany({
      where: { id: game.id, status: 'running' },
      data: { status: 'paused' },
    });
    if (transitioned.count === 0) return; // ya estaba pausada o cambió de estado

    let delivered = false;
    let failure: string | null = null;
    try {
      const command = this.mqtt.sendSystemCommand(game.targetSystem.slug, 'pause_game', {}, 10000);
      delivered = (command as { delivered?: boolean }).delivered === true;
      if (!delivered) failure = 'El broker MQTT no ha recibido la orden (sin conexión).';
    } catch (error) {
      failure = (error as Error).message;
    }

    if (failure) {
      // La ronda está pausada en el backend pero el hardware NO lo sabe. Se deja
      // constancia para que el panel pueda decirlo (D3): la pantalla no puede
      // afirmar «ronda en pausa» sin matizar que la orden no salió.
      this.logger.error(`No se pudo ordenar la pausa: ${failure}`);
      await this.prisma.incident.create({
        data: {
          kind: INCIDENT_KIND.pauseFailed,
          severity: 'critical',
          source: 'resilience',
          targetSystemId: null,
          message: `La ronda se marca en pausa pero NO se ordenó al coordinador: ${failure}`,
          detail: { game_id: game.id, module_slug: moduleSlug } as never,
        },
      });
    }

    await this.prisma.incident.create({
      data: {
        kind: decision.action === 'hard_pause' ? INCIDENT_KIND.hardPause : INCIDENT_KIND.autoPause,
        severity: decision.severity,
        source: 'resilience',
        message: decision.reason,
        detail: {
          game_id: game.id,
          module_slug: moduleSlug,
          command_delivered: delivered,
        } as never,
      },
    });
  }

  /** Paneles implicados: los de la vista, o el panel único de la partida (D4). */
  private async panelsOfGame(game: { targetSystemId: string; viewId: string | null }) {
    if (!game.viewId) return [game.targetSystemId];
    const panels = await this.prisma.viewPanel.findMany({
      where: { viewId: game.viewId },
      select: { targetSystemId: true },
    });
    return [...new Set([game.targetSystemId, ...panels.map((p) => p.targetSystemId)])];
  }

  /** ¿Sigue pausada por una caída, y salió la orden? */
  private async pauseContext(gameId: string) {
    const incidents = await this.prisma.incident.findMany({
      where: {
        source: 'resilience',
        kind: {
          in: [
            INCIDENT_KIND.autoPause,
            INCIDENT_KIND.hardPause,
            INCIDENT_KIND.pauseFailed,
            INCIDENT_KIND.resumed,
            'round_resumed_without_module',
            'round_aborted',
          ],
        },
      },
      orderBy: { occurredAt: 'desc' },
      take: 25,
      select: { kind: true, detail: true, occurredAt: true },
    });
    const mine = incidents.filter(
      (i) => (i.detail as { game_id?: string } | null)?.game_id === gameId,
    );
    const last = mine[0] ?? null;
    const pausedByResilience =
      last !== null && (last.kind === INCIDENT_KIND.autoPause || last.kind === INCIDENT_KIND.hardPause);
    const commandDelivered =
      last === null ? null : ((last.detail as { command_delivered?: boolean } | null)?.command_delivered ?? null);
    return { pausedByResilience, commandDelivered, since: last?.occurredAt ?? null };
  }

  /**
   * Estado de resiliencia de una partida: qué módulos faltan, cuánto queda de
   * la cuenta atrás y qué puede decidir el operador.
   */
  async statusOf(gameId: string, now: Date = new Date(), graceMs = RECONNECT_GRACE_MS) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        rounds: { orderBy: { roundIndex: 'desc' }, take: 1 },
        targetSystem: { select: { id: true, slug: true, name: true, coordinatorModuleId: true } },
      },
    });
    if (!game) throw new NotFoundException(`Partida ${gameId} no encontrada`);

    const round = game.rounds[0] ?? null;
    // TODOS los paneles de la partida: con una vista multipanel, mirar sólo el
    // panel principal dejaba la ronda pausada sin aviso ni salida (D4).
    const panelIds = await this.panelsOfGame(game);
    const modules = await this.prisma.module.findMany({
      where: { targetSystemId: { in: panelIds } },
      select: { id: true, slug: true, online: true, lastSeenAt: true, offlineSince: true },
      orderBy: { slug: 'asc' },
    });

    const involved = modules.filter((m) => (round ? this.roundInvolves(round.plan, m.slug) : false));
    const offline = involved.filter((m) => !m.online);
    const coordinatorDown = modules.some(
      (m) => m.id === game.targetSystem.coordinatorModuleId && !m.online,
    );

    // La ventana se cuenta desde la caída MÁS RECIENTE: es la última que hay
    // que esperar (con dos módulos fuera, el plazo no puede darse por agotado
    // por el que lleva más tiempo).
    const since = offline.reduce<Date | null>((latest, m) => {
      const fell = m.offlineSince ?? m.lastSeenAt;
      if (!fell) return latest;
      return latest === null || fell > latest ? fell : latest;
    }, null);
    const countdown = since ? reconnectCountdown({ since, now, graceMs }) : null;

    const pause = await this.pauseContext(gameId);
    const paused = game.status === 'paused';
    // Si el módulo vuelve, la ronda NO se reanuda sola: sigue pausada y hay que
    // poder reanudarla desde el panel. Antes el aviso desaparecía y la partida
    // quedaba congelada sin salida (D1).
    const canResume = paused && pause.pausedByResilience && offline.length === 0 && !coordinatorDown;

    return {
      game: { id: game.id, status: game.status, panel: game.targetSystem.name },
      round: round ? { id: round.id, index: round.roundIndex, phase: round.phase } : null,
      panels: panelIds,
      paused,
      pausedByResilience: pause.pausedByResilience,
      // null = no consta; false = la orden de pausa NO llegó al broker.
      pauseCommandDelivered: pause.commandDelivered,
      brokerConnected: this.brokerConnected(),
      coordinatorDown,
      missingModules: offline.map((m) => ({
        slug: m.slug,
        lastSeenAt: m.lastSeenAt,
        offlineSince: m.offlineSince,
      })),
      involvedModules: involved.length,
      countdown,
      // El operador decide; el backend nunca reanuda solo.
      operatorMustDecide: (paused && pause.pausedByResilience) || offline.length > 0 || coordinatorDown,
      canResumeWithout: paused && offline.length > 0 && !coordinatorDown,
      canResume,
      note: coordinatorDown
        ? 'Pausa dura: sin coordinador no hay tiempos fiables. No se puede reanudar sin él.'
        : pause.commandDelivered === false
          ? 'ATENCIÓN: la orden de pausa no llegó al coordinador. El backend la da por pausada, pero el hardware puede seguir en marcha.'
          : null,
    };
  }

  private brokerConnected(): boolean | null {
    try {
      return (this.moduleRef.get(MqttService, { strict: false }) as MqttService).connected;
    } catch {
      return null;
    }
  }

  /** Ningún otro juego puede estar ocupando los paneles al reanudar (G-H). */
  private async assertPanelsFreeForResume(game: {
    id: string;
    targetSystemId: string;
    viewId: string | null;
  }) {
    const panelIds = await this.panelsOfGame(game);
    const conflict = await this.prisma.game.findFirst({
      where: {
        id: { not: game.id },
        status: { in: ['armed', 'running', 'paused'] },
        OR: [
          { targetSystemId: { in: panelIds } },
          { view: { panels: { some: { targetSystemId: { in: panelIds } } } } },
        ],
      },
      select: { id: true, name: true, status: true },
    });
    if (conflict) {
      throw new ConflictException(
        `El panel está ocupado por la partida ${conflict.name ?? conflict.id} (${conflict.status}).`,
      );
    }
  }

  /**
   * Decisión del operador tras una caída: reanudar (con todos de vuelta),
   * reanudar sin el módulo, o abortar. Reanudar sin el coordinador NO se admite.
   */
  async decide(gameId: string, action: 'resume' | 'resume_without' | 'abort', actor?: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { targetSystem: { select: { slug: true } } },
    });
    if (!game) throw new NotFoundException(`Partida ${gameId} no encontrada`);

    // Una partida cerrada no se resucita desde aquí (D2): antes `decide` no
    // miraba el estado y devolvía una partida `finished` a `running`.
    const allowedFrom: Record<typeof action, string[]> = {
      resume: ['paused'],
      resume_without: ['paused'],
      abort: ['running', 'paused'],
    };
    if (!allowedFrom[action]?.includes(game.status)) {
      throw new ConflictException(
        `No se puede '${action}' sobre una partida en estado '${game.status}'.`,
      );
    }

    const status = await this.statusOf(gameId);
    if (action !== 'abort') {
      if (status.coordinatorDown) {
        throw new BadRequestException(
          'No se puede reanudar sin el coordinador: sin él no hay tiempos fiables.',
        );
      }
      if (action === 'resume_without' && status.missingModules.length === 0) {
        throw new BadRequestException('No falta ningún módulo: use la reanudación normal.');
      }
      if (action === 'resume' && status.missingModules.length > 0) {
        throw new BadRequestException(
          `Siguen ausentes: ${status.missingModules.map((m) => m.slug).join(', ')}. ` +
            'Use «reanudar sin él» si quiere continuar igualmente.',
        );
      }
      // Reanudar vuelve a ocupar hardware: el guardarraíl de G-H también aquí.
      await this.assertPanelsFreeForResume(game);
    }

    const command = this.mqtt.sendSystemCommand(
      game.targetSystem.slug,
      action === 'abort' ? 'abort_game' : 'resume_game',
      {},
      10000,
    );
    const delivered = (command as { delivered?: boolean }).delivered === true;

    await this.prisma.$transaction([
      this.prisma.game.update({
        where: { id: gameId },
        data:
          action === 'abort'
            ? { status: 'aborted', finishedAt: new Date() }
            : { status: 'running' },
      }),
      this.prisma.incident.create({
        data: {
          kind:
            action === 'abort'
              ? 'round_aborted'
              : action === 'resume'
                ? INCIDENT_KIND.resumed
                : 'round_resumed_without_module',
          severity: 'warning',
          source: 'resilience',
          message:
            action === 'abort'
              ? 'El operador aborta la ronda tras una caída de módulo.'
              : action === 'resume'
                ? 'El operador reanuda la ronda: todos los módulos han vuelto.'
                : `El operador reanuda la ronda SIN los módulos: ${status.missingModules
                    .map((m) => m.slug)
                    .join(', ')}. Las condiciones de la prueba han cambiado.`,
          detail: {
            game_id: gameId,
            missing: status.missingModules.map((m) => m.slug),
            decided_by: actor ?? null,
            command_delivered: delivered,
          } as never,
        },
      }),
    ]);

    return {
      action,
      command,
      delivered,
      missing: status.missingModules.map((m) => m.slug),
      note: delivered ? null : 'La orden no llegó al broker MQTT: el hardware puede no haberla recibido.',
    };
  }
}
