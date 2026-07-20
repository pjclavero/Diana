import { describe, expect, it } from 'vitest';
import { validateAgainstSchema, type SchemaName } from '../src/contracts/ajv.js';
import { VirtualClock } from '../src/clock.js';
import { Simulation } from '../src/simulation.js';

/**
 * Encargo WP-05, entregable 5: "un test que compruebe que TODOS los
 * mensajes que el simulador emite validan contra los JSON Schema del
 * contrato". Corre un escenario rico (9 módulos, partida, comandos,
 * telemetría, diagnóstico, duplicados, reconexión) y valida cada mensaje
 * publicado contra el esquema que le corresponde según su tópico.
 */
function schemaForTopic(topic: string): SchemaName | null {
  if (/\/module\/[^/]+\/hit$/.test(topic)) return 'hit-event.schema.json';
  if (/\/module\/[^/]+\/status$/.test(topic)) return 'module-status.schema.json';
  if (/\/module\/[^/]+\/presence$/.test(topic)) return 'module-presence.schema.json';
  if (/\/module\/[^/]+\/telemetry$/.test(topic)) return 'module-telemetry.schema.json';
  if (/\/module\/[^/]+\/command$/.test(topic)) return 'module-command.schema.json';
  if (/\/module\/[^/]+\/diagnostic$/.test(topic)) return 'module-diagnostic.schema.json';
  if (/\/module\/[^/]+\/config\/(desired|reported)$/.test(topic)) return 'module-config.schema.json';
  if (/\/module\/[^/]+\/ota$/.test(topic)) return 'ota-command.schema.json';
  if (/\/system\/[^/]+\/game\/state$/.test(topic)) return 'game-state.schema.json';
  if (/\/system\/[^/]+\/game\/event$/.test(topic)) return 'game-event.schema.json';
  if (/\/system\/[^/]+\/status$/.test(topic)) return 'system-status.schema.json';
  if (/\/system\/[^/]+\/command$/.test(topic)) return 'system-command.schema.json';
  return null;
}

describe('conformidad de contratos (encargo WP-05, entregable 5)', () => {
  it('todos los mensajes de un escenario rico validan contra su esquema MQTT', async () => {
    const clock = new VirtualClock();
    const sim = new Simulation({ systemId: 'system-a', seed: 999, clock });
    sim.addDefaultModules(9);
    await sim.bootAll();
    sim.setPrincipal('module-01');
    sim.startAutoplayer({ reactionMs: [5, 15], errorRate: 0.2 });

    await sim.armAndStart({
      gameId: 'c2b1a5e0-1111-4111-9111-11111111a001',
      roundId: 'c2b1a5e0-1111-4111-9111-11111111a002',
      mode: 'random',
      targets: [
        { module_id: 'module-01', target_index: 1 },
        { module_id: 'module-02', target_index: 5 },
        { module_id: 'module-03', target_index: 9 },
      ],
      seed: 3,
    });
    await sim.settle(200);

    // Cubre también telemetría, diagnóstico y baja tensión (mensajes que no
    // aparecen en el flujo normal de partida).
    const m4 = sim.modules.get('module-04')!;
    await m4.publishTelemetry();
    await m4.lowVoltage(4200);
    await m4.killConnection();
    await m4.hitTarget(2); // se encola (desconectado)
    await m4.reconnect();
    await sim.settle(20);

    const history = sim.getBroker()!.history();
    expect(history.length).toBeGreaterThan(20);

    let checked = 0;
    let skipped = 0;
    for (const msg of history) {
      const schemaName = schemaForTopic(msg.topic);
      if (!schemaName) {
        skipped += 1;
        continue;
      }
      const result = validateAgainstSchema(schemaName, msg.payload);
      if (!result.valid) {
        throw new Error(
          `Mensaje inválido en ${msg.topic} contra ${schemaName}:\n  ${result.errors.join('\n  ')}\n` +
            JSON.stringify(msg.payload, null, 2),
        );
      }
      checked += 1;
    }

    expect(checked).toBeGreaterThan(20);
    expect(skipped).toBe(0); // todo tópico publicado por el simulador debe reconocerse
  });
});
