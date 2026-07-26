import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameEngine } from '../../domain/game/engine';
import { createDefaultRegistry, GameModeRegistry } from '../../domain/game/registry';
import { RoundConfig, TargetRef } from '../../domain/game/types';
import { MqttService } from '../mqtt/mqtt.service';

export interface CreateGameInput {
  target_system_id: string;
  mode: string;
  name?: string;
  seed?: number;
  preset_id?: string;
  config?: Record<string, unknown>;
  created_by?: string;
}

export interface CreateRoundInput {
  mode?: string;
  seed?: number;
  targets: TargetRef[];
  sequence?: TargetRef[] | null;
  repetitions?: number;
  interval_ms?: number;
  countdown_ms?: number;
  time_limit_ms?: number | null;
  penalty_ms?: number;
  strict_order?: boolean;
  reaction_delay_ms?: [number, number] | null;
}

/**
 * Subconjunto de Prisma que usa el guardarraíl: sirve tanto el cliente normal
 * como el cliente de una transacción interactiva.
 */
type TransactionClient = {
  $executeRaw: PrismaService['$executeRaw'];
  game: { findFirst: PrismaService['game']['findFirst']; update: PrismaService['game']['update'] };
  round: { update: PrismaService['round']['update'] };
  viewPanel: { findMany: PrismaService['viewPanel']['findMany'] };
};

type PrismaLike = {
  game: { findFirst: PrismaService['game']['findFirst'] };
  viewPanel: { findMany: PrismaService['viewPanel']['findMany'] };
};

/** Estados que ocupan hardware: mientras la partida esté en uno de ellos, el panel no está libre. */
export const ACTIVE_GAME_STATUSES: Array<'armed' | 'running' | 'paused'> = [
  'armed',
  'running',
  'paused',
];

/** Estados desde los que tiene sentido autorizar el comienzo de una ronda. */
export const STARTABLE_GAME_STATUSES = ['draft', 'armed', 'paused'] as const;

/** Órdenes de control admitidas; cualquier otra cosa es un 400, no un 500. */
export const CONTROL_ACTIONS = ['pause_game', 'resume_game', 'abort_game', 'end_game'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/**
 * Orquestación administrativa de partidas.
 *
 * SEPARACIÓN DE AUTORIDAD (dosier 14.1): el backend crea la partida, asigna
 * jugadores, valida reglas, autoriza el comienzo y guarda el resultado. La
 * autoridad LOCAL durante la ronda (inicio real, secuencia, tiempo, validación
 * de impactos) es del módulo principal. Aquí no se cronometra nada.
 */
@Injectable()
export class GamesService {
  readonly registry: GameModeRegistry = createDefaultRegistry();
  readonly engine = new GameEngine(this.registry);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
  ) {}

  /** Semilla reproducible: si no la fija el operador, se deriva del reloj. */
  private resolveSeed(seed?: number | null): number {
    if (seed !== undefined && seed !== null) {
      if (!Number.isInteger(seed) || seed < 0) {
        throw new BadRequestException('La semilla debe ser un entero no negativo');
      }
      return seed;
    }
    return Date.now() % 2_147_483_647;
  }

  /**
   * Paneles que ocupa una partida: los de su vista si juega sobre una vista
   * (G-H, Opción B), o el panel único en caso contrario.
   */
  private async panelsOf(
    game: { id: string; targetSystemId: string; viewId: string | null },
    tx: PrismaLike = this.prisma,
  ) {
    if (!game.viewId) return [game.targetSystemId];
    const panels = await tx.viewPanel.findMany({
      where: { viewId: game.viewId },
      select: { targetSystemId: true },
    });
    const ids = new Set(panels.map((p) => p.targetSystemId));
    ids.add(game.targetSystemId);
    return [...ids];
  }

  /**
   * Guardarraíl de concurrencia (G-H): un panel sólo puede estar en UNA partida
   * activa a la vez. Dos partidas simultáneas sobre el mismo hardware darían
   * órdenes contradictorias al coordinador y tiempos no fiables.
   *
   * Partidas activas = armed | running | paused. `draft`, `finished` y `aborted`
   * no ocupan panel.
   */
  async assertPanelsFree(
    game: {
      id: string;
      targetSystemId: string;
      viewId: string | null;
    },
    /** Cliente de la transacción en curso, cuando se comprueba dentro de una. */
    tx: PrismaLike = this.prisma,
  ): Promise<void> {
    const panelIds = await this.panelsOf(game, tx);
    const conflict = await tx.game.findFirst({
      where: {
        id: { not: game.id },
        status: { in: ACTIVE_GAME_STATUSES },
        OR: [
          { targetSystemId: { in: panelIds } },
          { view: { panels: { some: { targetSystemId: { in: panelIds } } } } },
        ],
      },
      select: { id: true, name: true, status: true, targetSystem: { select: { slug: true } } },
    });
    if (conflict) {
      throw new ConflictException(
        `El panel ya está ocupado por la partida ${conflict.name ?? conflict.id} (${conflict.status}). ` +
          'Finalízala o abórtala antes de empezar otra.',
      );
    }
  }

  /**
   * Cerrojo consultivo de PostgreSQL por panel, dentro de la transacción. Se
   * ordenan los identificadores para que dos transacciones que compitan por los
   * mismos paneles no se abracen (interbloqueo).
   */
  private async lockPanels(
    tx: TransactionClient,
    game: { id: string; targetSystemId: string; viewId: string | null },
  ): Promise<void> {
    const panelIds = (await this.panelsOf(game, tx as unknown as PrismaLike)).sort();
    for (const id of panelIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    }
  }

  /** Partidas activas por panel, para pintar ocupación en el panel web. */
  async panelOccupancy() {
    const games = await this.prisma.game.findMany({
      where: { status: { in: ACTIVE_GAME_STATUSES } },
      select: {
        id: true,
        name: true,
        status: true,
        targetSystemId: true,
        viewId: true,
        view: { select: { panels: { select: { targetSystemId: true } } } },
      },
    });
    const items = games.flatMap((game) => {
      const panelIds = game.viewId
        ? [...new Set([game.targetSystemId, ...game.view!.panels.map((p) => p.targetSystemId)])]
        : [game.targetSystemId];
      return panelIds.map((targetSystemId) => ({
        targetSystemId,
        gameId: game.id,
        name: game.name,
        status: game.status,
      }));
    });
    return { items, total: items.length };
  }

  async create(input: CreateGameInput) {
    if (!this.registry.has(input.mode)) {
      throw new BadRequestException(
        `Modo de juego desconocido: ${input.mode}. Disponibles: ${this.registry.keys().join(', ')}`,
      );
    }
    const gameMode = await this.prisma.gameMode.findUnique({ where: { key: input.mode } });
    if (!gameMode) {
      throw new BadRequestException(`El modo '${input.mode}' no está dado de alta en la base de datos`);
    }

    return this.prisma.game.create({
      data: {
        targetSystemId: input.target_system_id,
        gameModeId: gameMode.id,
        gamePresetId: input.preset_id ?? null,
        name: input.name ?? null,
        seed: BigInt(this.resolveSeed(input.seed)),
        config: (input.config ?? {}) as never,
        createdBy: input.created_by ?? null,
      },
    });
  }

  async get(id: string) {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { rounds: true, participants: true, gameMode: true, targetSystem: true },
    });
    if (!game) throw new NotFoundException(`Partida ${id} no encontrada`);
    return game;
  }

  /** Crea una ronda y calcula su PLAN determinista con el motor. */
  async addRound(gameId: string, input: CreateRoundInput) {
    const game = await this.get(gameId);
    const mode = input.mode ?? game.gameMode.key;
    const seed = this.resolveSeed(input.seed ?? Number(game.seed ?? 0));

    const config: RoundConfig = {
      mode,
      seed,
      targets: input.targets,
      sequence: input.sequence ?? null,
      repetitions: input.repetitions,
      intervalMs: input.interval_ms,
      countdownMs: input.countdown_ms,
      timeLimitMs: input.time_limit_ms ?? null,
      penaltyMs: input.penalty_ms,
      strictOrder: input.strict_order,
      reactionDelayMs: input.reaction_delay_ms ?? null,
    };

    // El plan se compara luego con `Module.slug` (resiliencia): si alguien lo
    // construye con UUID, nada estaría «implicado» y ninguna caída pausaría la
    // ronda, sin un solo error visible (D11). Se exige que existan de verdad.
    const referenced = [...new Set(input.targets.map((t) => t.module_id))];
    if (referenced.length > 0) {
      const known = await this.prisma.module.findMany({
        where: { slug: { in: referenced } },
        select: { slug: true },
      });
      const missing = referenced.filter((slug) => !known.some((m) => m.slug === slug));
      if (missing.length > 0) {
        throw new BadRequestException(
          `La ronda referencia módulos que no existen (por slug): ${missing.join(', ')}.`,
        );
      }
    }

    let plan;
    try {
      plan = this.engine.planRound(config);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const roundIndex = (await this.prisma.round.count({ where: { gameId } })) + 1;

    return this.prisma.round.create({
      data: {
        gameId,
        roundIndex,
        mode,
        seed: BigInt(seed),
        plan: plan as never,
        countdownMs: plan.countdownMs,
        timeLimitMs: plan.timeLimitMs,
        penaltyMs: plan.penaltyMs,
        strictOrder: plan.strictOrder,
        reactionDelayMinMs: input.reaction_delay_ms?.[0] ?? null,
        reactionDelayMaxMs: input.reaction_delay_ms?.[1] ?? null,
      },
    });
  }

  /**
   * Autoriza el comienzo: publica `start_game` al coordinador.
   * El backend NO arranca el cronómetro; sólo da la orden.
   */
  async start(gameId: string, roundId: string) {
    const game = await this.get(gameId);
    const round = game.rounds.find((r) => r.id === roundId);
    if (!round) throw new NotFoundException(`Ronda ${roundId} no pertenece a la partida ${gameId}`);

    const plan = round.plan as unknown as { activations: Array<{ targets: TargetRef[] }> } | null;
    if (!plan) throw new BadRequestException('La ronda no tiene plan calculado');

    // Una partida terminada o abortada no se reabre desde aquí: volvería a
    // ocupar el panel una partida que el operador daba por cerrada.
    if (!STARTABLE_GAME_STATUSES.includes(game.status as never)) {
      throw new ConflictException(
        `No se puede empezar una ronda de una partida en estado '${game.status}'.`,
      );
    }

    const targets = Array.from(
      new Map(
        plan.activations
          .flatMap((a) => a.targets)
          .map((t) => [`${t.module_id}#${t.target_index}`, t]),
      ).values(),
    );

    // Guardarraíl G-H, atómico: cerrojo por panel, comprobación de ocupación,
    // marcado y ORDEN al coordinador dentro de la misma transacción. Si publicar
    // LANZA, la transacción revierte. Ojo: sin conexión con el broker, mqtt.js
    // encola en vez de lanzar; ese caso no revierte y se informa con
    // `delivered: false` para que el panel no dé por hecho que la orden salió.
    let command!: ReturnType<MqttService['sendSystemCommand']>;
    await this.prisma.$transaction(async (tx) => {
      await this.lockPanels(tx as unknown as TransactionClient, game);
      await this.assertPanelsFree(game, tx as unknown as PrismaLike);
      await tx.game.update({
        where: { id: gameId },
        data: { status: 'running', startedAt: new Date() },
      });
      await tx.round.update({
        where: { id: roundId },
        data: { phase: 'countdown', startedAt: new Date() },
      });
      command = this.mqtt.sendSystemCommand(
        game.targetSystem.slug,
        'start_game',
        {
        game: {
          game_id: game.id,
          round_id: round.id,
          mode: round.mode,
          countdown_ms: round.countdownMs,
          time_limit_ms: round.timeLimitMs,
          penalty_ms: round.penaltyMs,
          strict_order: round.strictOrder,
          targets,
          sequence: round.mode === 'sequence' ? plan.activations.map((a) => a.targets[0]) : null,
          reaction_delay_ms:
            round.reactionDelayMinMs !== null && round.reactionDelayMaxMs !== null
              ? [round.reactionDelayMinMs, round.reactionDelayMaxMs]
              : null,
            seed: Number(round.seed ?? 0),
          },
        },
        10000,
      );
    });

    return {
      command,
      delivered: (command as { delivered?: boolean }).delivered === true,
      note:
        (command as { delivered?: boolean }).delivered === true
          ? null
          : 'La orden no llegó al broker MQTT: el coordinador puede no haberla recibido.',
    };
  }

  /** Órdenes de control: pausar, reanudar, abortar, finalizar. */
  async control(gameId: string, action: ControlAction) {
    if (!CONTROL_ACTIONS.includes(action)) {
      throw new BadRequestException(
        `Orden de control desconocida: '${action}'. Admitidas: ${CONTROL_ACTIONS.join(', ')}.`,
      );
    }
    const game = await this.get(gameId);

    // Transiciones válidas: una orden sobre una partida que no está en el estado
    // adecuado no se envía al coordinador (antes se enviaba siempre).
    const allowedFrom: Record<ControlAction, string[]> = {
      pause_game: ['running'],
      resume_game: ['paused'],
      abort_game: ['armed', 'running', 'paused'],
      end_game: ['armed', 'running', 'paused'],
    };
    if (!allowedFrom[action].includes(game.status)) {
      throw new ConflictException(
        `No se puede ejecutar '${action}' sobre una partida en estado '${game.status}'.`,
      );
    }
    // Reanudar vuelve a ocupar el panel: si mientras estaba pausada/abortada
    // arrancó otra partida ahí, no se puede reanudar sobre el mismo hardware.
    if (action === 'resume_game') {
      await this.assertPanelsFree(game);
    }

    const command = this.mqtt.sendSystemCommand(game.targetSystem.slug, action, {}, 10000);

    const status =
      action === 'pause_game'
        ? 'paused'
        : action === 'resume_game'
          ? 'running'
          : action === 'abort_game'
            ? 'aborted'
            : 'finished';

    await this.prisma.game.update({
      where: { id: gameId },
      data: {
        status,
        finishedAt: status === 'finished' || status === 'aborted' ? new Date() : undefined,
      },
    });
    const delivered = (command as { delivered?: boolean }).delivered === true;
    return {
      command,
      status,
      delivered,
      note: delivered
        ? null
        : 'La orden no llegó al broker MQTT: el coordinador puede no haberla recibido.',
    };
  }
}
