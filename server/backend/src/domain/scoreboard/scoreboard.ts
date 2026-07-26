import { rankDuelo } from '../game/duelo';

/**
 * Marcador estilo máquina de dardos (G-G). Puro y determinista: mezcla los
 * RESULTADOS de la partida, la ESTADÍSTICA del jugador y el ESTADO VISUAL de
 * las dianas (acertada o no).
 *
 * Regla de honestidad: lo que no se puede calcular no se inventa. Mientras la
 * ronda está viva no hay `Result`, así que el marcador se deriva de los impactos
 * y se marca `provisional`; la precisión sólo se muestra cuando el backend la ha
 * calculado de verdad (`accuracy_status === 'computed'`).
 */

export interface ScoreboardParticipant {
  id: string;
  slot: number;
  playerId: string | null;
  displayName: string | null;
  guestName: string | null;
  teamName: string | null;
}

export interface ScoreboardHit {
  participantId: string | null;
  moduleSlug: string;
  targetIndex: number;
  classification: string;
  countsForScore: boolean;
  elapsedUs: number | null;
}

export interface ScoreboardResult {
  participantId: string;
  validHits: number;
  invalidHits: number;
  totalTimeUs: number | null;
  penaltiesMs: number;
  accuracyValid: number | null;
  accuracyStatus: string;
}

export interface ScoreboardEntry {
  participantId: string;
  name: string;
  temporary: boolean;
  teamName: string | null;
  validHits: number;
  invalidHits: number;
  totalTimeUs: number | null;
  penaltiesMs: number;
  accuracyValid: number | null;
  /** Sin resultado consolidado: el dato sale de los impactos y puede cambiar. */
  provisional: boolean;
  position: number;
}

export function participantName(p: ScoreboardParticipant): string {
  return p.displayName ?? p.guestName ?? `Jugador ${p.slot}`;
}

/**
 * Fila de marcador por participante. Si hay `Result` manda el resultado
 * consolidado; si no, se cuenta a partir de los impactos (provisional).
 */
export function buildRanking(
  participants: ScoreboardParticipant[],
  results: ScoreboardResult[],
  hits: ScoreboardHit[],
): ScoreboardEntry[] {
  const byParticipant = new Map(results.map((r) => [r.participantId, r]));

  const rows = participants.map((p) => {
    const result = byParticipant.get(p.id);
    const own = hits.filter((h) => h.participantId === p.id);
    const valid = own.filter((h) => h.countsForScore);
    // Tiempo vivo: el último impacto válido conocido (T2 del coordinador).
    const liveTime = valid.reduce<number | null>(
      (max, h) => (h.elapsedUs === null ? max : max === null ? h.elapsedUs : Math.max(max, h.elapsedUs)),
      null,
    );
    return {
      participantId: p.id,
      name: participantName(p),
      temporary: p.playerId === null,
      teamName: p.teamName,
      validHits: result ? result.validHits : valid.length,
      invalidHits: result ? result.invalidHits : own.length - valid.length,
      totalTimeUs: result ? result.totalTimeUs : liveTime,
      penaltiesMs: result ? result.penaltiesMs : 0,
      // La precisión sólo es real si el backend la ha podido calcular.
      accuracyValid: result && result.accuracyStatus === 'computed' ? result.accuracyValid : null,
      provisional: !result,
      position: 0,
    };
  });

  // Mismo criterio que el duelo: más aciertos válidos y, a igualdad, menor tiempo.
  const { ranking } = rankDuelo(
    rows.map((r) => ({
      playerId: r.participantId,
      summary: { validHits: r.validHits, totalTimeUs: r.totalTimeUs },
    })),
  );
  const positionOf = new Map(ranking.map((r) => [r.playerId, r.position]));

  return rows
    .map((r) => ({ ...r, position: positionOf.get(r.participantId) ?? 0 }))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export interface BoardTargetCell {
  targetIndex: number;
  /** hit = acierto válido · invalid = impacto no puntuable · pending = sin tocar */
  state: 'hit' | 'invalid' | 'pending';
  hits: number;
  /** Motivo del último impacto no válido, tal cual lo clasificó el backend. */
  lastClassification: string | null;
}

export interface BoardModule {
  moduleSlug: string;
  x: number | null;
  y: number | null;
  targets: BoardTargetCell[];
}

export interface BoardModuleInput {
  moduleSlug: string;
  x: number | null;
  y: number | null;
  targetIndexes: number[];
}

/**
 * Estado visual de las dianas: por módulo y diana, si se ha acertado, si el
 * impacto no contó, o si sigue pendiente.
 */
export function buildBoard(modules: BoardModuleInput[], hits: ScoreboardHit[]): BoardModule[] {
  return modules.map((module) => ({
    moduleSlug: module.moduleSlug,
    x: module.x,
    y: module.y,
    targets: [...module.targetIndexes]
      .sort((a, b) => a - b)
      .map((targetIndex) => {
        const own = hits.filter(
          (h) => h.moduleSlug === module.moduleSlug && h.targetIndex === targetIndex,
        );
        const valid = own.filter((h) => h.countsForScore);
        const last = own[own.length - 1] ?? null;
        return {
          targetIndex,
          state: valid.length > 0 ? 'hit' : own.length > 0 ? 'invalid' : 'pending',
          hits: own.length,
          lastClassification: valid.length > 0 ? null : (last?.classification ?? null),
        } as BoardTargetCell;
      }),
  }));
}
