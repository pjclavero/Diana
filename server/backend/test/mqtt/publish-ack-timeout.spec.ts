import { EventEmitter } from 'node:events';

/**
 * El defecto que cierra esta prueba: al pasar `publish` a asíncrono para poder
 * leer el reasonCode del PUBACK, la espera del broker se metió DENTRO de la
 * transacción de `GamesService.start()`, después de `pg_advisory_xact_lock`.
 * mqtt.js NO tiene plazo de ACK por defecto: un broker que acepta el TCP y no
 * confirma nunca (partición, sobrecarga) dejaba la transacción y el cerrojo
 * del panel abiertos indefinidamente, bloqueando cualquier otro arranque en
 * ese panel. Aquí se fija que la espera está ACOTADA y que el arranque
 * termina, informando la incertidumbre en vez de fingir entrega.
 */
class MudoClient extends EventEmitter {
  connected = true;
  subscribe = jest.fn((_f: string, _o: unknown, cb?: (e?: Error) => void) => cb?.());
  end = jest.fn((_force?: boolean, _o?: unknown, cb?: () => void) => cb?.());
  /** Guarda el callback y NO lo llama: es un broker que nunca manda PUBACK. */
  pendientes: Array<(error?: Error & { code?: number }, packet?: unknown) => void> = [];
  publish = jest.fn(
    (
      _topic: string,
      _msg: string,
      _opts: unknown,
      cb?: (error?: Error & { code?: number }, packet?: unknown) => void,
    ) => {
      if (cb) this.pendientes.push(cb);
    },
  );
}

const client = new MudoClient();
jest.mock('mqtt', () => ({ connect: () => client }));

import { MqttService } from '../../src/modules/mqtt/mqtt.service';
import { GamesService } from '../../src/modules/games/games.service';
import { PUBLISH_ACK_TIMEOUT_MS_DEFAULT } from '../../src/config/configuration';

const ACK_TIMEOUT_MS = 60;

function buildMqtt(publishAckTimeoutMs: number | undefined = ACK_TIMEOUT_MS) {
  const config = {
    mqtt: {
      enabled: true,
      url: 'mqtt://broker:1883',
      clientId: 'backend',
      username: null,
      password: null,
      publishAckTimeoutMs,
    },
  } as never;
  const validator = { validate: jest.fn(() => ({ ok: true, message: '', errors: [] })) } as never;
  const ingest = { handleMessage: jest.fn().mockResolvedValue({}) } as never;
  const prisma = { incident: { create: jest.fn().mockResolvedValue({}) } } as never;
  return new MqttService(config, validator, ingest, prisma);
}

const VALID_SYSTEM_STATUS = { system_id: 'sys-1', status: 'ready', ts: new Date().toISOString() };

describe('MqttService.publish · la espera del PUBACK tiene plazo máximo', () => {
  beforeEach(() => {
    client.connected = true;
    client.pendientes = [];
    client.publish.mockClear();
  });

  it('broker que nunca confirma ⇒ resuelve en cuanto vence el plazo, con timedOut=true', async () => {
    const service = buildMqtt();
    await service.onModuleInit();

    const t0 = Date.now();
    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);
    const transcurrido = Date.now() - t0;

    expect(result).toEqual({ delivered: false, denied: false, reasonCode: null, timedOut: true });
    // La prueba MUERE si alguien quita el plazo: sin él esta llamada no vuelve
    // nunca y el test agota su propio timeout.
    expect(transcurrido).toBeLessThan(ACK_TIMEOUT_MS * 20);
    expect(client.publish).toHaveBeenCalledTimes(1);
  });

  it('un PUBACK que llega TARDE no reabre la promesa ya resuelta', async () => {
    const service = buildMqtt();
    await service.onModuleInit();

    const result = await service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);
    expect(result.timedOut).toBe(true);

    // El callback tardío de mqtt.js se ejecuta ahora: no debe lanzar ni
    // cambiar nada (una segunda resolución sería silenciosa, pero un error sin
    // capturar aquí tumbaría el proceso).
    expect(client.pendientes).toHaveLength(1);
    expect(() => client.pendientes[0](undefined, { reasonCode: 0 })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  it('si el PUBACK llega a tiempo, el plazo no interfiere: delivered=true, timedOut=false', async () => {
    // Control: el plazo no debe convertir en fallo una publicación buena.
    const service = buildMqtt();
    await service.onModuleInit();
    const promesa = service.publish('targets/v1/system/sys-1/status', VALID_SYSTEM_STATUS, true);
    await new Promise((r) => setImmediate(r));
    client.pendientes[0](undefined, { reasonCode: 0 });

    await expect(promesa).resolves.toEqual({
      delivered: true,
      denied: false,
      reasonCode: 0,
      timedOut: false,
    });
  });

  it('el plazo por defecto existe y es finito aunque la config no lo traiga', async () => {
    expect(Number.isFinite(PUBLISH_ACK_TIMEOUT_MS_DEFAULT)).toBe(true);
    expect(PUBLISH_ACK_TIMEOUT_MS_DEFAULT).toBeGreaterThan(0);
  });
});

describe('GamesService.start() · el cerrojo del panel no queda tomado por un broker mudo', () => {
  const round = {
    id: 'r1',
    plan: { activations: [{ targets: [{ module_id: 'mod-a', target_index: 0 }] }] },
    mode: 'sequence',
    countdownMs: 3000,
    timeLimitMs: null,
    penaltyMs: 0,
    strictOrder: false,
    reactionDelayMinMs: null,
    reactionDelayMaxMs: null,
    seed: BigInt(1),
  };

  function gamePrisma(traza: string[]) {
    const tx = {
      $executeRaw: jest.fn().mockImplementation(() => {
        traza.push('lock-tomado');
        return Promise.resolve(1);
      }),
      game: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
      round: { update: jest.fn().mockResolvedValue({}) },
      viewPanel: { findMany: jest.fn().mockResolvedValue([]) },
      module: { findMany: jest.fn().mockResolvedValue([]) },
      incident: { create: jest.fn().mockResolvedValue({}) },
    };
    return {
      game: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'g1',
          status: 'armed',
          targetSystemId: 's1',
          viewId: null,
          rounds: [round],
          gameMode: { key: 'sequence' },
          targetSystem: { slug: 'panel-a' },
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      viewPanel: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
        const salida = await fn(tx);
        // El cerrojo `pg_advisory_xact_lock` se suelta al CERRAR la
        // transacción: este es el instante en que el panel vuelve a estar
        // libre. Si la espera del broker no tuviera plazo, no se alcanzaría.
        traza.push('lock-soltado');
        return salida;
      }),
      __tx: tx,
    } as never;
  }

  beforeEach(() => {
    client.connected = true;
    client.pendientes = [];
    client.publish.mockClear();
  });

  it('con el broker mudo, la transacción CIERRA (cerrojo soltado) y el arranque informa que no se confirmó', async () => {
    const mqtt = buildMqtt();
    await mqtt.onModuleInit();
    const traza: string[] = [];
    const prisma = gamePrisma(traza);

    // Marca el instante EXACTO de la publicación dentro de la traza, para
    // poder fijar que ocurre entre el cerrojo y el cierre de la transacción.
    client.publish.mockImplementationOnce(
      (_t: string, _m: string, _o: unknown, cb?: (e?: Error & { code?: number }, p?: unknown) => void) => {
        traza.push('publicado');
        if (cb) client.pendientes.push(cb);
      },
    );

    const t0 = Date.now();
    const salida = await new GamesService(prisma, mqtt).start('g1', 'r1');
    const transcurrido = Date.now() - t0;

    // ORDEN, no sólo presencia: si alguien saca la publicación FUERA de la
    // transacción (regresión del defecto N-D2 de G-H, «la orden MQTT se
    // publicaba fuera de la transacción»), 'publicado' cae DESPUÉS de
    // 'lock-soltado' y esta prueba muere.
    expect(traza).toEqual(['lock-tomado', 'publicado', 'lock-soltado']);
    expect(transcurrido).toBeLessThan(ACK_TIMEOUT_MS * 20);
    expect(salida.delivered).toBe(false);
    expect(salida.denied).toBe(false);
    expect(salida.note).toMatch(/no llegó al broker/);
    // La publicación sigue OCURRIENDO DENTRO de la transacción (defecto N-D2
    // de G-H: sacarla fuera rompía la atomicidad). Lo acotado es la espera.
    expect(client.publish).toHaveBeenCalledTimes(1);
  });
});
