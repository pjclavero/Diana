import { apiRequestAs } from "./typedRequest";

/**
 * API REAL del marcador de partida estilo máquina de dardos (G-G).
 *
 * MIGRADO a la puerta del contrato. Prioridad: `listRecentGames` desenvuelve
 * `{items}` de `/api/games` (fallo silencioso de tabla vacía).
 *
 * El POST de reinicio de estadística conserva su semántica de error propia
 * (`preferServerDetail`): aquí SÍ importa la razón exacta del rechazo
 * («partida en curso», «panel ajeno»), y decirle al operador «no tiene
 * permiso» cuando el motivo es otro le haría perder el tiempo. Antes eso
 * exigía una segunda función de `fetch` a mano; ahora es una opción de la
 * puerta, así que la excepción está declarada en vez de duplicada.
 */

export interface ScoreboardEntry {
  participantId: string;
  name: string;
  temporary: boolean;
  teamName: string | null;
  /** null = no se sabe (impactos sin atribuir); NO es un cero. */
  validHits: number | null;
  invalidHits: number | null;
  totalTimeUs: number | null;
  penaltiesMs: number | null;
  accuracyValid: number | null;
  provisional: boolean;
  attributed: boolean;
  /** true = aciertos DEDUCIDOS (único jugador), no medidos por jugador. */
  inferred: boolean;
  position: number | null;
}

export interface BoardTarget {
  targetIndex: number;
  state: "hit" | "invalid" | "pending";
  hits: number;
  lastClassification: string | null;
}

export interface BoardModule {
  moduleSlug: string;
  targetSystemId: string;
  panelName: string;
  x: number | null;
  y: number | null;
  targets: BoardTarget[];
}

export interface Scoreboard {
  game: {
    id: string;
    name: string | null;
    status: string;
    mode: { key: string; name: string };
    panel: { id: string; slug: string; name: string };
  };
  round: { id: string; index: number; phase: string; mode: string } | null;
  panels: string[];
  multiPanel: boolean;
  ranking: ScoreboardEntry[];
  /** Avisos del backend que hay que enseñar tal cual (huecos declarados). */
  warnings: string[];
  board: BoardModule[];
  totals: {
    detected: number;
    valid: number;
    invalid: number;
    unattributed: number;
    inferred: number;
  };
}

export interface ParticipantHistory {
  participantId: string;
  name: string;
  temporary: boolean;
  note: string | null;
  history: {
    playerId: string;
    rounds: number;
    totalValidHits: number;
    averageAccuracyValid: number | null;
    roundsWithoutAccuracy: number;
    bestTimeUs: number | null;
    recent: {
      roundId: string;
      validHits: number;
      invalidHits: number;
      totalTimeUs: number | null;
      accuracyValid: number | null;
      computedAt: string;
    }[];
  } | null;
}

export function getScoreboard(gameId: string, roundId?: string): Promise<Scoreboard> {
  const url = roundId
    ? (`/api/scoreboard/games/${gameId}?round_id=${roundId}` as const)
    : (`/api/scoreboard/games/${gameId}` as const);
  return apiRequestAs<Scoreboard>()("/api/scoreboard/games/{gameId}", url);
}

export function getParticipantHistory(participantId: string): Promise<ParticipantHistory> {
  return apiRequestAs<ParticipantHistory>()(
    "/api/scoreboard/participants/{participantId}",
    `/api/scoreboard/participants/${participantId}`,
  );
}

/** Resultado del reinicio de estadística de un jugador en una partida (§3.4). */
export interface StatsResetOutcome {
  gameId: string;
  participantId: string;
  participantIds: string[];
  playerId: string | null;
  playerName: string;
  temporary: boolean;
  selfReset: boolean;
  deleted: { results: number; penalties: number; shotCounts: number; statistics: number };
  /** Impactos que dejan de estar atribuidos. NO se borran. */
  hitsDetached: number;
  aggregatesPendingRecompute: number;
  notes: string[];
}

/** Reinicia la estadística de ese jugador EN ESA partida. Sólo gestor/admin. */
export function resetParticipantStats(gameId: string, participantId: string): Promise<StatsResetOutcome> {
  return apiRequestAs<StatsResetOutcome>()<
    "/api/statistics/games/{gameId}/participants/{participantId}/reset",
    "post"
  >(
    "/api/statistics/games/{gameId}/participants/{participantId}/reset",
    `/api/statistics/games/${gameId}/participants/${participantId}/reset`,
    { method: "POST", preferServerDetail: true },
  );
}

export interface RecentGame {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  gameMode?: { name: string };
}

/** Partidas recientes, para elegir cuál marcador mirar. */
export async function listRecentGames(): Promise<RecentGame[]> {
  const page = await apiRequestAs<{ items: RecentGame[] }>()("/api/games", "/api/games?take=25");
  return page.items;
}
