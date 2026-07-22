import { GameEngine, RoundSummary } from '../../src/domain/game/engine';
import { createDefaultRegistry } from '../../src/domain/game/registry';
import { rankDuelo } from '../../src/domain/game/duelo';
import { RoundConfig, TargetRef } from '../../src/domain/game/types';

function nine(moduleId: string): TargetRef[] {
  return Array.from({ length: 9 }, (_, i) => ({ module_id: moduleId, target_index: i + 1 }));
}

function engine(): GameEngine {
  return new GameEngine(createDefaultRegistry());
}

/** Corre el plan completo acertando siempre la diana activa; base = µs del primer impacto. */
function playPerfect(cfg: RoundConfig, stepUs: number, baseUs = 0): RoundSummary {
  const e = engine();
  const plan = e.planRound(cfg);
  const state = e.createState(plan);
  let t = baseUs;
  for (let step = 0; step < plan.activations.length; step++) {
    const target = plan.activations[step].targets[0];
    e.applyHit(state, { target, elapsedUs: t, firmwareClassification: 'valid_hit' });
    t += stepUs;
  }
  return e.summarise(state);
}

describe('Modo duelo (G-E)', () => {
  const seed = 20260722;

  it('está registrado en el motor', () => {
    expect(engine().planRound({ mode: 'duelo', seed, targets: nine('m1') }).mode).toBe('duelo');
  });

  it('con la misma semilla, dos jugadores reciben el MISMO orden de posiciones (espejo)', () => {
    const p1 = engine().planRound({ mode: 'duelo', seed, targets: nine('jugador-1') });
    const p2 = engine().planRound({ mode: 'duelo', seed, targets: nine('jugador-2') });
    const idx1 = p1.activations.map((a) => a.targets[0].target_index);
    const idx2 = p2.activations.map((a) => a.targets[0].target_index);
    expect(idx1).toEqual(idx2);
    // Pero cada uno sobre sus propios módulos.
    expect(p1.activations[0].targets[0].module_id).toBe('jugador-1');
    expect(p2.activations[0].targets[0].module_id).toBe('jugador-2');
  });

  it('acertar la diana activa cuenta; golpear otra en orden estricto no avanza y penaliza', () => {
    const e = engine();
    const plan = e.planRound({ mode: 'duelo', seed, targets: nine('m1'), penaltyMs: 1500 });
    const state = e.createState(plan);
    const active = plan.activations[0].targets[0];
    const wrongIdx = active.target_index === 1 ? 2 : 1;

    const ok = e.applyHit(state, { target: active, elapsedUs: 1000, firmwareClassification: 'valid_hit' });
    expect(ok.countsForScore).toBe(true);
    expect(state.step).toBe(1);

    const bad = e.applyHit(state, { target: { module_id: 'm1', target_index: wrongIdx }, elapsedUs: 2000, firmwareClassification: 'valid_hit' });
    expect(bad.countsForScore).toBe(false);
    expect(bad.classification).toBe('out_of_order');
    expect(state.penaltiesMs).toBe(1500);
  });

  it('un jugador que completa perfecto suma 9 aciertos y un tiempo total', () => {
    const s = playPerfect({ mode: 'duelo', seed, targets: nine('m1') }, 500_000);
    expect(s.validHits).toBe(9);
    expect(s.finished).toBe(true);
    expect(s.totalTimeUs).not.toBeNull();
  });
});

describe('rankDuelo (ganador del duelo)', () => {
  it('gana quien tiene más aciertos, aunque sea más lento', () => {
    const r = rankDuelo([
      { playerId: 'rápido-pocos', summary: { validHits: 5, totalTimeUs: 1_000_000 } },
      { playerId: 'lento-muchos', summary: { validHits: 9, totalTimeUs: 9_000_000 } },
    ]);
    expect(r.winners).toEqual(['lento-muchos']);
    expect(r.ranking[0].position).toBe(1);
  });

  it('a igualdad de aciertos, gana el de menor tiempo', () => {
    const r = rankDuelo([
      { playerId: 'lento', summary: { validHits: 9, totalTimeUs: 8_000_000 } },
      { playerId: 'rápido', summary: { validHits: 9, totalTimeUs: 6_000_000 } },
    ]);
    expect(r.winners).toEqual(['rápido']);
    expect(r.ranking.map((x) => x.playerId)).toEqual(['rápido', 'lento']);
  });

  it('empate exacto (mismos aciertos y tiempo) → dos ganadores en la posición 1', () => {
    const r = rankDuelo([
      { playerId: 'a', summary: { validHits: 7, totalTimeUs: 5_000_000 } },
      { playerId: 'b', summary: { validHits: 7, totalTimeUs: 5_000_000 } },
      { playerId: 'c', summary: { validHits: 3, totalTimeUs: null } },
    ]);
    expect(r.winners.sort()).toEqual(['a', 'b']);
    expect(r.ranking.find((x) => x.playerId === 'a')!.position).toBe(1);
    expect(r.ranking.find((x) => x.playerId === 'b')!.position).toBe(1);
    // c queda en posición 3 (ranking de competición 1,1,3).
    expect(r.ranking.find((x) => x.playerId === 'c')!.position).toBe(3);
  });

  it('un jugador sin tiempo (no completó) queda por detrás de quien sí puntuó', () => {
    const r = rankDuelo([
      { playerId: 'incompleto', summary: { validHits: 0, totalTimeUs: null } },
      { playerId: 'completo', summary: { validHits: 9, totalTimeUs: 7_000_000 } },
    ]);
    expect(r.winners).toEqual(['completo']);
  });
});
