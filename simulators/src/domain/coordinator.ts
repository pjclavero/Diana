import type { Clock } from '../clock.js';
import { assertValid } from '../contracts/ajv.js';
import { seededUuid } from '../ids.js';
import { Rng } from '../rng.js';
import type { IncomingMessage, Transport } from '../transport/types.js';
import type { ModuleSimulator } from './moduleSimulator.js';
import { topics } from './topics.js';
import type { HitEventPayload } from './types.js';

export type GameMode = 'random' | 'sequence' | 'all_against_clock' | 'reaction';

export interface GameTargetRef {
  module_id: string;
  target_index: number;
}

export interface StartGameOptions {
  gameId: string;
  roundId: string;
  mode: GameMode;
  targets: GameTargetRef[];
  sequence?: GameTargetRef[] | null;
  penaltyMs?: number;
  strictOrder?: boolean;
  reactionDelayMs?: [number, number] | null;
  seed?: number;
}

/**
 * El principal es la autoridad local de partida (dosier §14.1): activa
 * dianas, consolida impactos (rellena `coordinator` en el hit-event),
 * calcula `elapsed_us` y publica game/state + game/event. El servidor
 * (fuera de este paquete) es sólo autoridad administrativa.
 *
 * Se comunica exclusivamente por MQTT (module-command, hit, game/state,
 * game/event), igual que lo haría el firmware real, para que la lógica de
 * consolidación pueda probarse también contra un Mosquitto de verdad.
 */
export class Coordinator {
  private readonly systemId: string;
  private readonly coordinatorModuleId: string;
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly rng: Rng;

  /** Módulos conocidos localmente por el orquestador de la simulación (no es "trampa": en
   * un backend real el coordinador sólo vería sus mensajes MQTT; aquí se usa
   * únicamente para poder aplicar clock_offset_us por módulo de forma determinista). */
  private readonly knownModules = new Map<string, ModuleSimulator>();

  private readonly seenEventIds = new Set<string>();
  private duplicatesSeen = 0;

  private game: {
    gameId: string;
    roundId: string;
    mode: GameMode;
    phase: 'armed' | 'countdown' | 'running' | 'paused' | 'finished' | 'aborted';
    /** Dianas de la ronda que aún no se han acertado (activas o pendientes de activar). */
    remaining: GameTargetRef[];
    /** Subconjunto de `remaining` realmente encendido ahora mismo en los módulos. */
    active: GameTargetRef[];
    hitCount: number;
    penalties: number;
    penaltyMs: number;
    roundStartDeviceUs: number | null;
    rng: Rng;
  } | null = null;

  private readonly events: HitEventPayload[] = [];
  private readonly gameEvents: unknown[] = [];
  private readonly gameStates: unknown[] = [];

  constructor(opts: {
    systemId: string;
    coordinatorModuleId: string;
    transport: Transport;
    clock: Clock;
    rng: Rng;
  }) {
    this.systemId = opts.systemId;
    this.coordinatorModuleId = opts.coordinatorModuleId;
    this.transport = opts.transport;
    this.clock = opts.clock;
    this.rng = opts.rng;

    this.transport.subscribe(topics.allModuleHits(), (msg) => this.onHit(msg));
    this.transport.subscribe(topics.systemCommand(this.systemId), (msg) => this.onSystemCommand(msg));
  }

  registerModule(module: ModuleSimulator): void {
    this.knownModules.set(module.moduleId, module);
  }

  getGameEvents(): readonly unknown[] {
    return this.gameEvents;
  }

  getGameStates(): readonly unknown[] {
    return this.gameStates;
  }

  getDuplicatesSeen(): number {
    return this.duplicatesSeen;
  }

  private clockOffsetFor(moduleId: string): number {
    if (moduleId === this.coordinatorModuleId) return 0;
    // Offset determinista y estable por módulo, derivado de la semilla:
    // simula el desfase de reloj satélite-principal medido en el arranque.
    const r = this.rng.fork(`offset-${moduleId}`);
    return r.int(-500, 500);
  }

  // ---------------------------------------------------------------- comandos de sistema

  private async onSystemCommand(msg: IncomingMessage): Promise<void> {
    const payload = msg.payload as Record<string, unknown>;
    const action = payload.action as string;
    const game = payload.game as
      | {
          game_id: string;
          round_id: string;
          mode: GameMode;
          targets: GameTargetRef[];
          sequence?: GameTargetRef[] | null;
          penalty_ms?: number;
          strict_order?: boolean;
          reaction_delay_ms?: [number, number] | null;
          seed?: number;
        }
      | undefined;

    switch (action) {
      case 'arm_game':
        if (game) {
          await this.armGame({
            gameId: game.game_id,
            roundId: game.round_id,
            mode: game.mode,
            targets: game.targets,
            sequence: game.sequence ?? null,
            penaltyMs: game.penalty_ms ?? 0,
            strictOrder: game.strict_order ?? false,
            reactionDelayMs: game.reaction_delay_ms ?? null,
            seed: game.seed,
          });
        }
        break;
      case 'start_game':
        await this.startArmedGame();
        break;
      case 'pause_game':
        await this.pauseGame();
        break;
      case 'resume_game':
        await this.resumeGame();
        break;
      case 'abort_game':
        await this.abortGame();
        break;
      case 'end_game':
        await this.finishGame('round_finished');
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- ciclo de partida

  async armGame(opts: StartGameOptions): Promise<void> {
    const pool = opts.mode === 'sequence' && opts.sequence ? opts.sequence.slice() : opts.targets.slice();
    this.game = {
      gameId: opts.gameId,
      roundId: opts.roundId,
      mode: opts.mode,
      phase: 'armed',
      remaining: pool,
      active: [],
      hitCount: 0,
      penalties: 0,
      penaltyMs: opts.penaltyMs ?? 0,
      roundStartDeviceUs: null,
      // Semilla propia de la ronda (dosier: "seed" en system-command.game),
      // independiente de la semilla raíz del simulador, para que el orden
      // de activación en modo 'random' sea reproducible por partida.
      rng: opts.seed !== undefined ? new Rng(opts.seed) : this.rng.fork(`game-${opts.gameId}`),
    };
    if (opts.strictOrder) {
      const byModule = new Map<string, number[]>();
      for (const t of pool) {
        const arr = byModule.get(t.module_id) ?? [];
        arr.push(t.target_index);
        byModule.set(t.module_id, arr);
      }
      for (const [moduleId, order] of byModule) {
        this.knownModules.get(moduleId)?.setStrictOrder(order);
      }
    }
    for (const m of this.knownModules.values()) m.setModuleState('game_prepare');
    await this.publishGameState('armed');
    await this.publishGameEvent('round_armed', null);
  }

  async startArmedGame(): Promise<void> {
    if (!this.game) return;
    this.game.phase = 'countdown';
    for (const m of this.knownModules.values()) m.setModuleState('game_countdown');
    await this.publishGameState('countdown');
    await this.publishGameEvent('countdown_started', null);

    this.game.phase = 'running';
    this.game.roundStartDeviceUs = this.clock.nowUs();
    for (const m of this.knownModules.values()) m.setModuleState('game_active');

    // Las dianas se activan (module-command aplicado de verdad) ANTES de
    // anunciar game/state=running: así ningún consumidor (autojugador
    // incluido) puede ver "activo" en el estado de partida antes de que el
    // módulo físico haya aplicado el cambio.
    if (this.game.mode === 'all_against_clock') {
      await this.activateAll();
    } else {
      await this.activateNext();
    }

    await this.publishGameState('running');
    await this.publishGameEvent('round_started', null);
  }

  async pauseGame(): Promise<void> {
    if (!this.game) return;
    this.game.phase = 'paused';
    for (const m of this.knownModules.values()) m.setModuleState('game_paused');
    await this.publishGameState('paused');
    await this.publishGameEvent('round_paused', null);
  }

  async resumeGame(): Promise<void> {
    if (!this.game) return;
    this.game.phase = 'running';
    for (const m of this.knownModules.values()) m.setModuleState('game_active');
    await this.publishGameState('running');
    await this.publishGameEvent('round_resumed', null);
  }

  async abortGame(): Promise<void> {
    if (!this.game) return;
    this.game.phase = 'aborted';
    await this.publishGameState('aborted');
    await this.publishGameEvent('round_aborted', null);
    this.game = null;
  }

  private async finishGame(kind: 'round_finished'): Promise<void> {
    if (!this.game) return;
    this.game.phase = 'finished';
    for (const m of this.knownModules.values()) m.setModuleState('game_finished');
    await this.publishGameState('finished');
    await this.publishGameEvent(kind, null);
    this.game = null;
  }

  /**
   * Activa la siguiente diana pendiente (modos random/sequence/reaction:
   * una sola diana activa a la vez). `remaining` sólo pierde el elemento
   * cuando se acierta; `active` es el subconjunto realmente encendido, y es
   * lo único que se anuncia como tal en game/state.
   */
  private async activateNext(): Promise<void> {
    if (!this.game) return;
    if (this.game.remaining.length === 0) {
      await this.finishGame('round_finished');
      return;
    }
    // Modo 'sequence': respeta el orden explícito (siempre el primero).
    // Modo 'random' (y por defecto): elige al azar con la semilla de la
    // ronda, para que "se activa una diana al azar" (dosier §16.1) sea
    // reproducible por semilla y no dependa del orden de inserción.
    const index = this.game.mode === 'random' ? this.game.rng.int(0, this.game.remaining.length - 1) : 0;
    const next = this.game.remaining[index];
    if (!next) {
      await this.finishGame('round_finished');
      return;
    }
    this.game.active = [next];
    await this.sendSetTargets(next.module_id, [{ target_index: next.target_index, state: 'active' }]);
    await this.publishGameEvent('target_activated', null, next);
  }

  private async activateAll(): Promise<void> {
    if (!this.game) return;
    this.game.active = this.game.remaining.slice();
    const byModule = new Map<string, number[]>();
    for (const t of this.game.remaining) {
      const arr = byModule.get(t.module_id) ?? [];
      arr.push(t.target_index);
      byModule.set(t.module_id, arr);
    }
    for (const [moduleId, indices] of byModule) {
      await this.sendSetTargets(
        moduleId,
        indices.map((target_index) => ({ target_index, state: 'active' as const })),
      );
    }
    await this.publishGameEvent('target_activated', null);
  }

  private async sendSetTargets(
    moduleId: string,
    targets: { target_index: number; state: 'active' | 'safe' }[],
  ): Promise<void> {
    const commandId = seededUuid(this.rng.fork(`cmd-${moduleId}-${this.clock.nowUs()}-${this.rng.next()}`));
    const payload = {
      schema_version: 1,
      command_id: commandId,
      issued_at_ms: Math.floor(this.clock.nowUs() / 1000),
      expires_in_ms: 5000,
      nonce: Math.floor(this.clock.nowUs()),
      issuer: 'coordinator',
      module_id: moduleId,
      action: 'set_targets',
      params: { targets },
    };
    assertValid('module-command.schema.json', payload);
    await this.transport.publish(topics.moduleCommand(moduleId), payload, { qos: 1, retain: false });
  }

  // ---------------------------------------------------------------- consolidación de impactos

  private onHit(msg: IncomingMessage): Promise<void> {
    const hit = msg.payload as HitEventPayload;
    // El propio coordinador reenvía hits consolidados en el mismo tópico: no
    // los reconsolida ni cuenta como duplicado si coordinator ya está relleno.
    if (hit.coordinator !== null) return Promise.resolve();
    return this.consolidateHit(hit);
  }

  private async consolidateHit(hit: HitEventPayload): Promise<void> {
    const isDuplicate = this.seenEventIds.has(hit.event_id);
    if (isDuplicate) {
      this.duplicatesSeen += 1;
      return; // idempotencia (ADR-0003): un duplicado se cuenta, no se reprocesa.
    }
    this.seenEventIds.add(hit.event_id);
    this.events.push(hit);

    const offset = this.clockOffsetFor(hit.module_id);
    const recvUs = this.clock.nowUs();
    const roundStart = this.game?.roundStartDeviceUs ?? hit.device.event_us;
    const elapsedUs = Math.max(0, hit.device.event_us + offset - roundStart);

    const consolidated: HitEventPayload = {
      ...hit,
      coordinator: {
        recv_us: recvUs,
        elapsed_us: elapsedUs,
        clock_offset_us: offset,
        offset_uncertainty_us: 50,
      },
    };
    assertValid('hit-event.schema.json', consolidated);
    await this.transport.publish(topics.moduleHit(hit.module_id), consolidated, {
      qos: 1,
      retain: false,
    });

    if (hit.classification === 'crosstalk_rejected') {
      return; // diagnóstico, no puntúa (README §2, hitClassification).
    }

    if (!this.game || this.game.phase !== 'running') return;

    if (hit.classification === 'valid_hit') {
      this.game.hitCount += 1;
      const isSame = (t: GameTargetRef) =>
        t.module_id === hit.module_id && t.target_index === hit.target_index;
      this.game.remaining = this.game.remaining.filter((t) => !isSame(t));
      this.game.active = this.game.active.filter((t) => !isSame(t));
      await this.publishGameEvent('target_hit', hit.event_id, {
        module_id: hit.module_id,
        target_index: hit.target_index,
      });

      if (this.game.remaining.length === 0) {
        await this.finishGame('round_finished');
      } else {
        // Activa la siguiente diana (module-command aplicado) ANTES de
        // anunciar el nuevo game/state, por la misma razón que en
        // startArmedGame(): ningún consumidor debe ver "activo" antes de
        // que sea cierto de verdad.
        if (this.game.mode !== 'all_against_clock') {
          await this.activateNext();
        }
        await this.publishGameState(this.game.phase);
      }
    } else {
      this.game.penalties += 1;
      await this.publishGameEvent(
        'penalty_applied',
        hit.event_id,
        { module_id: hit.module_id, target_index: hit.target_index },
        hit.classification,
      );
      await this.publishGameState(this.game.phase);
    }
  }

  // ---------------------------------------------------------------- publicaciones

  private async publishGameState(phase: NonNullable<typeof this.game>['phase']): Promise<void> {
    if (!this.game) return;
    const payload = {
      schema_version: 1,
      system_id: this.systemId,
      game_id: this.game.gameId,
      round_id: this.game.roundId,
      phase,
      mode: this.game.mode,
      coordinator_module_id: this.coordinatorModuleId,
      elapsed_us:
        this.game.roundStartDeviceUs !== null
          ? Math.max(0, this.clock.nowUs() - this.game.roundStartDeviceUs)
          : 0,
      targets_remaining: this.game.remaining.length,
      targets_hit: this.game.hitCount,
      penalties: this.game.penalties,
      active_targets: this.game.active.map((t) => ({
        module_id: t.module_id,
        target_index: t.target_index,
        state: 'active' as const,
      })),
      device: {
        boot_id: this.knownModules.get(this.coordinatorModuleId)?.getBootId() ?? seededUuid(this.rng),
        uptime_us: this.clock.nowUs(),
        event_us: this.clock.nowUs(),
      },
    };
    assertValid('game-state.schema.json', payload);
    this.gameStates.push(payload);
    await this.transport.publish(topics.gameState(this.systemId), payload, { qos: 1, retain: true });
  }

  private async publishGameEvent(
    kind:
      | 'round_armed'
      | 'countdown_started'
      | 'round_started'
      | 'target_activated'
      | 'target_hit'
      | 'penalty_applied'
      | 'round_paused'
      | 'round_resumed'
      | 'round_finished'
      | 'round_aborted'
      | 'coordinator_lost'
      | 'module_lost',
    hitEventId: string | null,
    target?: GameTargetRef,
    detail?: string,
  ): Promise<void> {
    if (!this.game) return;
    const payload = {
      schema_version: 1,
      system_id: this.systemId,
      event_id: seededUuid(this.rng.fork(`gevt-${kind}-${this.clock.nowUs()}-${this.rng.next()}`)),
      game_id: this.game.gameId,
      round_id: this.game.roundId,
      kind,
      coordinator_module_id: this.coordinatorModuleId,
      elapsed_us:
        this.game.roundStartDeviceUs !== null
          ? Math.max(0, this.clock.nowUs() - this.game.roundStartDeviceUs)
          : 0,
      device: {
        boot_id: this.knownModules.get(this.coordinatorModuleId)?.getBootId() ?? seededUuid(this.rng),
        uptime_us: this.clock.nowUs(),
        event_us: this.clock.nowUs(),
      },
      ...(hitEventId ? { hit_event_id: hitEventId } : {}),
      ...(target ? { module_id: target.module_id, target_index: target.target_index } : {}),
      ...(detail ? { detail } : {}),
    };
    assertValid('game-event.schema.json', payload);
    this.gameEvents.push(payload);
    await this.transport.publish(topics.gameEvent(this.systemId), payload, { qos: 1, retain: false });
  }
}
