import { describe, expect, it, vi } from 'vitest';
import { VirtualClock } from '../src/clock.js';
import { Simulation } from '../src/simulation.js';
import { MqttJsTransport } from '../src/transport/mqttjsTransport.js';

describe('H-06: client_id MQTT == module_id, sin prefijo', () => {
  it('Simulation construye el transporte real con clientId === moduleId', () => {
    const sim = new Simulation({
      systemId: 'system-a',
      seed: 1,
      clock: new VirtualClock(),
      mqtt: { url: 'mqtt://example.invalid:1883' },
    });
    // No conectamos de verdad (no hay broker); sólo comprobamos cómo se
    // construye el transporte, que es lo que fija la convención de ACL.
    const spy = vi.spyOn(MqttJsTransport.prototype, 'connect').mockResolvedValue();
    const m = sim.addModule({ moduleId: 'module-07' });
    expect(m.moduleId).toBe('module-07');
    // El transporte interno de la Simulation para este módulo debe tener
    // exactamente ese clientId (sin prefijo "diana-", "sim-", etc.).
    const transport = (sim as unknown as { transports: Map<string, { clientId: string }> }).transports.get(
      'module-07',
    );
    expect(transport?.clientId).toBe('module-07');
    spy.mockRestore();
  });
});

describe('H-05: caducidad de comandos desde issued_at_ms y nonce persistente', () => {
  it('el nonce por emisor persiste a través de reboot() (igual que local_sequence)', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 2, clock: new VirtualClock() });
    const [m] = sim.addDefaultModules(1);
    await sim.bootAll();

    const clock = sim.getClock();
    const nowMs = () => Math.floor(clock.nowUs() / 1000);

    async function sendSetAllTargets(commandId: string, nonce: number) {
      const payload = {
        schema_version: 1,
        command_id: commandId,
        issued_at_ms: nowMs(),
        expires_in_ms: 5000,
        nonce,
        issuer: 'coordinator',
        module_id: 'module-01',
        action: 'set_all_targets',
        params: { state: 'safe' },
      };
      await sim
        .getBroker()!
        .publish('test-harness', 'targets/v1/module/module-01/command', payload, { qos: 1, retain: false });
    }

    await sendSetAllTargets('aaaaaaaa-0000-4000-8000-aaaaaaaaaa01', 10);
    await sim.settle();
    let status = sim.getBroker()!.retainedSnapshot().get('targets/v1/module/module-01/status')!
      .payload as { last_command: { result: string } | null };
    expect(status.last_command?.result).toBe('accepted');

    // Reinicio del módulo: boot_id cambia, pero el nonce de "coordinator" (10)
    // debe seguir vigente (persistido, como local_sequence).
    await m!.reboot();
    await sim.settle();

    // Un nonce <= 10 tras el reinicio debe rechazarse (reproducción).
    await sendSetAllTargets('bbbbbbbb-0000-4000-8000-bbbbbbbbbb02', 10);
    await sim.settle();
    status = sim.getBroker()!.retainedSnapshot().get('targets/v1/module/module-01/status')!.payload as {
      last_command: { result: string } | null;
    };
    expect(status.last_command?.result).toBe('rejected');

    // Un nonce mayor sí se acepta tras el reinicio.
    await sendSetAllTargets('cccccccc-0000-4000-8000-cccccccccc03', 11);
    await sim.settle();
    status = sim.getBroker()!.retainedSnapshot().get('targets/v1/module/module-01/status')!.payload as {
      last_command: { result: string } | null;
    };
    expect(status.last_command?.result).toBe('accepted');
  });

  it('un comando caduca por issued_at_ms, no por el instante de recepción', async () => {
    const sim = new Simulation({ systemId: 'system-a', seed: 3, clock: new VirtualClock() });
    sim.addDefaultModules(1);
    await sim.bootAll();

    const clock = sim.getClock();
    const issuedAtMs = Math.floor(clock.nowUs() / 1000);
    // El reloj avanza más allá de expires_in_ms ANTES de que el mensaje "llegue"
    // (simulado con un sleep): la caducidad debe medirse desde issued_at_ms.
    await clock.sleep(6000);

    const payload = {
      schema_version: 1,
      command_id: 'dddddddd-0000-4000-8000-dddddddddd01',
      issued_at_ms: issuedAtMs,
      expires_in_ms: 5000,
      nonce: 1,
      issuer: 'coordinator',
      module_id: 'module-01',
      action: 'set_all_targets',
      params: { state: 'safe' },
    };
    await sim
      .getBroker()!
      .publish('test-harness', 'targets/v1/module/module-01/command', payload, { qos: 1, retain: false });
    await sim.settle();

    const status = sim.getBroker()!.retainedSnapshot().get('targets/v1/module/module-01/status')!.payload as {
      last_command: { result: string } | null;
    };
    expect(status.last_command?.result).toBe('expired');
  });
});
