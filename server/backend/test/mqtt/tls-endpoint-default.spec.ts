/**
 * P0-2 · El endpoint MQTT por defecto tiene que ser TLS.
 *
 * Por qué existe este fichero, y no basta con tls-fail-closed.spec.ts:
 * aquél verifica que el cliente falla cerrado CUANDO la URL es TLS. Pero
 * `tlsOptions()` devuelve `{}` —legítimamente, y sin un solo aviso— cuando la
 * URL está en claro. Así que la mutación más probable del mundo real, que es
 * devolver `configuration.ts` al literal `'mqtt://mosquitto:1883'` que había
 * en 6da16d4, dejaba TODA la suite en verde mientras el backend conectaba sin
 * validar absolutamente nada. Un guardarraíl que sólo vigila la mitad TLS del
 * camino no vigila el camino.
 *
 * Aquí se fija la otra mitad: sin configuración explícita, la URL es `mqtts`
 * contra 8883, y sólo una decisión deliberada y visible del despliegue puede
 * sacarla de ahí.
 */
import { loadConfiguration } from '../../src/config/configuration';

const VARIABLES = [
  'MQTT_URL',
  'MQTT_PROTOCOL',
  'MQTT_HOST',
  'MQTT_PORT',
  'MQTT_CA_FILE',
  'JWT_SECRET',
];

describe('configuration · el endpoint MQTT por defecto es TLS (P0-2)', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARIABLES) {
      original[v] = process.env[v];
      delete process.env[v];
    }
    // loadConfiguration() aborta sin secreto de JWT; irrelevante aquí.
    process.env.JWT_SECRET = 'x'.repeat(32);
  });

  afterEach(() => {
    for (const v of VARIABLES) {
      if (original[v] === undefined) delete process.env[v];
      else process.env[v] = original[v];
    }
  });

  it('sin ninguna variable MQTT, la URL es mqtts contra 8883', () => {
    const { url } = loadConfiguration().mqtt;

    expect(url).toBe('mqtts://mosquitto:8883');
    // Redundante a propósito: si alguien reintroduce el literal en claro, que
    // el fallo diga en voz alta cuál es el problema.
    expect(url.startsWith('mqtt://')).toBe(false);
    expect(url).not.toContain(':1883');
  });

  it('el puerto y el host del despliegue se respetan de verdad', () => {
    // Éste era el defecto original: compose pasaba MQTT_HOST/MQTT_PORT y el
    // backend los ignoraba, así que el despliegue creía haber cambiado de
    // endpoint y no había cambiado nada.
    process.env.MQTT_HOST = 'broker.interno';
    process.env.MQTT_PORT = '8884';

    expect(loadConfiguration().mqtt.url).toBe('mqtts://broker.interno:8884');
  });

  it('volver a texto en claro exige decirlo explícitamente', () => {
    process.env.MQTT_PROTOCOL = 'mqtt';
    process.env.MQTT_PORT = '1883';

    // No se prohíbe —el laboratorio y los tests lo necesitan—, pero deja de
    // ser lo que ocurre por omisión: hace falta escribirlo en el despliegue,
    // donde una revisión puede verlo.
    expect(loadConfiguration().mqtt.url).toBe('mqtt://mosquitto:1883');
  });

  it('MQTT_URL tiene precedencia absoluta: es la escapatoria, y queda fijada aquí', () => {
    // La vigilancia que faltaba. `MQTT_URL` gana sobre protocolo, host y
    // puerto (configuration.ts), así que un MQTT_URL=mqtt://… en el .env de la
    // VM anula el TLS entero: ni protocolo por defecto, ni CA, ni validación —
    // y, mientras siga vivo el listener 1883 interno, tampoco un error visible.
    // No se prohíbe (el laboratorio la necesita), pero deja de ser invisible:
    // si alguien cambia la precedencia o la introduce como valor por defecto,
    // esta prueba se entera.
    process.env.MQTT_URL = 'mqtts://otro-broker:8883';
    expect(loadConfiguration().mqtt.url).toBe('mqtts://otro-broker:8883');

    // Gana incluso contradiciendo a protocolo/host/puerto: eso es lo peligroso.
    process.env.MQTT_PROTOCOL = 'mqtts';
    process.env.MQTT_HOST = 'mosquitto';
    process.env.MQTT_PORT = '8883';
    process.env.MQTT_URL = 'mqtt://mosquitto:1883';
    expect(loadConfiguration().mqtt.url).toBe('mqtt://mosquitto:1883');

    // Y no hay ningún valor por defecto de MQTT_URL: sin ella, manda el resto.
    delete process.env.MQTT_URL;
    expect(loadConfiguration().mqtt.url).toBe('mqtts://mosquitto:8883');
  });

  it('MQTT_CA_FILE llega a la configuración; su ausencia no se disfraza', () => {
    expect(loadConfiguration().mqtt.caFile).toBeNull();

    process.env.MQTT_CA_FILE = '/app/certs/mqtt-ca.crt';
    expect(loadConfiguration().mqtt.caFile).toBe('/app/certs/mqtt-ca.crt');
  });
});
