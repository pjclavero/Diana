import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import { loadScenario } from '../src/scenarios/loader.js';
import { runScenario } from '../src/scenarios/runner.js';

describe('escenario: partida aleatoria completa', () => {
  it('agota las 27 dianas y llega a finished', async () => {
    const scenario = loadScenario(
      new URL('../scenarios/02-partida-aleatoria-completa.json', import.meta.url).pathname,
    );
    const sim = await runScenario(scenario, { clock: new VirtualClock() });
    const states = sim.coordinator!.getGameStates() as { phase: string; targets_hit: number }[];
    const last = states[states.length - 1];
    expect(last?.phase).toBe('finished');
    expect(last?.targets_hit).toBeGreaterThan(0);
  });
});
