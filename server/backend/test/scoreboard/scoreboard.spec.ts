import { buildBoard, buildRanking } from '../../src/domain/scoreboard/scoreboard';

const ana = {
  id: 'p1',
  slot: 1,
  playerId: 'pl1',
  displayName: 'Ana',
  guestName: null,
  teamName: 'Rojo',
};
const invitado = {
  id: 'p2',
  slot: 2,
  playerId: null,
  displayName: null,
  guestName: 'Invitado',
  teamName: null,
};

function hit(over: Partial<Parameters<typeof buildBoard>[1][number]> = {}) {
  return {
    participantId: 'p1',
    moduleSlug: 'mod-a',
    targetIndex: 1,
    classification: 'valid_hit',
    countsForScore: true,
    elapsedUs: 1000,
    ...over,
  };
}

describe('Marcador de partida (G-G) · ranking', () => {
  it('sin resultado consolidado cuenta impactos y lo marca provisional', () => {
    const { entries: ranking } = buildRanking(
      [ana, invitado],
      [],
      [
        hit({ elapsedUs: 1000 }),
        hit({ targetIndex: 2, elapsedUs: 2500 }),
        hit({ participantId: 'p2', elapsedUs: 900 }),
      ],
    );
    const anaRow = ranking.find((r) => r.participantId === 'p1')!;
    expect(anaRow.validHits).toBe(2);
    expect(anaRow.totalTimeUs).toBe(2500); // último impacto válido conocido
    expect(anaRow.provisional).toBe(true);
    expect(anaRow.position).toBe(1); // 2 aciertos > 1 acierto
  });

  it('con resultado consolidado manda el resultado, no los impactos', () => {
    const { entries: ranking } = buildRanking(
      [ana],
      [
        {
          participantId: 'p1',
          validHits: 5,
          invalidHits: 1,
          totalTimeUs: 7000,
          penaltiesMs: 500,
          accuracyValid: 0.83,
          accuracyStatus: 'computed',
        },
      ],
      [hit()],
    );
    expect(ranking[0]).toMatchObject({
      validHits: 5,
      invalidHits: 1,
      totalTimeUs: 7000,
      penaltiesMs: 500,
      accuracyValid: 0.83,
      provisional: false,
    });
  });

  it('la precisión no calculable NO se muestra como cero', () => {
    const { entries: ranking } = buildRanking(
      [ana],
      [
        {
          participantId: 'p1',
          validHits: 3,
          invalidHits: 0,
          totalTimeUs: 5000,
          penaltiesMs: 0,
          accuracyValid: 0.9,
          accuracyStatus: 'not_computable',
        },
      ],
      [],
    );
    expect(ranking[0].accuracyValid).toBeNull();
  });

  /**
   * Defecto D1 del supervisor: hoy NADIE escribe `HitEvent.participantId`, así que
   * en producción todos los impactos llegan sin dueño. Antes se mostraba «0
   * aciertos» para todos junto al recuento real de impactos: un número falso.
   */
  it('con varios jugadores e impactos SIN atribuir no inventa ceros: dice que no se sabe', () => {
    const { entries: ranking, unattributedHits, warnings } = buildRanking(
      [ana, invitado],
      [],
      [hit({ participantId: null }), hit({ participantId: null, targetIndex: 2 })],
    );
    expect(unattributedHits).toBe(2);
    for (const row of ranking) {
      expect(row.validHits).toBeNull();
      expect(row.invalidHits).toBeNull();
      expect(row.totalTimeUs).toBeNull();
      expect(row.attributed).toBe(false);
      // Y nadie sale «líder» por defecto.
      expect(row.position).toBeNull();
    }
    expect(warnings.join(' ')).toMatch(/no están atribuidos/);
  });

  it('con UN solo jugador la atribución es inequívoca: los impactos son suyos', () => {
    const { entries: ranking, warnings } = buildRanking(
      [ana],
      [],
      [hit({ participantId: null }), hit({ participantId: null, targetIndex: 2 })],
    );
    expect(ranking[0]).toMatchObject({ validHits: 2, attributed: true, position: 1 });
    expect(warnings).toEqual([]);
  });

  it('las penalizaciones en vivo son desconocidas, no cero', () => {
    const { entries: ranking } = buildRanking([ana], [], [hit()]);
    expect(ranking[0].penaltiesMs).toBeNull();
    expect(ranking[0].provisional).toBe(true);
  });

  it('avisa cuando mezcla filas consolidadas con filas todavía en juego', () => {
    const { warnings } = buildRanking(
      [ana, invitado],
      [
        { participantId: 'p1', validHits: 5, invalidHits: 0, totalTimeUs: 10_000, penaltiesMs: 0, accuracyValid: null, accuracyStatus: 'not_computable' },
      ],
      [hit({ participantId: 'p2' })],
    );
    expect(warnings.join(' ')).toMatch(/Clasificación mixta/);
  });

  it('a igualdad de aciertos gana el menor tiempo; el empate exacto comparte posición', () => {
    const { entries: ranking } = buildRanking(
      [ana, invitado],
      [
        { participantId: 'p1', validHits: 3, invalidHits: 0, totalTimeUs: 9000, penaltiesMs: 0, accuracyValid: null, accuracyStatus: 'not_computable' },
        { participantId: 'p2', validHits: 3, invalidHits: 0, totalTimeUs: 4000, penaltiesMs: 0, accuracyValid: null, accuracyStatus: 'not_computable' },
      ],
      [],
    );
    expect(ranking.map((r) => r.participantId)).toEqual(['p2', 'p1']);
    expect(ranking.map((r) => r.position)).toEqual([1, 2]);

    const { entries: empate } = buildRanking(
      [ana, invitado],
      [
        { participantId: 'p1', validHits: 2, invalidHits: 0, totalTimeUs: 4000, penaltiesMs: 0, accuracyValid: null, accuracyStatus: 'not_computable' },
        { participantId: 'p2', validHits: 2, invalidHits: 0, totalTimeUs: 4000, penaltiesMs: 0, accuracyValid: null, accuracyStatus: 'not_computable' },
      ],
      [],
    );
    expect(empate.map((r) => r.position)).toEqual([1, 1]);
  });

  it('quien no tiene ningún acierto queda el último aunque no tenga tiempo', () => {
    const { entries: ranking } = buildRanking([ana, invitado], [], [hit({ participantId: 'p1' })]);
    expect(ranking[0].participantId).toBe('p1');
    expect(ranking[1]).toMatchObject({ participantId: 'p2', validHits: 0, totalTimeUs: null });
  });

  it('identifica al temporal por su nombre de invitado y lo marca como tal', () => {
    const { entries: ranking } = buildRanking([invitado], [], []);
    expect(ranking[0]).toMatchObject({ name: 'Invitado', temporary: true });
  });

  it('un participante sin nombre cae en el nombre del puesto, no en vacío', () => {
    const { entries: ranking } = buildRanking(
      [{ id: 'p3', slot: 4, playerId: null, displayName: null, guestName: null, teamName: null }],
      [],
      [],
    );
    expect(ranking[0].name).toBe('Jugador 4');
  });
});

describe('Marcador de partida (G-G) · estado de las dianas', () => {
  const modules = [
    { moduleSlug: 'mod-a', x: 0, y: 0, targetIndexes: [3, 1, 2] },
    { moduleSlug: 'mod-b', x: 1, y: 0, targetIndexes: [1] },
  ];

  it('marca acertada, no válida y pendiente por diana', () => {
    const board = buildBoard(modules, [
      hit({ targetIndex: 1 }),
      hit({ targetIndex: 2, classification: 'hit_on_safe', countsForScore: false }),
    ]);
    expect(board[0].targets.map((t) => t.targetIndex)).toEqual([1, 2, 3]); // ordenadas
    expect(board[0].targets[0]).toMatchObject({ state: 'hit', hits: 1, lastClassification: null });
    expect(board[0].targets[1]).toMatchObject({ state: 'invalid', lastClassification: 'hit_on_safe' });
    expect(board[0].targets[2]).toMatchObject({ state: 'pending', hits: 0 });
  });

  it('un impacto inválido seguido de uno válido deja la diana como acertada', () => {
    const board = buildBoard(modules, [
      hit({ targetIndex: 1, classification: 'out_of_order', countsForScore: false }),
      hit({ targetIndex: 1 }),
    ]);
    expect(board[0].targets[0]).toMatchObject({ state: 'hit', hits: 2, lastClassification: null });
  });

  it('no mezcla impactos entre módulos con la misma diana', () => {
    const board = buildBoard(modules, [hit({ moduleSlug: 'mod-a', targetIndex: 1 })]);
    expect(board[1].targets[0].state).toBe('pending');
  });

  it('conserva la posición del módulo en la matriz (y admite que no la tenga)', () => {
    const board = buildBoard([{ moduleSlug: 'mod-c', x: null, y: null, targetIndexes: [1] }], []);
    expect(board[0]).toMatchObject({ moduleSlug: 'mod-c', x: null, y: null });
  });
});
