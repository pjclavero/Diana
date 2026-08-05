import { EventEmitter } from 'node:events';

/**
 * Fija, a nivel de `MqttService` (no de un mock), que
 * `sendModuleMaintenanceCommand` publica en `module/{id}/maintenance/command`
 * y NUNCA en `module/{id}/command`. `test/modules/module-diagnostics.spec.ts`
 * ya fija que el SERVICIO de F6 llama al método correcto; esta prueba cierra
 * el otro extremo — que ese método, de verdad, escribe en el tópico del
 * broker que toca. Sin esto, alguien podría "arreglar" `MqttService` para
 * que `sendModuleMaintenanceCommand` reescriba en `moduleCommand()` y ningún
 * test de F6 (que mockea `MqttService` entero) lo detectaría.
 */
class FakeClient extends EventEmitter {
  connected = true;
  subscribe = jest.fn((_f: string, _o: unknown, cb?: (e?: Error) => void) => cb?.());
  end = jest.fn((_force?: boolean, _o?: unknown, cb?: () => void) => cb?.());
  publish = jest.fn(
    (
      _topic: string,
      _msg: string,
      _opts: unknown,
      cb?: (error?: Error & { code?: number }, packet?: { reasonCode?: number }) => void,
    ) => {
      cb?.(undefined, { reasonCode: 0 });
    },
  );
}

const client = new FakeClient();
jest.mock('mqtt', () => ({ connect: () => client }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { MqttService } from '../../src/modules/mqtt/mqtt.service';
import { ContractValidator } from '../../src/contracts/contract-validator';

function build() {
  const config = {
    mqtt: {
      enabled: true,
      url: 'mqtt://broker:1883',
      clientId: 'backend',
      username: null,
      password: null,
      publishAckTimeoutMs: 50,
    },
  } as never;
  const validator = new ContractValidator();
  const ingest = { handleMessage: jest.fn().mockResolvedValue({}) } as never;
  const prisma = { incident: { create: jest.fn().mockResolvedValue({}) } } as never;
  const service = new MqttService(config, validator, ingest, prisma);
  return { service };
}

describe('MqttService.sendModuleMaintenanceCommand · tópico real del broker', () => {
  beforeEach(() => {
    client.publish.mockClear();
  });

  it('publica en targets/v1/module/{id}/maintenance/command', async () => {
    const { service } = build();
    await service.onModuleInit();

    await service.sendModuleMaintenanceCommand(
      'mod-a',
      'identify',
      { actor_type: 'operator', actor_id: 'op-1' },
      { duration_ms: 4000 },
    );

    expect(client.publish).toHaveBeenCalledTimes(1);
    const [topic] = client.publish.mock.calls[0];
    expect(topic).toBe('targets/v1/module/mod-a/maintenance/command');
  });

  it('el tópico NUNCA es targets/v1/module/{id}/command (canal de juego)', async () => {
    const { service } = build();
    await service.onModuleInit();

    await service.sendModuleMaintenanceCommand(
      'mod-a',
      'led_test',
      { actor_type: 'user', actor_id: 'u-1' },
      { duration_ms: 3000, target_index: 2 },
    );

    const [topic] = client.publish.mock.calls[0];
    expect(topic).not.toBe('targets/v1/module/mod-a/command');
  });

  it('el payload publicado cumple module-maintenance-command.schema.json de verdad', async () => {
    const { service } = build();
    await service.onModuleInit();

    await service.sendModuleMaintenanceCommand(
      'mod-a',
      'self_test',
      { actor_type: 'operator', actor_id: 'op-1' },
    );

    const [, rawPayload] = client.publish.mock.calls[0];
    const payload = JSON.parse(rawPayload as string);
    expect(payload).toMatchObject({ module_id: 'mod-a', command_type: 'self_test' });
    expect(payload).toHaveProperty('request_id');
    expect(payload).not.toHaveProperty('issuer'); // campo de module-command, no de este esquema
  });
});
