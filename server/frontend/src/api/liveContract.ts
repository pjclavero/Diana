import type {
  ActiveTarget,
  GameEvent,
  GameEventKind,
  GameMode,
  GamePhase,
  GameState,
} from "../types/domain";

/**
 * Traducción del contrato MQTT al vocabulario del panel.
 *
 * Los dos extremos nunca habían llegado a hablarse (X-06), así que nadie se
 * enteró de que usan palabras distintas para lo mismo. En cuanto la conexión
 * funcionó, la diferencia dejó de ser teórica:
 *
 *  - El coordinador publica `phase: "aborted"`; el panel sólo da por terminada
 *    una partida con `finished` o `cancelled`. Una partida abortada se quedaba
 *    en pantalla como si siguiera corriendo, para siempre.
 *  - Publica `kind: "penalty_applied"`; el panel espera `penalty`.
 *
 * El desajuste de `mode` (el coordinador publicaba `all_against_clock`, el
 * panel lo llamaba `all_vs_clock`, y encima `new-game` ofrecía dos modos que
 * el motor no implementa: `memory`, `no_shoot`) se cerró aparte, en el
 * cableado de `new-game` (auditoría 2026-08-05 §4, G2): `GameMode` usa ahora
 * las claves reales del motor en todas partes, así que `mode` ya no necesita
 * traducción aquí. La tabla sigue existiendo como validación explícita de
 * las claves que el panel reconoce; lo desconocido se conserva tal cual
 * (ver `normalizeState`), no se inventa.
 *
 * TypeScript no lo veía porque el mensaje llegaba tipado como `unknown` y se
 * afirmaba con un `as`. Se traduce AQUÍ, en la frontera, y no en las pantallas.
 */

const PHASE: Record<string, GamePhase> = {
  armed: "prepare",
  countdown: "countdown",
  running: "running",
  paused: "paused",
  finished: "finished",
  aborted: "cancelled",
};

const MODE: Record<string, GameMode> = {
  random: "random",
  sequence: "sequence",
  all_against_clock: "all_against_clock",
  reaction: "reaction",
  duelo: "duelo",
};

const KIND: Record<string, GameEventKind> = {
  round_armed: "round_started",
  countdown_started: "round_started",
  round_started: "round_started",
  target_activated: "target_activated",
  target_hit: "target_hit",
  penalty_applied: "penalty",
  round_paused: "round_started",
  round_resumed: "round_started",
  round_finished: "round_finished",
  round_aborted: "game_cancelled",
  coordinator_lost: "game_cancelled",
  module_lost: "game_cancelled",
};

/**
 * Normaliza un `game/state` del contrato. `active_targets` NO es obligatorio en
 * el esquema, y la pantalla lo recorría sin comprobarlo: con un estado válido
 * sin ese campo, el panel reventaba con un `TypeError`. Faltar no es lo mismo
 * que estar vacío, pero para pintar la rejilla sí: no hay dianas que marcar.
 */
export function normalizeState(raw: unknown): GameState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.game_id !== "string") return null;
  const phase = typeof s.phase === "string" ? PHASE[s.phase] : undefined;
  const mode = typeof s.mode === "string" ? MODE[s.mode] : undefined;
  return {
    ...(s as unknown as GameState),
    // Si el vocabulario trae algo que no conocemos, se conserva tal cual en vez
    // de inventar un valor: es preferible una fase desconocida en pantalla a una
    // partida que parece estar corriendo cuando no lo está.
    phase: phase ?? (s.phase as GamePhase),
    mode: mode ?? (s.mode as GameMode),
    active_targets: Array.isArray(s.active_targets) ? (s.active_targets as ActiveTarget[]) : [],
  };
}

export function normalizeEvent(raw: unknown): GameEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  const kind = typeof e.kind === "string" ? KIND[e.kind] : undefined;
  return {
    ...(e as unknown as GameEvent),
    kind: kind ?? (e.kind as GameEventKind),
  };
}

/** ¿Esta fase da la partida por terminada? Una sola definición, no tres. */
export function isFinishedPhase(phase: GamePhase | undefined): boolean {
  return phase === "finished" || phase === "cancelled";
}
