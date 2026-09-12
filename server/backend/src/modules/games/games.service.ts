import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameEngine } from '../../domain/game/engine';
import { createDefaultRegistry, GameModeRegistry } from '../../domain/game/registry';
import { RoundConfig, TargetRef } from '../../domain/game/types';
import { detectSystemConflicts } from '../../domain/systems/conflicts';
import { MqttService } from '../mqtt/mqtt.service';
import { PUBLISH_ACK_TIMEOUT_MS_DEFAULT } from '../../config/configuration';

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
 * Plazo para que el COORDINADOR confirme una orden publicando su `game/state`.
 *
 * No es el plazo del broker (ése es `MQTT_PUBLISH_ACK_TIMEOUT_MS`): es el que
 * se le da al dispositivo para decir que ha atendido la orden. Explícito y
 * visible porque acota cuánto se retiene el cerrojo del panel.
 */
export const COORDINATOR_ACCEPT_TIMEOUT_MS = 4_000;

/**
 * Plazo de la transacción de arranque. El peor caso son DOS publicaciones con
 * su PUBACK y DOS esperas de aceptación, así que el 5 s por defecto de Prisma
 * ya no da: una transacción que expira a mitad dejaría la ronda marcada sin
 * orden, o al revés. Se declara derivado, no a ojo.
 */
export const TRANSACCION_ARRANQUE_TIMEOUT_MS =
  2 * PUBLISH_ACK_TIMEOUT_MS_DEFAULT + 2 * COORDINATOR_ACCEPT_TIMEOUT_MS + 4_000;

/**
 * Subconjunto de Prisma que usa el guardarraíl: sirve tanto el cliente normal
 * como el cliente de una transacción interactiva.
 */
type TransactionClient = {
  $executeRaw: PrismaService['$executeRaw'];
  game: { findFirst: PrismaService['game']['findFirst']; update: PrismaService['game']['update'] };
  round: { update: PrismaService['round']['update'] };
  viewPanel: { findMany: PrismaService['viewPanel']['findMany'] };
  module: { findMany: PrismaService['module']['findMany'] };
  incident: { create: PrismaService['incident']['create'] };
};

type PrismaLike = {
  game: { findFirst: PrismaService['game']['findFirst'] };
  viewPanel: { findMany: PrismaService['viewPanel']['findMany'] };
};

/** Subconjunto de Prisma que exige la recomprobación de conflictos: sirve tanto el cliente normal como el de una transacción interactiva. */
type ConflictsPrismaLike = {
  module: { findMany: PrismaService['module']['findMany'] };
  incident: { create: PrismaService['incident']['create'] };
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
   * Guardarraíl del dosier 11/12: no se autoriza el comienzo si el sistema
   * tiene `dual_principal` (dos módulos EN LÍNEA declarados principal a la
   * vez). La detección es lógica pura (`detectSystemConflicts`); aquí sólo se
   * leen los módulos del panel y se deja constancia en una incidencia
   * consultable — no sólo en el log — de que un arranque quedó bloqueado.
   *
   * SE LLAMA DENTRO DE LA TRANSACCIÓN de `start()`, con el mismo patrón de
   * recomprobación que `assertPanelsFree`: leer fuera de la transacción deja
   * una ventana (adquirir el cerrojo, marcar la partida, publicar la orden —
   * esto último ahora asíncrono) en la que el rol de un módulo puede pasar a
   * `principal` por el camino de presencia MQTT y la partida arrancaría
   * igual con dos principales, justo lo que el dosier prohíbe (revisión de
   * F4: el mismo defecto, con el estado de la partida leído fuera de la
   * transacción). Se acepta el mismo límite que tiene `assertPanelsFree` hoy:
   * la lectura no toma cerrojo sobre `Module`, así que no es SERIALIZABLE
   * frente a una escritura de presencia que llegue en el mismo instante; lo
   * que sí logra es reducir la ventana de "antes de la transacción entera" a
   * "el resto de esta transacción", igual que ya asume el guardarraíl de panel.
   */
  private async assertNoStartBlockingConflicts(
    targetSystemId: string,
    tx: ConflictsPrismaLike = this.prisma,
  ): Promise<void> {
    const modules = await tx.module.findMany({
      where: { targetSystemId },
      include: { position: true },
    });
    const { conflicts, detail } = detectSystemConflicts(
      modules.map((m) => ({
        slug: m.slug,
        role: m.role,
        online: m.online,
        position: m.position ? { x: m.position.x, y: m.position.y } : null,
      })),
    );
    if (!conflicts.includes('dual_principal')) return;

    const modulesInvolved = detail.dual_principal;
    await tx.incident.create({
      data: {
        kind: 'dual_principal',
        severity: 'critical',
        source: 'games',
        targetSystemId,
        message:
          `Inicio de partida bloqueado: ${modulesInvolved.length} módulos declaran ser ` +
          `PRINCIPAL a la vez (${modulesInvolved.join(', ')}). El dosier prohíbe empezar hasta ` +
          'que el selector físico deje uno solo.',
        detail: { modules: modulesInvolved } as never,
      },
    });

    throw new ConflictException(
      `No se puede empezar: dos o más módulos están forzados como PRINCIPAL a la vez ` +
        `(${modulesInvolved.join(', ')}). Corrige el selector físico antes de arrancar.`,
    );
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

  /**
   * ¿Hay una partida activa ocupando este panel AHORA MISMO? Mismo criterio
   * de ocupación que `assertPanelsFree`/`panelOccupancy` (armed|running|paused,
   * panel propio o compartido por vista) pero sin excluir ninguna partida por
   * id: aquí no se está comprobando un conflicto de una partida NUEVA contra
   * las demás, se está respondiendo "¿está ocupado este panel, por la razón
   * que sea?" para un llamador externo (F6: el backend no puede saber si
   * `game_in_progress` se cumple sin preguntar esto antes de publicar una
   * orden de mantenimiento que ACTÚA sobre el hardware).
   */
  async isPanelOccupied(targetSystemId: string): Promise<boolean> {
    const conflict = await this.prisma.game.findFirst({
      where: {
        status: { in: ACTIVE_GAME_STATUSES },
        OR: [
          { targetSystemId },
          { view: { panels: { some: { targetSystemId } } } },
        ],
      },
      select: { id: true },
    });
    return conflict !== null;
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
  /**
   * Una orden que el broker no aceptó NO puede encadenar la siguiente.
   * `denied` es denegación de ACL; `delivered:false` es incertidumbre (encolada
   * o sin PUBACK a tiempo). En ambos casos se corta: seguir a `start_game`
   * tras un `arm_game` que quizá no salió es justo la divergencia que este
   * carril existe para impedir.
   */
  private exigirEntrega(
    resultado: { delivered?: boolean; denied?: boolean },
    accion: string,
  ): void {
    if (resultado.denied) {
      throw new ServiceUnavailableException(
        `El broker DENEGÓ '${accion}' por ACL. La ronda NO se da por iniciada.`,
      );
    }
    if (resultado.delivered !== true) {
      throw new ServiceUnavailableException(
        `'${accion}' no llegó al broker (sin PUBACK a tiempo). La ronda NO se da por iniciada.`,
      );
    }
  }

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
    // comprobación de conflictos (dosier 11/12), marcado y ORDEN al
    // coordinador dentro de la misma transacción. Si publicar LANZA, la
    // transacción revierte. Ojo: sin conexión con el broker, mqtt.js encola en
    // vez de lanzar; ese caso no revierte y se informa con `delivered: false`
    // para que el panel no dé por hecho que la orden salió.
    //
    // La publicación SIGUE DENTRO de la transacción a propósito: sacarla fuera
    // fue el defecto N-D2 de G-H (se ordenaba arrancar sin que el marcado
    // hubiera confirmado, o se ordenaba tras revertir). Lo que sí cambia es
    // que ahora la publicación ESPERA el PUBACK, y esa espera no puede ser
    // ilimitada: el cerrojo `pg_advisory_xact_lock` del panel se mantiene
    // mientras dure. El plazo lo impone `MqttService.publish`
    // (`MQTT_PUBLISH_ACK_TIMEOUT_MS`, 5 s por defecto), así que el peor caso
    // de retención del cerrojo está ACOTADO por ese plazo y un broker mudo ya
    // no puede dejar el panel bloqueado para siempre. Un ACK que no llega a
    // tiempo NO revierte: se resuelve como `delivered: false` — la misma
    // semántica de incertidumbre que ya se usaba para el encolado, porque el
    // mensaje puede acabar entregándose y revertir crearía la divergencia
    // contraria (partida no marcada, coordinador arrancado).
    let command!: Awaited<ReturnType<MqttService['sendSystemCommand']>>;
    let armado!: Awaited<ReturnType<MqttService['sendSystemCommand']>>;

    // El sobre de la partida. Va en `arm_game`, que es la orden que DECLARA la
    // partida; `start_game` sólo la enciende.
    const sobreDeJuego = {
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
    };

    await this.prisma.$transaction(async (tx) => {
      await this.lockPanels(tx as unknown as TransactionClient, game);
      // Dosier 11/12: «El sistema no permitirá iniciar una partida si detecta
      // dos módulos forzados como principal». Se recomprueba AQUÍ DENTRO, no
      // antes de la transacción: leer fuera dejaba una ventana entre la
      // lectura y el commit en la que el rol de un módulo podía pasar a
      // `principal` por presencia MQTT y la partida arrancaba igual con dos
      // principales (mismo patrón que `assertPanelsFree`, mismo defecto que
      // F4 con el estado de la partida leído fuera de la transacción).
      await this.assertNoStartBlockingConflicts(game.targetSystemId, tx as unknown as ConflictsPrismaLike);
      await this.assertPanelsFree(game, tx as unknown as PrismaLike);
      await tx.game.update({
        where: { id: gameId },
        data: { status: 'running', startedAt: new Date() },
      });
      await tx.round.update({
        where: { id: roundId },
        data: { phase: 'countdown', startedAt: new Date() },
      });
      // ── PASO 1 · ARMAR ───────────────────────────────────────────────────
      // El contrato es de DOS pasos y lo implementan igual el firmware
      // (`coordinator.c`: `start_game` exige `have_game`, que sólo pone
      // `arm_game`) y el simulador (`start_game` -> `startArmedGame()`). El
      // backend publicaba `start_game` a secas con la partida dentro: el
      // coordinador la rechazaba con INVALID y aquí se daba la ronda por
      // iniciada igual. Lo encontró el banco, no la suite.
      armado = await this.mqtt.sendSystemCommand(
        game.targetSystem.slug,
        'arm_game',
        sobreDeJuego,
        10000,
      );
      this.exigirEntrega(armado, 'arm_game');

      // ── PASO 2 · ACEPTACIÓN REAL DEL COORDINADOR ─────────────────────────
      // El PUBACK sólo dice que el broker la aceptó. Que la partida exista en
      // el dispositivo lo dice el coordinador publicando su `game/state`.
      const aceptado = await this.mqtt.esperarGameState(
        game.targetSystem.slug,
        (e) => e.round_id === round.id && e.phase === 'armed',
        COORDINATOR_ACCEPT_TIMEOUT_MS,
      );
      if (!aceptado) {
        throw new ServiceUnavailableException(
          `El coordinador no confirmó el armado de la ronda en ${COORDINATOR_ACCEPT_TIMEOUT_MS} ms ` +
            '(sin `game/state` con phase=armed para esta ronda). La ronda NO se da por iniciada.',
        );
      }

      // ── PASO 3 · ARRANCAR ────────────────────────────────────────────────
      command = await this.mqtt.sendSystemCommand(
        game.targetSystem.slug,
        'start_game',
        {},
        10000,
      );
      this.exigirEntrega(command, 'start_game');

      // ── PASO 4 · ACEPTACIÓN DEL ARRANQUE ─────────────────────────────────
      const corriendo = await this.mqtt.esperarGameState(
        game.targetSystem.slug,
        (e) => e.round_id === round.id && (e.phase === 'running' || e.phase === 'countdown'),
        COORDINATOR_ACCEPT_TIMEOUT_MS,
      );
      if (!corriendo) {
        throw new ServiceUnavailableException(
          `El coordinador no confirmó el arranque de la ronda en ${COORDINATOR_ACCEPT_TIMEOUT_MS} ms. ` +
            'La ronda NO se da por iniciada.',
        );
      }
    }, { timeout: TRANSACCION_ARRANQUE_TIMEOUT_MS, maxWait: 5_000 });

    // Si se llega aquí, las CUATRO puertas se pasaron: PUBACK de `arm_game`,
    // `game/state` con phase=armed, PUBACK de `start_game` y `game/state`
    // corriendo. Cualquier fallo anterior lanzó y revirtió la transacción, así
    // que ya no existe el caso «delivered:true con la partida sin arrancar»
    // que este carril tenía.
    return {
      command,
      armed: armado,
      delivered: true,
      denied: false,
      accepted_by_coordinator: true,
      note: null,
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

    const command = await this.mqtt.sendSystemCommand(game.targetSystem.slug, action, {}, 10000);

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
    const denied = (command as { denied?: boolean }).denied === true;
    return {
      command,
      status,
      delivered,
      denied,
      note: denied
        ? 'ATENCIÓN: el broker DENEGÓ la orden al coordinador (ACL). Hay incidencia registrada.'
        : delivered
          ? null
          : 'La orden no llegó al broker MQTT: el coordinador puede no haberla recibido.',
    };
  }
}
