import { ApiError } from "./client";
import { getToken } from "../auth/tokenStore";

/** API REAL del marcador de partida estilo máquina de dardos (G-G). */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function req<T>(path: string): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new ApiError("No se puede contactar con el servidor.");
  }
  if (res.status === 401 || res.status === 403) throw new ApiError("No tiene permiso para esta acción.");
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string | string[] };
      detail = (Array.isArray(body.message) ? body.message[0] : body.message) ?? "";
    } catch {
      /* sin cuerpo */
    }
    throw new ApiError(detail || "El servidor no ha podido completar la operación.");
  }
  return (await res.json()) as T;
}

/**
 * POST con detalle del servidor conservado. A diferencia de `req`, aquí sí
 * importa la razón exacta del rechazo (partida en curso, panel ajeno…): decirle
 * al operador «no tiene permiso» cuando el motivo es otro le haría perder el
 * tiempo.
 */
async function post<T>(path: string): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new ApiError("No se puede contactar con el servidor.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string | string[] };
      detail = (Array.isArray(body.message) ? body.message[0] : body.message) ?? "";
    } catch {
      /* sin cuerpo */
    }
    if (detail) throw new ApiError(detail);
    if (res.status === 401 || res.status === 403) throw new ApiError("No tiene permiso para esta acción.");
    throw new ApiError("El servidor no ha podido completar la operación.");
  }
  return (await res.json()) as T;
}

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
  return req(`/scoreboard/games/${gameId}${roundId ? `?round_id=${roundId}` : ""}`);
}

export function getParticipantHistory(participantId: string): Promise<ParticipantHistory> {
  return req(`/scoreboard/participants/${participantId}`);
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
  return post(`/statistics/games/${gameId}/participants/${participantId}/reset`);
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
  const page = await req<{ items: RecentGame[] }>("/games?take=25");
  return page.items;
}
