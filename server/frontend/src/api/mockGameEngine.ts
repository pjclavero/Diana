import type {
  ActiveTarget,
  GameConfig,
  GameEvent,
  GameState,
  GameSummary,
  HitClassification,
} from "../types/domain";
import { computeAccuracy } from "../utils/accuracy";
import { MOCK_SYSTEM_ID } from "./mockData";

/**
 * Motor de partida MOCK, determinista en su secuencia de eventos (aunque el
 * ritmo temporal usa el reloj real para que la demo se sienta "en directo").
 * Sustituye al motor real del backend (WP-02) sólo para desarrollo del panel.
 */

export type GameListener = (payload: { state: GameState; event?: GameEvent }) => void;

interface Runtime {
  config: GameConfig;
  state: GameState;
  summary: GameSummary;
  timer: ReturnType<typeof setInterval> | null;
  sequenceIdx: number;
  listeners: Set<GameListener>;
  startedAt: number;
}

const TICK_MS = 1400;

function classify(index: number): HitClassification {
  // Determinista: cada 4º disparo es "hit_on_already_hit" para poblar la demo de estadísticas.
  if (index > 0 && index % 4 === 0) return "hit_on_already_hit";
  return "valid_hit";
}

class MockGameEngine {
  private games = new Map<string, Runtime>();
  private counter = 0;

  createGame(config: GameConfig): GameSummary {
    this.counter += 1;
    const gameId = `mock-game-${this.counter}`;
    const roundId = `mock-round-${this.counter}`;
    const targets = config.targets.length > 0 ? config.targets : [{ module_id: "module-01", target_index: 1 }];

    const state: GameState = {
      system_id: MOCK_SYSTEM_ID,
      game_id: gameId,
      round_id: roundId,
      phase: "idle",
      mode: config.mode,
      coordinator_module_id: "module-01",
      elapsed_us: 0,
      targets_remaining: targets.length,
      targets_hit: 0,
      penalties: 0,
      active_targets: [],
    };

    const summary: GameSummary = {
      game_id: gameId,
      system_id: MOCK_SYSTEM_ID,
      mode: config.mode,
      started_at: new Date().toISOString(),
      finished_at: null,
      phase: "idle",
      results: config.player_ids.map((playerId) => ({
        player_id: playerId,
        hits_valid: 0,
        hits_incorrect: 0,
        penalties: 0,
        total_time_ms: 0,
        accuracy: computeAccuracy({
          ammoInitial: config.ammo_initial,
          ammoRemaining: config.ammo_initial,
          ammoMustBeFullyConsumed: false,
          hitsDetected: 0,
          hitsValid: 0,
        }),
      })),
    };

    this.games.set(gameId, {
      config,
      state,
      summary,
      timer: null,
      sequenceIdx: 0,
      listeners: new Set(),
      startedAt: 0,
    });

    return summary;
  }

  private get(gameId: string): Runtime {
    const rt = this.games.get(gameId);
    if (!rt) throw new Error(`Partida ${gameId} no encontrada (mock).`);
    return rt;
  }

  subscribe(gameId: string, listener: GameListener): () => void {
    const rt = this.get(gameId);
    rt.listeners.add(listener);
    listener({ state: rt.state });
    return () => rt.listeners.delete(listener);
  }

  private broadcast(rt: Runtime, event?: GameEvent) {
    for (const l of rt.listeners) l({ state: rt.state, event });
  }

  start(gameId: string): GameState {
    const rt = this.get(gameId);
    rt.state.phase = "countdown";
    rt.summary.phase = "countdown";
    this.broadcast(rt);

    setTimeout(() => {
      if (rt.state.phase !== "countdown") return;
      rt.state.phase = "running";
      rt.summary.phase = "running";
      rt.startedAt = Date.now();
      const first = rt.config.targets[0];
      if (first) {
        rt.state.active_targets = [{ module_id: first.module_id, target_index: first.target_index, state: "active" } as ActiveTarget];
      }
      this.broadcast(rt);
      this.tick(gameId);
    }, 1200);

    return rt.state;
  }

  private tick(gameId: string) {
    const rt = this.games.get(gameId);
    if (!rt) return;
    rt.timer = setInterval(() => {
      if (rt.state.phase !== "running") return;
      const target = rt.config.targets[rt.sequenceIdx];
      if (!target) {
        this.finish(gameId);
        return;
      }
      const classification = classify(rt.sequenceIdx);
      const playerId = rt.config.player_ids[rt.sequenceIdx % Math.max(rt.config.player_ids.length, 1)] ?? "p-unknown";
      const elapsedUs = (Date.now() - rt.startedAt) * 1000;

      const event: GameEvent = {
        system_id: MOCK_SYSTEM_ID,
        event_id: `mock-evt-${gameId}-${rt.sequenceIdx}`,
        game_id: gameId,
        round_id: rt.state.round_id,
        kind: "target_hit",
        coordinator_module_id: "module-01",
        elapsed_us: elapsedUs,
        hit_event_id: `mock-hit-${gameId}-${rt.sequenceIdx}`,
        module_id: target.module_id,
        target_index: target.target_index,
        detail: classification === "valid_hit" ? "impacto válido consolidado" : "impacto sobre diana ya alcanzada",
      };

      rt.state.elapsed_us = elapsedUs;
      rt.sequenceIdx += 1;
      rt.state.targets_remaining = Math.max(rt.config.targets.length - rt.sequenceIdx, 0);
      if (classification === "valid_hit") rt.state.targets_hit += 1;
      else rt.state.penalties += 1;

      const result = rt.summary.results.find((r) => r.player_id === playerId);
      if (result) {
        if (classification === "valid_hit") result.hits_valid += 1;
        else result.hits_incorrect += 1;
        result.total_time_ms = elapsedUs / 1000;
        result.accuracy = computeAccuracy({
          ammoInitial: rt.config.ammo_initial,
          ammoRemaining: rt.config.ammo_initial !== null ? rt.config.ammo_initial - (result.hits_valid + result.hits_incorrect) : null,
          ammoMustBeFullyConsumed: false,
          hitsDetected: result.hits_valid + result.hits_incorrect,
          hitsValid: result.hits_valid,
        });
      }

      const next = rt.config.targets[rt.sequenceIdx];
      rt.state.active_targets = next ? [{ module_id: next.module_id, target_index: next.target_index, state: "active" } as ActiveTarget] : [];

      this.broadcast(rt, event);

      if (!next) this.finish(gameId);
    }, TICK_MS);
  }

  private finish(gameId: string) {
    const rt = this.games.get(gameId);
    if (!rt) return;
    if (rt.timer) clearInterval(rt.timer);
    rt.timer = null;
    rt.state.phase = "finished";
    rt.state.active_targets = [];
    rt.summary.phase = "finished";
    rt.summary.finished_at = new Date().toISOString();
    this.broadcast(rt);
  }

  pause(gameId: string): GameState {
    const rt = this.get(gameId);
    if (rt.state.phase === "running") {
      rt.state.phase = "paused";
      rt.summary.phase = "paused";
      if (rt.timer) clearInterval(rt.timer);
      rt.timer = null;
    } else if (rt.state.phase === "paused") {
      rt.state.phase = "running";
      rt.summary.phase = "running";
      this.tick(gameId);
    }
    this.broadcast(rt);
    return rt.state;
  }

  cancel(gameId: string): GameState {
    const rt = this.get(gameId);
    if (rt.timer) clearInterval(rt.timer);
    rt.timer = null;
    rt.state.phase = "cancelled";
    rt.summary.phase = "cancelled";
    rt.state.active_targets = [];
    this.broadcast(rt);
    return rt.state;
  }

  getState(gameId: string): GameState {
    return this.get(gameId).state;
  }

  getSummary(gameId: string): GameSummary {
    return this.get(gameId).summary;
  }

  finishedSummaries(): GameSummary[] {
    return [...this.games.values()].filter((r) => r.summary.phase === "finished").map((r) => r.summary);
  }
}

export const mockGameEngine = new MockGameEngine();
