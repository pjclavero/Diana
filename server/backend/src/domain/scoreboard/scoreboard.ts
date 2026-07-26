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
  /** `null` = no se puede saber: los impactos no están atribuidos a jugadores. */
  validHits: number | null;
  invalidHits: number | null;
  totalTimeUs: number | null;
  /** `null` mientras no haya resultado consolidado: las penalizaciones no se cuentan en vivo. */
  penaltiesMs: number | null;
  accuracyValid: number | null;
  /** Sin resultado consolidado: el dato sale de los impactos y puede cambiar. */
  provisional: boolean;
  /** false = fila sin datos atribuibles; NO es un cero. */
  attributed: boolean;
  /** `null` cuando la fila no es clasificable (sin datos atribuidos). */
  position: number | null;
}

export interface ScoreboardRanking {
  entries: ScoreboardEntry[];
  /** Impactos de la ronda que no se pueden asignar a ningún jugador. */
  unattributedHits: number;
  /** Avisos que la pantalla DEBE mostrar; nunca se rellena un hueco en silencio. */
  warnings: string[];
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
): ScoreboardRanking {
  const byParticipant = new Map(results.map((r) => [r.participantId, r]));
  const warnings: string[] = [];

  // El impacto MQTT no dice de quién es: hoy el sistema no ata impacto a jugador
  // (`HitEvent.participantId` queda a NULL). Con un solo participante la
  // atribución es inequívoca; con varios, NO se reparte a ojo.
  const unattributed = hits.filter((h) => h.participantId === null);
  const soleParticipant = participants.length === 1 ? participants[0].id : null;
  const effectiveHits: ScoreboardHit[] =
    soleParticipant === null
      ? hits
      : hits.map((h) => (h.participantId === null ? { ...h, participantId: soleParticipant } : h));

  const unattributedRemaining = effectiveHits.filter((h) => h.participantId === null).length;
  if (unattributedRemaining > 0) {
    warnings.push(
      `${unattributedRemaining} impacto(s) de esta ronda no están atribuidos a ningún jugador: ` +
        'el marcador en vivo no puede repartirlos. Los aciertos por jugador se sabrán al ' +
        'consolidarse el resultado de la ronda.',
    );
  }

  const rows: ScoreboardEntry[] = participants.map((p) => {
    const result = byParticipant.get(p.id);
    const own = effectiveHits.filter((h) => h.participantId === p.id);
    const valid = own.filter((h) => h.countsForScore);
    // Tiempo vivo: el último impacto válido conocido (T2 del coordinador).
    const liveTime = valid.reduce<number | null>(
      (max, h) => (h.elapsedUs === null ? max : max === null ? h.elapsedUs : Math.max(max, h.elapsedUs)),
      null,
    );
    // Sin resultado y sin ningún impacto suyo mientras hay impactos sin atribuir:
    // no se sabe cuánto lleva. Cero sería mentira.
    const unknown = !result && own.length === 0 && unattributedRemaining > 0;

    return {
      participantId: p.id,
      name: participantName(p),
      temporary: p.playerId === null,
      teamName: p.teamName,
      validHits: result ? result.validHits : unknown ? null : valid.length,
      invalidHits: result ? result.invalidHits : unknown ? null : own.length - valid.length,
      totalTimeUs: result ? result.totalTimeUs : unknown ? null : liveTime,
      // Las penalizaciones sólo se conocen al consolidar el resultado.
      penaltiesMs: result ? result.penaltiesMs : null,
      // La precisión sólo es real si el backend la ha podido calcular.
      accuracyValid: result && result.accuracyStatus === 'computed' ? result.accuracyValid : null,
      provisional: !result,
      attributed: !unknown,
      position: null,
    };
  });

  // Mezclar filas consolidadas con filas vivas compararía magnitudes distintas
  // (el tiempo vivo es el del último impacto, no el tiempo consolidado).
  const consolidated = rows.filter((r) => !r.provisional).length;
  if (consolidated > 0 && consolidated < rows.length) {
    warnings.push(
      'Clasificación mixta: hay jugadores con resultado consolidado y otros todavía en juego. ' +
        'Las posiciones no son comparables hasta que termine la ronda.',
    );
  }

  // Sólo se clasifica lo que tiene datos; el resto queda sin posición, al final.
  const rankable = rows.filter((r) => r.attributed);
  const { ranking } = rankDuelo(
    rankable.map((r) => ({
      playerId: r.participantId,
      summary: { validHits: r.validHits ?? 0, totalTimeUs: r.totalTimeUs },
    })),
  );
  const positionOf = new Map(ranking.map((r) => [r.playerId, r.position]));

  const entries = rows
    .map((r) => ({ ...r, position: r.attributed ? (positionOf.get(r.participantId) ?? null) : null }))
    .sort((a, b) => {
      if (a.position === null && b.position === null) return a.name.localeCompare(b.name);
      if (a.position === null) return 1;
      if (b.position === null) return -1;
      return a.position - b.position || a.name.localeCompare(b.name);
    });

  return { entries, unattributedHits: unattributed.length, warnings };
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
