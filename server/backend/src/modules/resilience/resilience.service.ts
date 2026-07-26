import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  BLACKOUT_GRACE_MS,
  decidePresenceChange,
  findStaleModules,
  isBlackout,
  reconnectCountdown,
  STALE_AFTER_MS,
  type ResilienceDecision,
  type StaleModule,
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
  stale: 'module_stale',
  blackout: 'presence_blackout',
} as const;

const DEFAULT_SWEEP_INTERVAL_MS = 15_000;

/**
 * Cada cuánto se buscan módulos callados. Sólo un `0` explícito desactiva el
 * barrido: una errata en la variable NO puede apagar en silencio la detección
 * de caídas, así que se avisa y se sigue con el valor por defecto (N4).
 */
export function sweepIntervalFrom(raw: string | undefined, logger?: Logger): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SWEEP_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    logger?.error(
      `RESILIENCE_SWEEP_MS='${raw}' no es un número válido. Se usa el valor por defecto ` +
        `(${DEFAULT_SWEEP_INTERVAL_MS} ms): apagar la detección de caídas exige poner un 0.`,
    );
    return DEFAULT_SWEEP_INTERVAL_MS;
  }
  return value;
}

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
export class ResilienceService implements PresenceSinkPort, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ResilienceService.name);
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** Desde cuándo callan todos a la vez; `null` = no hay apagón en curso. */
  private blackoutSince: Date | null = null;
  private blackoutReported = false;

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
  async touch(moduleSlug: string, at: Date, revives = false): Promise<void> {
    const refreshed = await this.prisma.module.updateMany({
      where: { slug: moduleSlug, online: true },
      data: { lastSeenAt: at },
    });
    if (refreshed.count > 0 || !revives) return;

    // RESUCITA (D2). Si el barrido dio por caído a un módulo por silencio y el
    // módulo sigue mandando tráfico NO retenido (telemetría, impactos), esa es
    // prueba de que está vivo y hay que deshacer la declaración: si no, no
    // volvería nunca —su presencia sólo se publica al (re)conectar el MQTT, que
    // en este caso no se ha caído— y la ronda se quedaría pausada esperando a
    // un módulo que está disparando. Los mensajes RETENIDOS (`status`) no
    // resucitan a nadie: se reentregan al reconectar el backend y revivirían a
    // un módulo realmente muerto.
    const module = await this.prisma.module.findUnique({
      where: { slug: moduleSlug },
      select: { online: true },
    });
    if (!module || module.online) return;
    this.logger.warn(
      `El módulo ${moduleSlug} constaba caído pero sigue enviando tráfico: se le da por vivo.`,
    );
    await this.record({ moduleSlug, online: true, reason: 'traffic', at });
  }

  onApplicationBootstrap(): void {
    const interval = sweepIntervalFrom(process.env.RESILIENCE_SWEEP_MS, this.logger);
    if (interval <= 0) {
      this.logger.warn('Barrido de módulos callados DESACTIVADO (RESILIENCE_SWEEP_MS=0).');
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.sweepStale().catch((error) =>
        this.logger.error(`Barrido de presencia fallido: ${(error as Error).message}`),
      );
    }, interval);
    // Un temporizador de fondo no debe mantener vivo el proceso al apagarse.
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /**
   * Da por caídos los módulos que constan en línea pero llevan demasiado tiempo
   * callados (D9). Sin esto, la detección de caídas depende por completo de que
   * llegue el Last Will, y ese mensaje se pierde si el broker se reinicia sin
   * persistencia o si la sesión se cae de forma sucia: `online` se queda pegado
   * a `true` y un módulo muerto pasa por vivo para siempre.
   *
   * No inventa un camino paralelo: cada módulo callado entra por el MISMO
   * `record()` que la presencia real, así que auto-pausa, incidencias y
   * decisión del operador se comportan igual que con un LWT.
   */
  async sweepStale(now: Date = new Date(), staleAfterMs = STALE_AFTER_MS): Promise<string[]> {
    if (this.sweeping) return [];
    this.sweeping = true;
    try {
      // SORDERA PROPIA, NO CAÍDA AJENA (D1). Si no hay conexión con el broker,
      // o la hay desde hace menos de lo que dura el plazo, el silencio de los
      // módulos es nuestro: no hemos estado escuchando. Declarar caídas aquí
      // pausaría una ronda real —y la orden de pausa ni siquiera saldría—.
      const since = this.brokerConnectedSince();
      if (since === null) {
        this.logger.warn('Barrido omitido: sin conexión con el broker; el silencio es nuestro.');
        // El plazo de tolerancia del apagón mide silencio OYENDO. Si nos hemos
        // quedado sordos hay que reiniciarlo: si no, el rato sin escucha se
        // acumularía como si fuera silencio de los módulos y las caídas se
        // declararían antes de tiempo, que es justo la confusión que este
        // guardarraíl existe para evitar (B1).
        this.forgetBlackout();
        return [];
      }
      if (now.getTime() - since.getTime() < staleAfterMs) {
        this.forgetBlackout();
        return [];
      }

      const candidates = await this.prisma.module.findMany({
        where: { online: true },
        select: { id: true, slug: true, online: true, lastSeenAt: true, targetSystemId: true },
      });
      const stale = findStaleModules(candidates, now, staleAfterMs);
      const bySlug = new Map(candidates.map((c) => [c.slug, c]));

      // APAGÓN, NO CAÍDA (D1). Que callen TODOS a la vez no es que hayan muerto
      // todos: es que se ha roto el camino común (broker, red, suscripción).
      if (isBlackout(candidates, stale)) {
        this.blackoutSince ??= now;
        const heldMs = now.getTime() - this.blackoutSince.getTime();
        // …pero callar TODOS no puede dejar el sistema ciego para siempre: si se
        // va la luz de una sala con dos módulos, la ronda debe pausarse. El
        // silencio se tolera un plazo acotado; pasado ese plazo se declaran las
        // caídas igualmente, porque una ronda pausada de más se reanuda con un
        // botón y una ronda que sigue con las dianas muertas produce resultados
        // basura sin que nadie se entere.
        if (heldMs <= BLACKOUT_GRACE_MS) {
          this.logger.error(
            `Los ${candidates.length} módulos en línea han callado a la vez: se trata como ` +
              'un fallo del camino común, no como caídas. No se declara ninguna todavía.',
          );
          // Una incidencia por APAGÓN, no por barrido: al ritmo del barrido
          // serían miles al día y ahogarían el registro donde el operador tiene
          // que ver justo esto.
          if (!this.blackoutReported) {
            this.blackoutReported = true;
            await this.prisma.incident
              .create({
                data: {
                  kind: INCIDENT_KIND.blackout,
                  severity: 'critical',
                  source: 'resilience',
                  message:
                    `Silencio simultáneo de los ${candidates.length} módulos en línea de ` +
                    'TODO el sistema, no de un panel. Es un ' +
                    'fallo del camino común (broker, red o suscripción), no una caída de cada ' +
                    'módulo: no se declara ninguno caído. Revise el broker. Si el silencio ' +
                    `dura más de ${Math.round(BLACKOUT_GRACE_MS / 1000)} s se declararán las ` +
                    'caídas de todas formas y la ronda se pausará.',
                  detail: {
                    modules: stale.map((m) => m.slug),
                    stale_after_ms: staleAfterMs,
                    blackout_grace_ms: BLACKOUT_GRACE_MS,
                  } as never,
                },
              })
              .catch(() => undefined);
          }
          return [];
        }
        this.logger.error(
          `El silencio simultáneo dura ${Math.round(heldMs / 1000)} s: se declaran las caídas ` +
            'aunque no se pueda distinguir de un fallo del camino común.',
        );
      } else {
        this.forgetBlackout();
      }

      const declared: string[] = [];
      for (const m of stale) {
        // Un fallo con un módulo no puede dejar sin revisar a los demás (N2).
        try {
          declared.push(await this.declareStale(m, bySlug.get(m.slug)!, now, staleAfterMs));
        } catch (error) {
          this.logger.error(
            `No se pudo declarar caído a ${m.slug}: ${(error as Error).message}`,
          );
        }
      }
      return declared;
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Qué va a hacer el barrido si el silencio continúa. Lo necesita la pantalla:
   * anunciar «la ronda se pausará sola» cuando el barrido está inhibido —porque
   * no oímos al broker, o porque callan todos a la vez— es prometer algo que no
   * va a pasar (N-D1).
   */
  async sweepOutlook(now: Date, staleAfterMs = STALE_AFTER_MS) {
    // El barrido se puede desactivar por configuración: entonces no habrá
    // pausa automática por mucho que oigamos al broker, y decir lo contrario
    // es la misma mentira que motivó N-D1, sólo que por el tercer camino (B2).
    const enabled = sweepIntervalFrom(process.env.RESILIENCE_SWEEP_MS) > 0;
    const since = this.brokerConnectedSince();
    const listening = since !== null && now.getTime() - since.getTime() >= staleAfterMs;
    if (!enabled || !listening) return { enabled, listening, blackout: false };
    const candidates = await this.prisma.module.findMany({
      where: { online: true },
      select: { slug: true, online: true, lastSeenAt: true },
    });
    return {
      enabled: true,
      listening: true,
      blackout: isBlackout(candidates, findStaleModules(candidates, now, staleAfterMs)),
    };
  }

  /** Olvida el apagón en curso: el plazo vuelve a contar desde cero. */
  private forgetBlackout(): void {
    this.blackoutSince = null;
    this.blackoutReported = false;
  }

  /** Desde cuándo oímos al broker sin cortes; `null` = ahora mismo no lo oímos. */
  private brokerConnectedSince(): Date | null {
    try {
      return (this.moduleRef.get(MqttService, { strict: false }) as MqttService).connectedSince ?? null;
    } catch {
      return null;
    }
  }

  private async declareStale(
    m: StaleModule,
    module: { id: string; targetSystemId: string | null },
    now: Date,
    staleAfterMs: number,
  ): Promise<string> {
    this.logger.warn(m.reason);
    // La incidencia deja escrito POR QUÉ se le da por caído: no llegó su Last
    // Will, se dedujo del silencio. Es una afirmación más débil y hay que
    // poder distinguirla.
    await this.prisma.incident
      .create({
        data: {
          kind: INCIDENT_KIND.stale,
          severity: 'warning',
          source: 'resilience',
          // Sin módulo ni panel, la incidencia no sale en las vistas acotadas (N3).
          moduleId: module.id,
          targetSystemId: module.targetSystemId,
          message: m.reason,
          detail: {
            module_slug: m.slug,
            last_seen_at: m.lastSeenAt?.toISOString() ?? null,
            silent_for_ms: m.silentForMs,
            stale_after_ms: staleAfterMs,
          } as never,
        },
      })
      .catch(() => undefined);
    await this.record({
      moduleSlug: m.slug,
      online: false,
      reason: 'stale',
      // `offlineSince` marca cuándo se DECLARA la caída, no cuándo dejó de
      // hablar: la ventana de reconexión debe empezar ahora, o nacería agotada
      // (el silencio tolerado ya es mayor que el plazo) y el operador se
      // quedaría sin margen justo en el caso peor sustentado (D3). Cuánto
      // llevaba callado no se pierde: sigue en `lastSeenAt`, que `record` no
      // toca al pasar a offline, y se muestra en pantalla.
      at: now,
    });
    return m.slug;
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
    if (transitioned.count === 0) {
      // Ya estaba pausada (p. ej. pausa manual previa): no se repite la orden,
      // pero SÍ queda constancia de que además cayó un módulo implicado. Sin
      // esa incidencia, al volver el módulo la ronda quedaba sin salida (N2).
      await this.prisma.incident.create({
        data: {
          kind:
            decision.action === 'hard_pause' ? INCIDENT_KIND.hardPause : INCIDENT_KIND.autoPause,
          severity: decision.severity,
          source: 'resilience',
          message: `${decision.reason} (la ronda ya estaba en pausa: no se repite la orden)`,
          detail: {
            game_id: game.id,
            module_slug: moduleSlug,
            command_delivered: null,
            already_paused: true,
          } as never,
        },
      });
      return;
    }

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
    // El filtro por partida va en SQL: con `take` global y filtrado en memoria,
    // 25 incidencias de OTRAS partidas escondían la de ésta y la ronda volvía a
    // quedarse sin salida (N1). El desempate por `id` evita que dos incidencias
    // del mismo microsegundo se ordenen al azar.
    const mine = await this.prisma.incident.findMany({
      where: {
        source: 'resilience',
        kind: {
          in: [
            INCIDENT_KIND.autoPause,
            INCIDENT_KIND.hardPause,
            INCIDENT_KIND.resumed,
            'round_resumed_without_module',
            'round_aborted',
          ],
        },
        detail: { path: ['game_id'], equals: gameId },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { kind: true, detail: true, occurredAt: true },
    });
    const last = mine[0] ?? null;
    const pausedByResilience =
      last !== null && (last.kind === INCIDENT_KIND.autoPause || last.kind === INCIDENT_KIND.hardPause);
    const commandDelivered = !pausedByResilience
      ? null
      : ((last!.detail as { command_delivered?: boolean } | null)?.command_delivered ?? null);
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
    // Los que hay que vigilar: los del plan y el coordinador de la partida.
    const watched = modules.filter(
      (m) => involved.includes(m) || m.id === game.targetSystem.coordinatorModuleId,
    );
    const outlook = await this.sweepOutlook(now);

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
        // Silencio acumulado: que un módulo conste caído no dice desde cuándo,
        // y el operador necesita saber si acaba de irse o lleva un cuarto de hora.
        silentForMs: m.lastSeenAt ? now.getTime() - m.lastSeenAt.getTime() : null,
      })),
      // Módulos que la base da por vivos pero llevan callados más de la cuenta.
      // Se calcula al leer: el barrido corre cada pocos segundos, así que entre
      // barrido y barrido esta lista puede adelantarse a `missingModules`.
      // Sólo con la partida VIVA: fuera de `running|paused` el barrido no
      // pausará nada, y anunciarlo sería prometer algo que no va a pasar (N5).
      staleModules: ['running', 'paused'].includes(game.status)
        ? findStaleModules(
            // El COORDINADOR también, aunque no aporte dianas al plan: su caída
            // provoca pausa dura, que es el caso más grave, y sin esto era
            // justo el único del que no había aviso previo.
            watched.map((m) => ({ slug: m.slug, online: m.online, lastSeenAt: m.lastSeenAt })),
            now,
          ).map((m) => ({ slug: m.slug, silentForMs: m.silentForMs, reason: m.reason }))
        : [],
      // Qué hará el barrido si el silencio sigue: la pantalla no puede prometer
      // una pausa automática cuando el barrido está inhibido (N-D1).
      sweep: outlook,
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
