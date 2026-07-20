import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import type { HitEventPayload } from '../src/domain/types.js';
import { Simulation } from '../src/simulation.js';

/**
 * H-01 (dictamen del supervisor, cerrado en contracts/mqtt/README.md §4):
 * "Ningún módulo escribe jamás en el tópico de otro módulo." Verifica que
 * el Coordinator ya no reescribe module/{satelite}/hit, y que T2 para los
 * impactos de un satélite viaja exclusivamente por game/event.
 */
describe('H-01: ningún módulo escribe en el tópico de otro', () => {
  it('un hit de satélite nunca se republica en su propio tópico; T2 viaja por game/event', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 701, clock: new VirtualClock() });
    sim.addDefaultModules(2); // module-01 = principal, module-02 = satélite
    await sim.bootAll();
    const coordinator = sim.setPrincipal('module-01');

    await sim.armAndStart({
      gameId: '11111111-7777-4777-8777-111111111101',
      roundId: '11111111-7777-4777-8777-111111111102',
      mode: 'random',
      targets: [{ module_id: 'module-02', target_index: 3 }],
      seed: 1,
    });
    await sim.settle(30);

    const m2 = sim.modules.get('module-02')!;
    await m2.hitTarget(3, { suppressCrosstalk: true });
    await sim.settle(30);

    const history = sim.getBroker()!.history();
    const hitsOnSatelliteTopic = history.filter((m) => m.topic === 'targets/v1/module/module-02/hit');
    // El único mensaje en ese tópico es el crudo del propio satélite.
    expect(hitsOnSatelliteTopic).toHaveLength(1);
    expect((hitsOnSatelliteTopic[0]!.payload as HitEventPayload).coordinator).toBeNull();
    expect((hitsOnSatelliteTopic[0]!.payload as HitEventPayload).module_id).toBe('module-02');

    // Nadie más (ni el coordinador) publica jamás en module/module-02/hit.
    const hitsOnCoordinatorTopic = history.filter((m) => m.topic === 'targets/v1/module/module-01/hit');
    expect(hitsOnCoordinatorTopic).toHaveLength(0);

    // T2 (elapsed_us consolidado) viaja en game/event, enlazado por hit_event_id.
    const rawHit = (hitsOnSatelliteTopic[0]!.payload as HitEventPayload).event_id;
    const events = coordinator.getGameEvents() as {
      kind: string;
      hit_event_id?: string;
      module_id?: string;
      elapsed_us: number;
    }[];
    const targetHitEvent = events.find((e) => e.kind === 'target_hit' && e.hit_event_id === rawHit);
    expect(targetHitEvent).toBeDefined();
    expect(targetHitEvent?.module_id).toBe('module-02');
    expect(targetHitEvent?.elapsed_us).toBeGreaterThanOrEqual(0);
  });

  it('un hit del propio coordinador SÍ puede republicarse en su propio tópico con coordinator relleno', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 702, clock: new VirtualClock() });
    sim.addDefaultModules(1);
    await sim.bootAll();
    sim.setPrincipal('module-01');

    await sim.armAndStart({
      gameId: '22222222-7777-4777-8777-222222222201',
      roundId: '22222222-7777-4777-8777-222222222202',
      mode: 'random',
      targets: [{ module_id: 'module-01', target_index: 4 }],
      seed: 1,
    });
    await sim.settle(30);

    await sim.modules.get('module-01')!.hitTarget(4, { suppressCrosstalk: true });
    await sim.settle(30);

    const history = sim.getBroker()!.history();
    const hits = history
      .filter((m) => m.topic === 'targets/v1/module/module-01/hit')
      .map((m) => m.payload as HitEventPayload);

    expect(hits.some((h) => h.coordinator === null)).toBe(true);
    expect(hits.some((h) => h.coordinator !== null)).toBe(true);
    // Mismo module_id que el propio coordinador: no es un cruce de tópicos.
    for (const h of hits) expect(h.module_id).toBe('module-01');
  });
});
