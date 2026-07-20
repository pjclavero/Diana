import { describe, expect, it } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import type { HitEventPayload } from '../src/domain/types.js';
import { loadScenario } from '../src/scenarios/loader.js';
import { runScenario } from '../src/scenarios/runner.js';

function scenarioPath(file: string): string {
  return new URL(`../scenarios/${file}`, import.meta.url).pathname;
}

describe('escenarios declarativos obligatorios (encargo WP-05, entregable 2)', () => {
  it('01: alta de 9 módulos — los 9 quedan online y ready, con presencia retenida', async () => {
    const scenario = loadScenario(scenarioPath('01-alta-9-modulos.json'));
    const sim = await runScenario(scenario, { clock: new VirtualClock() });

    expect(sim.modules.size).toBe(9);
    for (const m of sim.modules.values()) {
      expect(m.getState()).toBe('ready');
      expect(m.isConnected()).toBe(true);
    }

    const retained = sim.getBroker()!.retainedSnapshot();
    for (let i = 1; i <= 9; i++) {
      const id = `module-${String(i).padStart(2, '0')}`;
      const presence = retained.get(`targets/v1/module/${id}/presence`) as
        | { payload: { online: boolean } }
        | undefined;
      expect(presence?.payload.online).toBe(true);
      const status = retained.get(`targets/v1/module/${id}/status`) as
        | { payload: { state: string; targets: unknown[] } }
        | undefined;
      expect(status?.payload.state).toBe('ready');
      expect(status?.payload.targets).toHaveLength(9);
    }
  });

  it('02: partida aleatoria completa — agota las 27 dianas sin intervención humana', async () => {
    const scenario = loadScenario(scenarioPath('02-partida-aleatoria-completa.json'));
    const sim = await runScenario(scenario, { clock: new VirtualClock() });
    const states = sim.coordinator!.getGameStates() as { phase: string; targets_hit: number }[];
    const last = states[states.length - 1];
    expect(last?.phase).toBe('finished');
    expect(last?.targets_hit).toBe(27);
  });

  it('03: penalización por impacto incorrecto — hit_on_safe genera penalty_applied y no puntúa', async () => {
    const scenario = loadScenario(scenarioPath('03-penalizacion-impacto-incorrecto.json'));
    const sim = await runScenario(scenario, { clock: new VirtualClock() });

    const events = sim.coordinator!.getGameEvents() as { kind: string; detail?: string }[];
    const penalty = events.find((e) => e.kind === 'penalty_applied');
    expect(penalty).toBeDefined();
    expect(penalty?.detail).toBe('hit_on_safe');

    const states = sim.coordinator!.getGameStates() as { phase: string; penalties: number; targets_hit: number }[];
    const afterWrong = states.find((s) => s.penalties === 1);
    expect(afterWrong).toBeDefined();

    const last = states[states.length - 1];
    expect(last?.phase).toBe('finished');
    expect(last?.targets_hit).toBe(1);
    expect(last?.penalties).toBe(1);
  });

  it('04: duplicados — el mismo event_id reenviado no se cuenta dos veces', async () => {
    const scenario = loadScenario(scenarioPath('04-duplicados.json'));
    const sim = await runScenario(scenario, { clock: new VirtualClock() });

    expect(sim.coordinator!.getDuplicatesSeen()).toBe(2);

    const history = sim.getBroker()!.history();
    const hitMessages = history.filter((m) => m.topic === 'targets/v1/module/module-01/hit');
    const rawHits = hitMessages.filter((m) => (m.payload as HitEventPayload).coordinator === null);
    // 1 original + 2 duplicados reenviados = 3 mensajes crudos con el mismo event_id.
    expect(rawHits).toHaveLength(3);
    const eventIds = new Set(rawHits.map((m) => (m.payload as HitEventPayload).event_id));
    expect(eventIds.size).toBe(1);

    const states = sim.coordinator!.getGameStates() as { targets_hit: number }[];
    const last = states[states.length - 1];
    expect(last?.targets_hit).toBe(1); // no 3
  });

  it('05: desconexión + reconexión — la cola local se reenvía con replay=true', async () => {
    const scenario = loadScenario(scenarioPath('05-desconexion-reconexion-cola.json'));
    const sim = await runScenario(scenario, { clock: new VirtualClock() });

    const m2 = sim.modules.get('module-02')!;
    expect(m2.isConnected()).toBe(true);
    expect(m2.getQueueDepth()).toBe(0); // ya vaciada tras reconectar

    const history = sim.getBroker()!.history();
    const hits = history.filter((m) => m.topic === 'targets/v1/module/module-02/hit');
    // 2 impactos crudos reenviados desde la cola (replay=true) + 2 versiones
    // consolidadas por el coordinador (module-01 es principal en este escenario).
    const raw = hits.filter((m) => (m.payload as HitEventPayload).coordinator === null);
    const consolidated = hits.filter((m) => (m.payload as HitEventPayload).coordinator !== null);
    expect(raw).toHaveLength(2);
    expect(consolidated).toHaveLength(2);
    const replayed = raw.filter((m) => (m.payload as HitEventPayload).replay === true);
    expect(replayed).toHaveLength(2);

    // El LWT debió dispararse al perder la conexión: presencia retenida con reason=lwt
    // en algún punto de la historia (antes de la reconexión, que la vuelve a poner online).
    const presenceMsgs = history.filter((m) => m.topic === 'targets/v1/module/module-02/presence');
    const sawLwt = presenceMsgs.some(
      (m) => (m.payload as { online: boolean; reason: string }).reason === 'lwt',
    );
    expect(sawLwt).toBe(true);
  });

  it('06: conflicto de dos módulos PRINCIPAL — visible en module-status (role=principal duplicado)', async () => {
    const scenario = loadScenario(scenarioPath('06-conflicto-doble-principal.json'));
    const sim = await runScenario(scenario, { clock: new VirtualClock() });

    const retained = sim.getBroker()!.retainedSnapshot();
    const principals = ['module-01', 'module-02', 'module-03']
      .map((id) => retained.get(`targets/v1/module/${id}/status`))
      .filter((m) => (m as { payload: { role: string } } | undefined)?.payload.role === 'principal');

    expect(principals).toHaveLength(2);
    // El simulador no decide el conflicto (es responsabilidad del backend, WP-02):
    // aquí sólo comprobamos que la situación es observable por los dos módulos.
    expect(sim.coordinator).toBeNull();
  });
});
