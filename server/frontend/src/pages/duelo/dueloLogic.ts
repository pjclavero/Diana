/**
 * Lógica pura de la práctica de duelo (G-E). Misma regla que el backend
 * (`domain/game/duelo.ts`): gana quien tiene **más aciertos** y, a igualdad,
 * **menor tiempo**. Sin estado externo ni E/S.
 */

export interface DueloPlayerResult {
  name: string;
  hits: number;
  timeMs: number;
}

export interface DueloRankEntry extends DueloPlayerResult {
  position: number;
}

export interface DueloRanking {
  ranking: DueloRankEntry[];
  winners: string[];
}

/** Ordena por más aciertos y, a igualdad, menor tiempo. Empates comparten posición. */
export function rankPlayers(players: DueloPlayerResult[]): DueloRanking {
  const sorted = [...players].sort((a, b) => (a.hits !== b.hits ? b.hits - a.hits : a.timeMs - b.timeMs));

  const ranking: DueloRankEntry[] = [];
  let position = 0;
  let prevKey: string | null = null;
  sorted.forEach((p, index) => {
    const key = `${p.hits}|${p.timeMs}`;
    if (key !== prevKey) position = index + 1;
    ranking.push({ ...p, position });
    prevKey = key;
  });

  const winners = ranking.filter((r) => r.position === 1).map((r) => r.name);
  return { ranking, winners };
}
