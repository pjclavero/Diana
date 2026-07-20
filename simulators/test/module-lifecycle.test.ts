import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import type { HitEventPayload } from '../src/domain/types.js';
import { Simulation } from '../src/simulation.js';

describe('vibración cruzada (dosier §9.6)', () => {
  it('un impacto genera señal en vecinos con amplitud menor, clasificada crosstalk_rejected', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 111, clock: new VirtualClock() });
    const [m] = sim.addDefaultModules(1);
    await sim.bootAll();
    await m!.applyTargetStates([{ target_index: 5, state: 'active' }]);

    await m!.hitTarget(5, { amplitudeOverride: 3000 });

    const history = sim.getBroker()!.history();
    const hits = history
      .filter((h) => h.topic === 'targets/v1/module/module-01/hit')
      .map((h) => h.payload as HitEventPayload);

    const main = hits.find((h) => h.target_index === 5);
    expect(main?.classification).toBe('valid_hit');

    const crosstalk = hits.filter((h) => h.classification === 'crosstalk_rejected');
    expect(crosstalk.length).toBeGreaterThan(0);
    for (const c of crosstalk) {
      expect(c.amplitude).toBeLessThan(main!.amplitude);
      expect(c.classification_reason).toBeTruthy();
      expect(c.neighbours?.some((n) => n.target_index === 5)).toBe(true);
    }
  });
});

describe('baja tensión, reinicio y versiones de firmware distintas', () => {
  it('baja tensión genera un diagnóstico con severidad acorde', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 222, clock: new VirtualClock() });
    const [m] = sim.addDefaultModules(1);
    await sim.bootAll();
    await m!.lowVoltage(4100);

    const history = sim.getBroker()!.history();
    const diag = history.find((h) => h.topic === 'targets/v1/module/module-01/diagnostic');
    expect(diag).toBeDefined();
    const payload = diag!.payload as { kind: string; severity: string };
    expect(payload.kind).toBe('low_voltage');
    expect(payload.severity).toBe('critical');
  });

  it('reinicio: boot_id cambia, local_sequence persiste (ADR-0003)', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 333, clock: new VirtualClock() });
    const [m] = sim.addDefaultModules(1);
    await sim.bootAll();
    await m!.applyTargetStates([{ target_index: 1, state: 'active' }]);
    await m!.hitTarget(1, { suppressCrosstalk: true });

    const seqBefore = m!.getLastHitPayload()!.local_sequence;
    const bootBefore = m!.getBootId();

    await m!.reboot();
    const bootAfter = m!.getBootId();
    expect(bootAfter).not.toBe(bootBefore);

    await m!.applyTargetStates([{ target_index: 2, state: 'active' }]);
    await m!.hitTarget(2, { suppressCrosstalk: true });
    const seqAfter = m!.getLastHitPayload()!.local_sequence;
    expect(seqAfter).toBeGreaterThan(seqBefore);
  });

  it('módulos con versiones de firmware distintas conviven en la misma simulación', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 444, clock: new VirtualClock() });
    sim.addModule({ moduleId: 'module-01', firmwareVersion: '0.1.0' });
    sim.addModule({ moduleId: 'module-02', firmwareVersion: '0.2.0-rc1' });
    await sim.bootAll();

    const retained = sim.getBroker()!.retainedSnapshot();
    const s1 = retained.get('targets/v1/module/module-01/status')!.payload as { firmware_version: string };
    const s2 = retained.get('targets/v1/module/module-02/status')!.payload as { firmware_version: string };
    expect(s1.firmware_version).toBe('0.1.0');
    expect(s2.firmware_version).toBe('0.2.0-rc1');
  });
});
