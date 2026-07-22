import type { RoundSummary } from './engine';

/**
 * Comparación entre jugadores de un duelo (G-E). El motor ya produce un
 * `RoundSummary` por jugador (mismo plan corrido sobre sus propios módulos); aquí
 * se decide el ganador: **más aciertos válidos y, a igualdad, menor tiempo total**.
 * Puro y determinista.
 */

export interface DueloCompetitor {
  playerId: string;
  summary: Pick<RoundSummary, 'validHits' | 'totalTimeUs'>;
}

/**
 * Control de igualdad de condiciones del duelo: es 1vs1 (o N) **a la vez** y
 * exige que **todos los jugadores tengan los mismos elementos** — el mismo número
 * de dianas/módulos. Lanza si no se cumple. Se comprueba al montar el duelo, antes
 * de generar los planes espejo. `counts` = nº de dianas de cada jugador.
 */
export function assertEqualSetup(counts: number[]): void {
  if (counts.length < 2) {
    throw new Error('Un duelo necesita al menos 2 jugadores.');
  }
  const first = counts[0];
  if (first <= 0 || counts.some((c) => c !== first)) {
    throw new Error('Duelo inválido: todos los jugadores deben tener el mismo número de dianas (mismos módulos).');
  }
}

export interface DueloRankEntry extends DueloCompetitor {
  /** Posición 1-based (ranking de competición: empates comparten posición). */
  position: number;
}

export interface DueloResult {
  ranking: DueloRankEntry[];
  /** Jugadores en la posición 1 (más de uno si hay empate exacto). */
  winners: string[];
}

/** Tiempo comparable: sin tiempo (no completó / sin acierto válido) = el peor. */
function timeOf(c: DueloCompetitor): number {
  return c.summary.totalTimeUs ?? Number.POSITIVE_INFINITY;
}

/** Clave de empate: mismo nº de aciertos Y mismo tiempo. */
function tieKey(c: DueloCompetitor): string {
  return `${c.summary.validHits}|${c.summary.totalTimeUs ?? 'inf'}`;
}

export function rankDuelo(competitors: DueloCompetitor[]): DueloResult {
  const sorted = [...competitors].sort((a, b) => {
    if (a.summary.validHits !== b.summary.validHits) return b.summary.validHits - a.summary.validHits;
    return timeOf(a) - timeOf(b);
  });

  const ranking: DueloRankEntry[] = [];
  let position = 0;
  let prevKey: string | null = null;
  sorted.forEach((c, index) => {
    const key = tieKey(c);
    // Ranking de competición estándar (1, 1, 3): sólo avanza al cambiar de clave.
    if (key !== prevKey) position = index + 1;
    ranking.push({ ...c, position });
    prevKey = key;
  });

  const winners = ranking.filter((r) => r.position === 1).map((r) => r.playerId);
  return { ranking, winners };
}
