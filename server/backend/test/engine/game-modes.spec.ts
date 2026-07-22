import { GameEngine } from '../../src/domain/game/engine';
import { createDefaultRegistry, GameModeRegistry } from '../../src/domain/game/registry';
import { DeterministicRng } from '../../src/domain/game/rng';
import {
  GameModeStrategy,
  HitDecision,
  RoundConfig,
  RoundPlan,
  RoundRuntimeState,
  TargetRef,
  targetKey,
} from '../../src/domain/game/types';
import { ReactionModeStrategy } from '../../src/domain/game/strategies/reaction.strategy';

const NINE: TargetRef[] = Array.from({ length: 9 }, (_, i) => ({
  module_id: 'module-01',
  target_index: i + 1,
}));

function engine(): GameEngine {
  return new GameEngine(createDefaultRegistry());
}

describe('Generador determinista', () => {
  it('la misma semilla produce la misma secuencia', () => {
    const a = new DeterministicRng(20260720);
    const b = new DeterministicRng(20260720);
    const seqA = Array.from({ length: 20 }, () => a.nextInt(0, 1000));
    const seqB = Array.from({ length: 20 }, () => b.nextInt(0, 1000));
    expect(seqA).toEqual(seqB);
  });

  it('semillas distintas producen secuencias distintas', () => {
    const a = Array.from({ length: 20 }, () => new DeterministicRng(1).nextInt(0, 1000));
    const b = Array.from({ length: 20 }, () => new DeterministicRng(2).nextInt(0, 1000));
    expect(a).not.toEqual(b);
  });

  it('rechaza semillas no válidas', () => {
    expect(() => new DeterministicRng(-1)).toThrow();
    expect(() => new DeterministicRng(1.5)).toThrow();
  });
});

describe('Modo random (dosier 16.1)', () => {
  const config: RoundConfig = {
    mode: 'random',
    seed: 20260720,
    targets: NINE,
    repetitions: 6,
    penaltyMs: 2000,
  };

  it('el plan es reproducible con semilla fija', () => {
    const first = engine().planRound(config);
    const second = engine().planRound(config);
    expect(first.activations.map((a) => targetKey(a.targets[0]))).toEqual(
      second.activations.map((a) => targetKey(a.targets[0])),
    );
    expect(first.activations).toHaveLength(6);
  });

  it('nunca repite la misma diana dos veces seguidas', () => {
    const plan = engine().planRound({ ...config, repetitions: 50 });
    for (let i = 1; i < plan.activations.length; i += 1) {
      expect(targetKey(plan.activations[i].targets[0])).not.toBe(
        targetKey(plan.activations[i - 1].targets[0]),
      );
    }
  });

  it('acertar la diana activa puntúa y avanza', () => {
    const e = engine();
    const plan = e.planRound(config);
    const state = e.createState(plan);
    const decision = e.applyHit(state, {
      target: plan.activations[0].targets[0],
      elapsedUs: 500_000,
      firmwareClassification: 'valid_hit',
    });
    expect(decision.classification).toBe('valid_hit');
    expect(decision.countsForScore).toBe(true);
    expect(state.step).toBe(1);
    expect(state.validHits).toBe(1);
  });

  it('golpear una diana no activa penaliza y no avanza', () => {
    const e = engine();
    const plan = e.planRound(config);
    const state = e.createState(plan);
    const active = plan.activations[0].targets[0];
    const other = NINE.find((t) => targetKey(t) !== targetKey(active))!;

    const decision = e.applyHit(state, {
      target: other,
      elapsedUs: 300_000,
      firmwareClassification: 'valid_hit',
    });
    expect(decision.classification).toBe('hit_on_safe');
    expect(decision.penaltyMs).toBe(2000);
    expect(state.step).toBe(0);
    expect(state.validHits).toBe(0);
    expect(state.invalidHits).toBe(1);
    expect(state.penaltiesMs).toBe(2000);
  });

  it('una partida completa con semilla fija da SIEMPRE el mismo resumen', () => {
    const play = () => {
      const e = engine();
      const plan = e.planRound(config);
      const state = e.createState(plan);
      let t = 0;
      for (const activation of plan.activations) {
        t += 400_000;
        e.applyHit(state, {
          target: activation.targets[0],
          elapsedUs: t,
          firmwareClassification: 'valid_hit',
        });
      }
      return e.summarise(state);
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(a.validHits).toBe(6);
    expect(a.finished).toBe(true);
    expect(a.totalTimeUs).toBe(2_400_000);
  });
});

describe('Modo sequence (dosier 16.2)', () => {
  const sequence: TargetRef[] = [
    { module_id: 'module-01', target_index: 1 },
    { module_id: 'module-01', target_index: 5 },
    { module_id: 'module-01', target_index: 9 },
  ];
  const base: RoundConfig = {
    mode: 'sequence',
    seed: 7,
    targets: NINE,
    sequence,
    penaltyMs: 1500,
  };

  it('respeta el orden explícito', () => {
    const plan = engine().planRound(base);
    expect(plan.activations.map((a) => a.targets[0].target_index)).toEqual([1, 5, 9]);
  });

  it('sin secuencia explícita, baraja de forma reproducible', () => {
    const withoutSequence = { ...base, sequence: null };
    const a = engine().planRound(withoutSequence);
    const b = engine().planRound(withoutSequence);
    expect(a.activations.map((x) => targetKey(x.targets[0]))).toEqual(
      b.activations.map((x) => targetKey(x.targets[0])),
    );
    expect(a.activations).toHaveLength(9);
  });

  it('orden estricto: salirse del orden es out_of_order, penaliza y NO avanza', () => {
    const e = engine();
    const plan = e.planRound({ ...base, strictOrder: true });
    const state = e.createState(plan);

    const decision = e.applyHit(state, {
      target: sequence[2],
      elapsedUs: 100_000,
      firmwareClassification: 'valid_hit',
    });
    expect(decision.classification).toBe('out_of_order');
    expect(decision.penaltyMs).toBe(1500);
    expect(state.step).toBe(0);
    expect(state.validHits).toBe(0);
  });

  it('orden no estricto: se acepta una diana pendiente fuera de orden', () => {
    const e = engine();
    const plan = e.planRound({ ...base, strictOrder: false });
    const state = e.createState(plan);

    const decision = e.applyHit(state, {
      target: sequence[2],
      elapsedUs: 100_000,
      firmwareClassification: 'valid_hit',
    });
    expect(decision.classification).toBe('valid_hit');
    expect(state.validHits).toBe(1);
  });

  it('rechaza una secuencia con dianas que no participan', () => {
    expect(() =>
      engine().planRound({
        ...base,
        targets: [sequence[0]],
        sequence,
      }),
    ).toThrow(/no participante/);
  });

  it('la ronda completa en orden estricto es reproducible', () => {
    const play = () => {
      const e = engine();
      const plan = e.planRound({ ...base, strictOrder: true });
      const state = e.createState(plan);
      let t = 0;
      for (const activation of plan.activations) {
        t += 250_000;
        e.applyHit(state, {
          target: activation.targets[0],
          elapsedUs: t,
          firmwareClassification: 'valid_hit',
        });
      }
      return e.summarise(state);
    };
    expect(play()).toEqual(play());
    expect(play().validHits).toBe(3);
    expect(play().finished).toBe(true);
  });
});

describe('Modo all_against_clock (dosier 16.3)', () => {
  const config: RoundConfig = {
    mode: 'all_against_clock',
    seed: 99,
    targets: NINE.slice(0, 4),
    penaltyMs: 1000,
  };

  it('activa todas las dianas a la vez en una sola activación', () => {
    const plan = engine().planRound(config);
    expect(plan.activations).toHaveLength(1);
    expect(plan.activations[0].targets).toHaveLength(4);
    expect(plan.expectedHits).toBe(4);
  });

  it('termina cuando todas han sido alcanzadas', () => {
    const e = engine();
    const plan = e.planRound(config);
    const state = e.createState(plan);
    let t = 0;
    for (const target of plan.activations[0].targets) {
      t += 600_000;
      e.applyHit(state, { target, elapsedUs: t, firmwareClassification: 'valid_hit' });
    }
    expect(state.finished).toBe(true);
    expect(e.summarise(state).totalTimeUs).toBe(2_400_000);
  });

  it('golpear una ya alcanzada es hit_on_already_hit y penaliza', () => {
    const e = engine();
    const plan = e.planRound(config);
    const state = e.createState(plan);
    const target = plan.activations[0].targets[0];
    e.applyHit(state, { target, elapsedUs: 100_000, firmwareClassification: 'valid_hit' });
    const decision = e.applyHit(state, {
      target,
      elapsedUs: 200_000,
      firmwareClassification: 'valid_hit',
    });
    expect(decision.classification).toBe('hit_on_already_hit');
    expect(state.penaltiesMs).toBe(1000);
    expect(state.validHits).toBe(1);
  });

  it('golpear una diana no participante es hit_on_safe', () => {
    const e = engine();
    const state = e.createState(e.planRound(config));
    const decision = e.applyHit(state, {
      target: { module_id: 'module-01', target_index: 9 },
      elapsedUs: 100_000,
      firmwareClassification: 'valid_hit',
    });
    expect(decision.classification).toBe('hit_on_safe');
  });

  it('el plan no depende de la semilla (activación simultánea)', () => {
    const a = engine().planRound({ ...config, seed: 1 });
    const b = engine().planRound({ ...config, seed: 12345 });
    expect(a.activations[0].targets).toEqual(b.activations[0].targets);
  });
});

describe('Modo reaction (dosier 16.4)', () => {
  const config: RoundConfig = {
    mode: 'reaction',
    seed: 20260720,
    targets: NINE.slice(0, 3),
    repetitions: 3,
    reactionDelayMs: [1000, 4000],
    penaltyMs: 3000,
  };

  it('los retardos aleatorios son reproducibles con la semilla', () => {
    const a = engine().planRound(config);
    const b = engine().planRound(config);
    expect(a.activations.map((x) => x.activateAtMs)).toEqual(
      b.activations.map((x) => x.activateAtMs),
    );
  });

  it('los retardos caen dentro del rango pedido', () => {
    const plan = engine().planRound({ ...config, repetitions: 30 });
    let previous = 0;
    for (const activation of plan.activations) {
      const delay = activation.activateAtMs - previous;
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(4000);
      previous = activation.activateAtMs;
    }
  });

  it('el disparo anticipado penaliza, no puntúa y no cuenta como impacto detectado', () => {
    const e = engine();
    const plan = e.planRound(config);
    const state = e.createState(plan);
    const activation = plan.activations[0];

    const decision = e.applyHit(state, {
      target: activation.targets[0],
      elapsedUs: activation.activateAtMs * 1000 - 50_000,
      firmwareClassification: 'valid_hit',
    });

    expect(decision.classification).toBe('early_shot');
    expect(decision.countsForScore).toBe(false);
    expect(state.penaltiesMs).toBe(3000);
    expect(state.detectedHits).toBe(0);
    expect(state.step).toBe(0);
  });

  it('el impacto tras la activación puntúa y el tiempo de reacción es T2 - activación', () => {
    const e = engine();
    const plan = e.planRound(config);
    const state = e.createState(plan);
    const activation = plan.activations[0];
    const elapsedUs = activation.activateAtMs * 1000 + 320_000;

    const decision = e.applyHit(state, {
      target: activation.targets[0],
      elapsedUs,
      firmwareClassification: 'valid_hit',
    });

    expect(decision.classification).toBe('valid_hit');
    expect(ReactionModeStrategy.reactionTimeUs(plan, 0, elapsedUs)).toBe(320_000);
  });

  it('rechaza un rango de retardo inválido', () => {
    expect(() => engine().planRound({ ...config, reactionDelayMs: [5000, 1000] })).toThrow();
  });
});

describe('El motor respeta la clasificación del firmware', () => {
  it('crosstalk_rejected no puntúa ni penaliza', () => {
    const e = engine();
    const plan = e.planRound({ mode: 'random', seed: 1, targets: NINE, repetitions: 3, penaltyMs: 500 });
    const state = e.createState(plan);
    const decision = e.applyHit(state, {
      target: plan.activations[0].targets[0],
      elapsedUs: 100,
      firmwareClassification: 'crosstalk_rejected',
    });
    expect(decision.classification).toBe('crosstalk_rejected');
    expect(state.validHits).toBe(0);
    expect(state.detectedHits).toBe(0);
    expect(state.penaltiesMs).toBe(0);
  });
});

describe('Extensibilidad del registro de modos (encargo §10)', () => {
  class DummyModeStrategy implements GameModeStrategy {
    readonly key = 'memoria';
    readonly displayName = 'Memoria';
    readonly description = 'Modo añadido sin tocar el núcleo';
    plan(config: RoundConfig, rng: DeterministicRng): RoundPlan {
      return {
        mode: this.key,
        seed: config.seed,
        strictOrder: true,
        penaltyMs: config.penaltyMs ?? 0,
        countdownMs: 0,
        timeLimitMs: null,
        activations: rng.shuffle(config.targets).map((target, step) => ({
          step,
          targets: [target],
          activateAtMs: step * 500,
        })),
        expectedHits: config.targets.length,
      };
    }
    resolveHit(state: RoundRuntimeState): HitDecision {
      return { classification: 'valid_hit', countsForScore: true, penaltyMs: 0, advance: true, reason: null };
    }
    isComplete(state: RoundRuntimeState): boolean {
      return state.validHits >= state.plan.expectedHits;
    }
  }

  it('añadir un modo no exige tocar el motor', () => {
    const registry: GameModeRegistry = createDefaultRegistry().register(new DummyModeStrategy());
    const e = new GameEngine(registry);
    const plan = e.planRound({ mode: 'memoria', seed: 3, targets: NINE.slice(0, 3) });
    expect(plan.activations).toHaveLength(3);
    expect(registry.keys()).toEqual([
      'all_against_clock',
      'duelo',
      'memoria',
      'random',
      'reaction',
      'sequence',
    ]);
  });

  it('el registro por defecto trae los modos de la Ola 1 + duelo', () => {
    expect(createDefaultRegistry().keys()).toEqual([
      'all_against_clock',
      'duelo',
      'random',
      'reaction',
      'sequence',
    ]);
  });

  it('registrar dos veces la misma clave es un error', () => {
    expect(() => createDefaultRegistry().register(new DummyModeStrategy()).register(new DummyModeStrategy())).toThrow();
  });

  it('un modo desconocido falla con un mensaje útil', () => {
    expect(() => engine().planRound({ mode: 'inexistente', seed: 1, targets: NINE })).toThrow(/desconocido/);
  });
});
