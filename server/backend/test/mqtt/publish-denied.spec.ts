import { EventEmitter } from 'node:events';

/**
 * El defecto que cierra esta prueba: en MQTT una denegación de ACL es
 * SILENCIOSA a nivel de transporte — el broker no cierra el socket, sólo dice
 * "no reenvío esto" en su propio log. `MqttService.publish` (protocolVersion
 * 5) debe leer el `reasonCode` del PUBACK/PUBREC (mqtt.js lo entrega como
 * `error.code` cuando es >= 0x80) y distinguir esa denegación de:
 *   - una publicación aceptada de verdad,
 *   - una publicación sin conexión (encolada por mqtt.js),
 *   - un fallo de transporte que no es una denegación de ACL.
 * Además debe dejar una incidencia CONSULTABLE (prisma.incident.create), no
 * sólo un log, cuando detecta la denegación.
 */
class FakeClient extends EventEmitter {
  connected = true;
  subscribe = jest.fn((_f: string, _o: unknown, cb?: (e?: Error) => void) => cb?.());
  end = jest.fn((_force?: boolean, _o?: unknown, cb?: () => void) => cb?.());
  // Configurable por test: qué le pasa mqtt.js al callback de `publish`.
  nextPublishResult: { error?: Error & { code?: number }; packet?: { reasonCode?: number } } = {};
  publish = jest.fn(
    (
      _topic: string,
      _msg: string,
      _opts: unknown,
      cb?: (error?: Error & { code?: number }, packet?: { reasonCode?: number }) => void,
    ) => {
      cb?.(this.nextPublishResult.error, this.nextPublishResult.packet);
    },
  );
}

const client = new FakeClient();
jest.mock('mqtt', () => ({ connect: () => client }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { MqttService } from '../../src/modules/mqtt/mqtt.service';

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
  const validator = { validate: jest.fn(() => ({ ok: true, message: '', errors: [] })) } as never;
  const ingest = { handleMessage: jest.fn().mockResolvedValue({}) } as never;
  const incidentCreate = jest.fn().mockResolvedValue({});
  const prisma = { incident: { create: incidentCreate } } as never;
  const service = new MqttService(config, validator, ingest, prisma);
  return { service, incidentCreate };
}

const VALID_SYSTEM_STATUS = {
  system_id: 'sys-1',
  status: 'ready',
  ts: new Date().toISOString(),
};

describe('MqttService.publish · denegación de ACL detectable (PUBACK reasonCode)', () => {
  beforeEach(() => {
    client.connected = true;
    client.nextPublishResult = {};
    client.publish.mockClear();
  });

  it('PUBACK sin reasonCode de error ⇒ delivered=true, denied=false, sin incidencia', async () => {
    const { service, incidentCreate } = build();
    await service.onModuleInit();
    client.nextPublishResult = { packet: { reasonCode: 0 } };

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result).toEqual({ delivered: true, denied: false, reasonCode: 0, timedOut: false });
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  it('PUBACK con reasonCode 135 (Not authorized) ⇒ denied=true, delivered=false, e incidencia consultable', async () => {
    const { service, incidentCreate } = build();
    await service.onModuleInit();
    const aclError = Object.assign(new Error('Publish error: Not authorized'), { code: 135 });
    client.nextPublishResult = { error: aclError };

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result).toEqual({ delivered: false, denied: true, reasonCode: 135, timedOut: false });
    expect(incidentCreate).toHaveBeenCalledTimes(1);
    const call = incidentCreate.mock.calls[0][0];
    expect(call.data.kind).toBe('mqtt_publish_denied');
    expect(call.data.severity).toBe('critical');
    expect(call.data.detail.topic).toBe('targets/v1/system/sys-1/status');
    expect(call.data.detail.reason_code).toBe(135);
  });

  it('sin conexión ⇒ encolado: delivered=false, denied=false, sin incidencia (no es ACL)', async () => {
    const { service, incidentCreate } = build();
    await service.onModuleInit();
    client.connected = false;

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result).toEqual({ delivered: false, denied: false, reasonCode: null, timedOut: false });
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  it('error de transporte sin reasonCode ⇒ NO se confunde con denegación de ACL', async () => {
    const { service, incidentCreate } = build();
    await service.onModuleInit();
    client.nextPublishResult = { error: new Error('socket hang up') };

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result.denied).toBe(false);
    expect(result.delivered).toBe(false);
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  it('error con reasonCode <0x80 (p.ej. 17, no ACL) ⇒ denied=false, aunque delivered=false', async () => {
    const { service, incidentCreate } = build();
    await service.onModuleInit();
    const nonAclError = Object.assign(new Error('No subscription existed'), { code: 17 });
    client.nextPublishResult = { error: nonAclError };

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result).toEqual({ delivered: false, denied: false, reasonCode: 17, timedOut: false });
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  it('reasonCode 128 EXACTO (frontera 0x80) ya es denegación ⇒ denied=true', async () => {
    // Frontera del umbral `reasonCode >= 0x80`. Sin este caso, cambiar el
    // operador a `> 0x80` no rompía ninguna prueba: el 128 (Unspecified
    // error, el que devuelven brokers que no distinguen el motivo) pasaba por
    // «no denegado» y volvía a hacer indistinguible el rechazo silencioso.
    const { service, incidentCreate } = build();
    await service.onModuleInit();
    client.nextPublishResult = { error: Object.assign(new Error('Unspecified error'), { code: 128 }) };

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result).toEqual({ delivered: false, denied: true, reasonCode: 128, timedOut: false });
    expect(incidentCreate).toHaveBeenCalledTimes(1);
  });

  it('reasonCode 127 (justo por debajo de la frontera) NO es denegación', async () => {
    // Control de la frontera por el otro lado: fija que el umbral está en 128
    // y no más abajo, para que endurecerlo a `>= 0x7f` tampoco pase inadvertido.
    const { service, incidentCreate } = build();
    await service.onModuleInit();
    client.nextPublishResult = { error: Object.assign(new Error('no es ACL'), { code: 127 }) };

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result).toEqual({ delivered: false, denied: false, reasonCode: 127, timedOut: false });
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  it('reasonCode 16 ("No matching subscribers") no es un fallo ⇒ delivered=true', async () => {
    // mqtt.js ya filtra el 16 como éxito (no llama al callback con error), así
    // que aquí simulamos exactamente eso: llega como packet, no como error.
    const { service } = build();
    await service.onModuleInit();
    client.nextPublishResult = { packet: { reasonCode: 16 } };

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);

    expect(result).toEqual({ delivered: true, denied: false, reasonCode: 16, timedOut: false });
  });
});

describe('MqttService.sendSystemCommand / sendModuleMaintenanceCommand · propagan `denied`', () => {
  beforeEach(() => {
    client.connected = true;
    client.nextPublishResult = {};
    client.publish.mockClear();
  });

  it('sendSystemCommand: ACL denegada ⇒ el comando devuelto lleva denied=true, delivered=false', async () => {
    const { service } = build();
    await service.onModuleInit();
    const aclError = Object.assign(new Error('Publish error: Not authorized'), { code: 135 });
    client.nextPublishResult = { error: aclError };

    const command = await service.sendSystemCommand('sys-1', 'pause_game', {}, 10000);

    expect((command as { delivered: boolean }).delivered).toBe(false);
    expect((command as { denied: boolean }).denied).toBe(true);
  });

  /*
   * `sendModuleCommand` ya NO EXISTE: era el único publicador del backend en
   * el canal de juego `module/{id}/command` y se ha retirado. Sus dos pruebas
   * de propagación de `denied` se trasladan al método que hoy SÍ publica
   * órdenes a un módulo, `sendModuleMaintenanceCommand`, para no perder la
   * cobertura del propagador (era el que más falta hacía fijar: el comando a
   * módulo es justo el que una ACL puede denegar).
   */
  const REQUESTED_BY = { actor_type: 'operator' as const, actor_id: 'u-1' };

  it('sendModuleMaintenanceCommand: ACL denegada ⇒ denied=true llega al llamador', async () => {
    const { service } = build();
    await service.onModuleInit();
    client.nextPublishResult = {
      error: Object.assign(new Error('Publish error: Not authorized'), { code: 135 }),
    };

    const command = await service.sendModuleMaintenanceCommand('mod-a', 'identify', REQUESTED_BY, {
      duration_ms: 1000,
    });

    expect((command as { delivered: boolean }).delivered).toBe(false);
    expect((command as { denied: boolean }).denied).toBe(true);
  });

  it('sendModuleMaintenanceCommand: aceptado ⇒ delivered=true, denied=false', async () => {
    const { service } = build();
    await service.onModuleInit();
    client.nextPublishResult = { packet: { reasonCode: 0 } };

    const command = await service.sendModuleMaintenanceCommand('mod-a', 'identify', REQUESTED_BY, {
      duration_ms: 1000,
    });

    expect((command as { delivered: boolean }).delivered).toBe(true);
    expect((command as { denied: boolean }).denied).toBe(false);
  });
});
