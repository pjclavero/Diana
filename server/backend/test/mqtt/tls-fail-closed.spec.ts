import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * P0-2 · el backend valida al broker, o no habla con él.
 *
 * El valor de poner TLS no está en cifrar: está en saber CON QUIÉN se habla.
 * Un cliente que cifra contra cualquiera que le conteste sigue expuesto a un
 * intermediario en la LAN, que es exactamente el ataque de H7-03. Por eso las
 * propiedades que se fijan aquí son de fallar cerrado:
 *
 *   URL mqtts:// + sin CA          → LANZA en el arranque, no conecta
 *   URL mqtts:// + CA ilegible     → LANZA, no conecta "a pelo"
 *   URL mqtts:// + CA legible      → conecta con `ca` y `rejectUnauthorized`
 *   URL mqtt:// (en claro)         → no se inventa TLS (los tests y el broker
 *                                    efímero de la suite `test` siguen en claro)
 *
 * Sin esta prueba, alguien puede "arreglar" un fallo de certificado poniendo
 * `rejectUnauthorized: false` y todas las demás suites seguirían en verde.
 */
class FakeClient extends EventEmitter {
  connected = false;
  subscribe = jest.fn((_f: string, _o: unknown, cb?: (e?: Error) => void) => cb?.());
  publish = jest.fn();
  end = jest.fn((_force?: boolean, _o?: unknown, cb?: () => void) => cb?.());
}

const client = new FakeClient();
// Tipado explícito de los argumentos: sin esto, `mock.calls` queda inferido
// como tupla vacía y todo acceso a `calls[0][1]` es un error de tipos. La
// suite pasaba igual (jest no typechequea), pero `npm run typecheck` —que CI
// SÍ ejecuta— se ponía roja. Un test que rompe el pipeline no es un test.
const connectSpy = jest.fn((..._args: unknown[]) => client);
jest.mock('mqtt', () => ({ connect: (...args: unknown[]) => connectSpy(...(args as [])) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { MqttService } from '../../src/modules/mqtt/mqtt.service';

function buildService(url: string, caFile: string | null) {
  const config = {
    mqtt: { enabled: true, url, caFile, clientId: 'backend', username: null, password: null },
  } as never;
  const validator = { validate: jest.fn(() => ({ valid: true, errors: [] })) } as never;
  const ingest = { handleMessage: jest.fn().mockResolvedValue({}) } as never;
  // MqttService toma TRES dependencias en esta base (6da16d4). Aquí se pasaba
  // una cuarta (`prisma`) que no existe en su constructor: resto de una
  // versión posterior, invisible para jest y roja para tsc.
  return new MqttService(config, validator, ingest);
}

describe('MqttService · TLS que falla cerrado (P0-2)', () => {
  let caPath: string;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'diana-tls-'));
    caPath = join(dir, 'ca.crt');
    // El contenido no se parsea aquí (mqtt.js está simulado); lo que se prueba
    // es que se LEE el fichero y se pasa como `ca`.
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nno-es-un-certificado\n-----END CERTIFICATE-----\n');
  });

  beforeEach(() => {
    connectSpy.mockClear();
    client.removeAllListeners();
  });

  it('URL TLS sin CA: aborta el arranque en vez de conectar sin validar', async () => {
    const service = buildService('mqtts://mosquitto:8883', null);
    await expect(service.onModuleInit()).rejects.toThrow(/MQTT_CA_FILE es obligatorio/);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('URL TLS con CA ilegible: aborta, no degrada a conexión sin validar', async () => {
    const service = buildService('mqtts://mosquitto:8883', '/no/existe/ca.crt');
    await expect(service.onModuleInit()).rejects.toThrow(/No se puede leer la CA/);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('URL TLS con CA: conecta validando al broker', async () => {
    const service = buildService('mqtts://mosquitto:8883', caPath);
    await service.onModuleInit();
    const options = connectSpy.mock.calls[0][1] as { ca?: Buffer[]; rejectUnauthorized?: boolean };
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.ca?.[0]?.toString()).toContain('BEGIN CERTIFICATE');
  });

  it('la verificación de nombre queda al host de la URL: no se fija `servername`', async () => {
    const service = buildService('mqtts://mosquitto:8883', caPath);
    await service.onModuleInit();
    const options = connectSpy.mock.calls[0][1] as Record<string, unknown>;
    // Fijarlo a mano desactivaría de hecho la comprobación de hostname, que es
    // la mitad de lo que aporta validar el certificado.
    expect(options).not.toHaveProperty('servername');
  });

  it('URL en claro fuera de producción: se permite, pero no se inventan opciones TLS', async () => {
    const previo = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const service = buildService('mqtt://broker:1883', null);
      await service.onModuleInit();
      const options = connectSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(options).not.toHaveProperty('ca');
      expect(options).not.toHaveProperty('rejectUnauthorized');
    } finally {
      process.env.NODE_ENV = previo;
    }
  });

  it('URL en claro EN PRODUCCIÓN: aborta — la escapatoria de MQTT_URL queda cerrada', async () => {
    // Por qué este caso y no otro: MQTT_URL tiene precedencia absoluta sobre
    // protocolo/host/puerto, así que ponerla a `mqtt://` en el .env de la VM
    // devolvía el backend a texto en claro sin romper nada visible. Fijar en
    // un test que "MQTT_URL gana" no vigilaba NADA: la única mutación que lo
    // habría puesto rojo era invertir la precedencia, o sea, arreglar el
    // problema. El control tiene que estar en el código, y esto lo comprueba.
    const previo = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const service = buildService('mqtt://mosquitto:1883', null);
      await expect(service.onModuleInit()).rejects.toThrow(/no está permitido en producción/);
      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previo;
    }
  });
});
