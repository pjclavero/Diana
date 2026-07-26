import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  /** Señal de vida sin cambio de presencia. */
  async touch(moduleSlug: string, at: Date): Promise<void> {
    await this.prisma.module.updateMany({
      where: { slug: moduleSlug },
      data: { lastSeenAt: at },
    });
  }

  async record(update: PresenceUpdate): Promise<ResilienceDecision | null> {
    const module = await this.prisma.module.findUnique({
      where: { slug: update.moduleSlug },
      select: { id: true, slug: true, online: true, targetSystemId: true },
    });
    if (!module) {
      this.logger.warn(`Presencia de un módulo desconocido: ${update.moduleSlug}`);
      return null;
    }

    const changed = module.online !== update.online;
    await this.prisma.module.update({
      where: { id: module.id },
      data: {
        online: update.online,
        lastSeenAt: update.at,
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

    const system = module.targetSystemId
      ? await this.prisma.targetSystem.findUnique({
          where: { id: module.targetSystemId },
          select: { coordinatorModuleId: true },
        })
      : null;

    const round = game?.rounds[0] ?? null;
    const decision = decidePresenceChange({
      moduleSlug: module.slug,
      online: update.online,
      isCoordinator: system?.coordinatorModuleId === module.id,
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
    if (game.status === 'paused') return; // ya estaba pausada: no se repite la orden

    // Primero la orden al coordinador; si no se puede dar, se registra y se
    // pausa igualmente en el backend para que el panel no mienta.
    try {
      this.mqtt.sendSystemCommand(game.targetSystem.slug, 'pause_game', {}, 10000);
    } catch (error) {
      this.logger.error(`No se pudo publicar la pausa: ${(error as Error).message}`);
      await this.prisma.incident.create({
        data: {
          kind: 'pause_command_failed',
          severity: 'critical',
          source: 'resilience',
          message:
            `La ronda se marca en pausa pero NO se pudo ordenar al coordinador: ` +
            (error as Error).message,
        },
      });
    }

    await this.prisma.$transaction([
      this.prisma.game.update({ where: { id: game.id }, data: { status: 'paused' } }),
      this.prisma.incident.create({
        data: {
          kind:
            decision.action === 'hard_pause' ? INCIDENT_KIND.hardPause : INCIDENT_KIND.autoPause,
          severity: decision.severity,
          source: 'resilience',
          message: decision.reason,
          detail: { game_id: game.id, module_slug: moduleSlug } as never,
        },
      }),
    ]);
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
    const modules = await this.prisma.module.findMany({
      where: { targetSystemId: game.targetSystemId },
      select: { id: true, slug: true, online: true, lastSeenAt: true },
      orderBy: { slug: 'asc' },
    });

    const involved = modules.filter((m) => (round ? this.roundInvolves(round.plan, m.slug) : false));
    const offline = involved.filter((m) => !m.online);
    const coordinatorDown = modules.some(
      (m) => m.id === game.targetSystem.coordinatorModuleId && !m.online,
    );

    // La cuenta atrás arranca en la caída más reciente que conocemos.
    const since = offline.reduce<Date | null>((oldest, m) => {
      if (!m.lastSeenAt) return oldest;
      return oldest === null || m.lastSeenAt < oldest ? m.lastSeenAt : oldest;
    }, null);
    const countdown = since ? reconnectCountdown({ since, now, graceMs }) : null;

    return {
      game: { id: game.id, status: game.status, panel: game.targetSystem.name },
      round: round ? { id: round.id, index: round.roundIndex, phase: round.phase } : null,
      coordinatorDown,
      missingModules: offline.map((m) => ({
        slug: m.slug,
        lastSeenAt: m.lastSeenAt,
      })),
      involvedModules: involved.length,
      countdown,
      // El operador decide; el backend nunca reanuda solo.
      operatorMustDecide: offline.length > 0 || coordinatorDown,
      canResumeWithout: offline.length > 0 && !coordinatorDown,
      note: coordinatorDown
        ? 'Pausa dura: sin coordinador no hay tiempos fiables. No se puede reanudar sin él.'
        : null,
    };
  }

  /**
   * Decisión del operador tras una caída: reanudar sin el módulo, o abortar.
   * Reanudar sin el coordinador NO se admite: los tiempos no serían fiables.
   */
  async decide(gameId: string, action: 'resume_without' | 'abort', actor?: string) {
    const status = await this.statusOf(gameId);
    if (action === 'resume_without' && status.coordinatorDown) {
      throw new BadRequestException(
        'No se puede reanudar sin el coordinador: sin él no hay tiempos fiables.',
      );
    }
    if (action === 'resume_without' && status.missingModules.length === 0) {
      throw new BadRequestException('No falta ningún módulo: use la reanudación normal.');
    }

    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { targetSystem: { select: { slug: true } } },
    });
    if (!game) throw new NotFoundException(`Partida ${gameId} no encontrada`);

    const command = this.mqtt.sendSystemCommand(
      game.targetSystem.slug,
      action === 'resume_without' ? 'resume_game' : 'abort_game',
      {},
      10000,
    );

    await this.prisma.$transaction([
      this.prisma.game.update({
        where: { id: gameId },
        data:
          action === 'resume_without'
            ? { status: 'running' }
            : { status: 'aborted', finishedAt: new Date() },
      }),
      this.prisma.incident.create({
        data: {
          kind: action === 'resume_without' ? 'round_resumed_without_module' : 'round_aborted',
          severity: 'warning',
          source: 'resilience',
          message:
            action === 'resume_without'
              ? `El operador reanuda la ronda SIN los módulos: ${status.missingModules
                  .map((m) => m.slug)
                  .join(', ')}. Las condiciones de la prueba han cambiado.`
              : 'El operador aborta la ronda tras una caída de módulo.',
          detail: {
            game_id: gameId,
            missing: status.missingModules.map((m) => m.slug),
            decided_by: actor ?? null,
          } as never,
        },
      }),
    ]);

    return { action, command, missing: status.missingModules.map((m) => m.slug) };
  }
}
