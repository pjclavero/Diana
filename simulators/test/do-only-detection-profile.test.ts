import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import { Simulation } from '../src/simulation.js';
import { validateAgainstSchema } from '../src/contracts/ajv.js';
import type { HitEventPayload } from '../src/domain/types.js';

/**
 * ADR-0007 · el simulador tiene que poder producir el evento del prototipo
 * DO-only DE VERDAD, no una aproximación con ceros. Si sólo supiera emitir el
 * perfil analógico, el contrato relajado nunca se ejercitaría contra un
 * productor y la reconciliación no estaría demostrada.
 */
function hitsOf(sim: Simulation, moduleId: string): HitEventPayload[] {
  return sim
    .getBroker()!
    .history()
    .filter((h) => h.topic === `targets/v1/module/${moduleId}/hit`)
    .map((h) => h.payload as HitEventPayload);
}

describe('perfil de detección DO-only (ADR-0007)', () => {
  it('un módulo digital emite hits válidos SIN amplitude, threshold ni noise_floor', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 4242, clock: new VirtualClock() });
    const m = sim.addModule({ moduleId: 'module-05', detectionMethod: 'digital_threshold' });
    await sim.bootAll();
    await m.applyTargetStates([{ target_index: 3, state: 'active' }]);
    await m.hitTarget(3);

    const hits = hitsOf(sim, 'module-05');
    expect(hits.length).toBeGreaterThan(0);

    for (const hit of hits) {
      const result = validateAgainstSchema('hit-event.schema.json', hit);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);

      expect(hit.detection_method).toBe('digital_threshold');
      expect(hit).not.toHaveProperty('amplitude');
      expect(hit).not.toHaveProperty('threshold');
      expect(hit).not.toHaveProperty('noise_floor');
      for (const n of hit.neighbours ?? []) {
        expect(n).not.toHaveProperty('amplitude');
        expect(typeof n.delta_us).toBe('number');
      }
    }
  });

  it('el perfil analógico sigue emitiendo la medida: los dos conviven en el mismo sistema', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 777, clock: new VirtualClock() });
    const analog = sim.addModule({ moduleId: 'module-01' });
    const digital = sim.addModule({ moduleId: 'module-02', detectionMethod: 'digital_threshold' });
    await sim.bootAll();
    await analog.applyTargetStates([{ target_index: 1, state: 'active' }]);
    await digital.applyTargetStates([{ target_index: 1, state: 'active' }]);
    await analog.hitTarget(1);
    await digital.hitTarget(1);

    const analogHits = hitsOf(sim, 'module-01');
    const digitalHits = hitsOf(sim, 'module-02');
    expect(analogHits.length).toBeGreaterThan(0);
    expect(digitalHits.length).toBeGreaterThan(0);

    for (const hit of analogHits) {
      expect(hit.detection_method).toBeUndefined();
      expect(typeof hit.amplitude).toBe('number');
      expect(validateAgainstSchema('hit-event.schema.json', hit).valid).toBe(true);
    }
    for (const hit of digitalHits) {
      expect(hit.detection_method).toBe('digital_threshold');
      expect(hit.amplitude).toBeUndefined();
      expect(validateAgainstSchema('hit-event.schema.json', hit).valid).toBe(true);
    }
  });

  it('un digital al que se le añade amplitude deja de validar: el contrato no admite datos inventados', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 99, clock: new VirtualClock() });
    const m = sim.addModule({ moduleId: 'module-07', detectionMethod: 'digital_threshold' });
    await sim.bootAll();
    await m.applyTargetStates([{ target_index: 2, state: 'active' }]);
    await m.hitTarget(2);

    const hit = hitsOf(sim, 'module-07')[0]!;
    const falsificado = { ...hit, amplitude: 0 };
    const result = validateAgainstSchema('hit-event.schema.json', falsificado);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/amplitude/);
  });
});
