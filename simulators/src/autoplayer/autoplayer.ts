import type { Clock } from '../clock.js';
import type { ModuleSimulator } from '../domain/moduleSimulator.js';
import { topics } from '../domain/topics.js';
import type { Rng } from '../rng.js';
import type { IncomingMessage, Transport } from '../transport/types.js';

export interface AutoplayerOptions {
  systemId: string;
  transport: Transport;
  modules: Map<string, ModuleSimulator>;
  clock: Clock;
  rng: Rng;
  /** [min, max] ms de tiempo de reacción antes de golpear una diana activa. */
  reactionMs?: [number, number];
  /** Probabilidad (0..1) de golpear una diana incorrecta en vez de la activa. */
  errorRate?: number;
}

interface ActiveTargetRef {
  module_id: string;
  target_index: number;
}

/**
 * Golpea las dianas activas con un tiempo de reacción configurable, para
 * poder correr una partida completa sin intervención humana (encargo
 * WP-05, entregable 3).
 */
export class Autoplayer {
  private readonly systemId: string;
  private readonly transport: Transport;
  private readonly modules: Map<string, ModuleSimulator>;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly reactionMs: [number, number];
  private readonly errorRate: number;

  private readonly scheduled = new Set<string>();
  private currentRoundId: string | null = null;
  private stopped = false;

  constructor(opts: AutoplayerOptions) {
    this.systemId = opts.systemId;
    this.transport = opts.transport;
    this.modules = opts.modules;
    this.clock = opts.clock;
    this.rng = opts.rng;
    this.reactionMs = opts.reactionMs ?? [150, 600];
    this.errorRate = opts.errorRate ?? 0;
  }

  start(): void {
    this.transport.subscribe(topics.gameState(this.systemId), (msg) => this.onGameState(msg));
  }

  stop(): void {
    this.stopped = true;
    this.transport.unsubscribe(topics.gameState(this.systemId));
  }

  private onGameState(msg: IncomingMessage): void {
    if (this.stopped) return;
    const state = msg.payload as {
      round_id: string;
      phase: string;
      active_targets: ActiveTargetRef[];
    };

    if (state.round_id !== this.currentRoundId) {
      this.currentRoundId = state.round_id;
      this.scheduled.clear();
    }

    if (state.phase !== 'running') return;

    for (const t of state.active_targets) {
      const key = `${state.round_id}:${t.module_id}:${t.target_index}`;
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      void this.reactTo(t);
    }
  }

  private async reactTo(target: ActiveTargetRef): Promise<void> {
    const delayMs = this.rng.int(this.reactionMs[0], this.reactionMs[1]);
    await this.clock.sleep(delayMs);
    if (this.stopped) return;

    const module = this.modules.get(target.module_id);
    if (!module) return;

    if (this.errorRate > 0 && this.rng.chance(this.errorRate)) {
      const wrong = this.pickWrongTarget(module, target.target_index);
      if (wrong !== null) {
        await module.hitTarget(wrong);
        return;
      }
    }
    await module.hitTarget(target.target_index);
  }

  private pickWrongTarget(module: ModuleSimulator, correctIndex: number): number | null {
    const candidates = module
      .getTargetsSnapshot()
      .filter((t) => t.target_index !== correctIndex && t.enabled);
    if (candidates.length === 0) return null;
    return this.rng.pick(candidates).target_index;
  }
}
