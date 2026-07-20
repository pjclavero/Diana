import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import { Simulation } from '../src/simulation.js';

describe('smoke', () => {
  it('boots 9 modules, elige principal y juega una diana', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 42, clock: new VirtualClock() });
    sim.addDefaultModules(9);
    await sim.bootAll();

    const coordinator = sim.setPrincipal('module-01');
    sim.startAutoplayer({ reactionMs: [10, 20] });

    await sim.armAndStart({
      gameId: '11111111-1111-4111-8111-111111111111',
      roundId: '22222222-2222-4222-8222-222222222222',
      mode: 'random',
      targets: [{ module_id: 'module-01', target_index: 1 }],
      seed: 7,
    });

    await sim.settle(40);

    const states = coordinator.getGameStates() as { phase: string }[];
    const last = states[states.length - 1];
    expect(last?.phase).toBe('finished');
  });
});
