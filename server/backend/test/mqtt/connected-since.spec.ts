import { EventEmitter } from 'node:events';

/**
 * `connectedSince` es lo que impide que el barrido de presencia confunda la
 * sordera del backend con la caída de los módulos (D1). Sin esta prueba, quitar
 * los manejadores `close`/`offline` —o ignorar `connected` en el getter— deja el
 * guardarraíl sin efecto y todas las demás suites siguen en verde.
 */
class FakeClient extends EventEmitter {
  connected = false;
  subscribe = jest.fn((_f: string, _o: unknown, cb?: (e?: Error) => void) => cb?.());
  publish = jest.fn();
  end = jest.fn((_force?: boolean, _o?: unknown, cb?: () => void) => cb?.());
}

const client = new FakeClient();
jest.mock('mqtt', () => ({ connect: () => client }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { MqttService } from '../../src/modules/mqtt/mqtt.service';

function buildService() {
  const config = {
    mqtt: { enabled: true, url: 'mqtt://broker:1883', clientId: 'backend', username: null, password: null },
  } as never;
  const validator = { validate: jest.fn(() => ({ valid: true, errors: [] })) } as never;
  const ingest = { handleMessage: jest.fn().mockResolvedValue({}) } as never;
  const prisma = { incident: { create: jest.fn().mockResolvedValue({}) } } as never;
  return new MqttService(config, validator, ingest, prisma);
}

describe('MqttService · desde cuándo estamos oyendo (D1)', () => {
  beforeEach(() => {
    client.removeAllListeners();
    client.connected = false;
  });

  it('sin conexión no hay ventana de escucha', async () => {
    const service = buildService();
    await service.onModuleInit();
    expect(service.connectedSince).toBeNull();
  });

  it('al conectar empieza a contar', async () => {
    const service = buildService();
    await service.onModuleInit();
    client.connected = true;
    client.emit('connect');
    expect(service.connectedSince).toBeInstanceOf(Date);
  });

  it('al caerse la conexión la ventana se corta', async () => {
    const service = buildService();
    await service.onModuleInit();
    client.connected = true;
    client.emit('connect');
    client.emit('close');
    client.connected = false;
    expect(service.connectedSince).toBeNull();
  });

  it('reconectar reinicia la cuenta: lo de antes no lo oímos', async () => {
    const service = buildService();
    await service.onModuleInit();
    client.connected = true;
    client.emit('connect');
    const first = service.connectedSince!;
    client.emit('close');
    await new Promise((r) => setTimeout(r, 5));
    client.emit('connect');
    expect(service.connectedSince!.getTime()).toBeGreaterThan(first.getTime());
  });

  it('si el cliente dice que no está conectado, no se afirma que oímos', async () => {
    const service = buildService();
    await service.onModuleInit();
    client.connected = true;
    client.emit('connect');
    // Caída sin evento (el cliente se queda descolgado): manda el estado real.
    client.connected = false;
    expect(service.connectedSince).toBeNull();
    expect(service.connected).toBe(false);
  });
});
