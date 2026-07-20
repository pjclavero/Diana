import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import { loadScenario } from '../src/scenarios/loader.js';
import { runScenario } from '../src/scenarios/runner.js';
import { Simulation } from '../src/simulation.js';

/**
 * Encargo WP-05, "DETERMINISMO": con la misma semilla, la misma secuencia
 * exacta de eventos. Imprescindible para que WP-08/E2E puedan comparar
 * resultados contra una salida esperada.
 */
describe('determinismo por semilla', () => {
  it('la misma semilla produce exactamente la misma secuencia de mensajes', async () => {
    const scenario = loadScenario(
      new URL('../scenarios/02-partida-aleatoria-completa.json', import.meta.url).pathname,
    );

    const run1 = await runScenario(scenario, { clock: new VirtualClock() });
    const run2 = await runScenario(scenario, { clock: new VirtualClock() });

    const h1 = run1.getBroker()!.history();
    const h2 = run2.getBroker()!.history();

    expect(h1.length).toBe(h2.length);
    expect(h1.length).toBeGreaterThan(0);
    expect(JSON.stringify(h1)).toBe(JSON.stringify(h2));
  });

  it('una semilla distinta produce una secuencia distinta', async () => {
    const scenario = loadScenario(
      new URL('../scenarios/02-partida-aleatoria-completa.json', import.meta.url).pathname,
    );
    const other = { ...scenario, seed: scenario.seed + 1 };

    const run1 = await runScenario(scenario, { clock: new VirtualClock() });
    const run2 = await runScenario(other, { clock: new VirtualClock() });

    const h1 = JSON.stringify(run1.getBroker()!.history());
    const h2 = JSON.stringify(run2.getBroker()!.history());
    expect(h1).not.toBe(h2);
  });

  it('la API programática (Simulation) también es determinista con la misma semilla', async () => {
    async function play(seed: number) {
      const sim = new Simulation({ systemId: 'system-a', seed, clock: new VirtualClock() });
      sim.addDefaultModules(4);
      await sim.bootAll();
      sim.setPrincipal('module-01');
      sim.startAutoplayer({ reactionMs: [10, 40], errorRate: 0.15 });
      await sim.armAndStart({
        gameId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01',
        roundId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02',
        mode: 'random',
        targets: Array.from({ length: 4 }, (_, i) => ({
          module_id: `module-0${i + 1}`,
          target_index: 1,
        })),
        seed: 42,
      });
      await sim.settle(500);
      return JSON.stringify(sim.getBroker()!.history());
    }

    const a = await play(555);
    const b = await play(555);
    const c = await play(556);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
