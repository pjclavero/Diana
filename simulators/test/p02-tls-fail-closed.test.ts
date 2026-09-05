import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MqttJsTransport } from '../src/transport/mqttjsTransport.js';

/**
 * P0-2 · El simulador no conecta por TLS sin validar.
 *
 * El simulador es la herramienta con la que se comprueba el camino completo
 * módulo → broker → backend → base de datos. Si él aceptara un `mqtts://` sin
 * CA, el humo saldría verde contra un broker que nadie ha verificado, que es
 * exactamente el error que P0-2 persigue.
 *
 * MUTACIÓN QUE DEBE PONERLO ROJO: quitar el `throw` de `tlsOptions()` en
 * mqttjsTransport.ts, o devolver `{ rejectUnauthorized: false }`.
 */
describe('P0-2: transporte MQTT del simulador', () => {
  it('mqtts:// sin --cafile aborta, no conecta a ciegas', async () => {
    const t = new MqttJsTransport('sim-01', { url: 'mqtts://mosquitto:8883' });
    await expect(t.connect()).rejects.toThrow(/exige --cafile/);
  });

  it('mqtts:// con una CA ilegible aborta con el motivo, no la ignora', async () => {
    const t = new MqttJsTransport('sim-01', {
      url: 'mqtts://mosquitto:8883',
      caFile: '/no/existe/ca.crt',
    });
    await expect(t.connect()).rejects.toThrow(/ENOENT|no such file/i);
  });

  it('una URL en claro sigue permitida: hay brokers de laboratorio legítimos', async () => {
    // No se conecta a nada aquí; lo que se comprueba es que NO aborta por
    // política antes de intentarlo. El puerto 1 no escucha, así que el fallo
    // que llegue será de red, nunca el de la política TLS.
    const t = new MqttJsTransport('sim-01', { url: 'mqtt://127.0.0.1:1' });
    await expect(t.connect()).rejects.not.toThrow(/exige --cafile/);
  });

  /**
   * AÑADIDO EN EL PORTE D1, y por un motivo medido, no por completismo.
   *
   * La cabecera de este fichero declaraba que devolver
   * `{ rejectUnauthorized: false }` debía poner el fichero ROJO. Se comprobó
   * ejecutándolo: con esa mutación aplicada, los tres tests de arriba seguían
   * VERDES. La afirmación de la cabecera era falsa, y una prueba que no puede
   * ponerse roja ante su propia mutación declarada no es evidencia de nada.
   *
   * Ninguno de los tres podía verlo: todos observan el RECHAZO de connect(),
   * y con `rejectUnauthorized: false` el `mqtts://` sin CA sigue rechazándose
   * por el throw, y la CA ilegible sigue fallando al leer el fichero. La única
   * forma de verlo es mirar las opciones que se le entregan a mqtt.js.
   *
   * MUTACIONES QUE PONEN ESTE TEST ROJO: `rejectUnauthorized: false`, o
   * devolver `{}` en la rama TLS.
   */
  it('con CA válida entrega rejectUnauthorized=true a mqtt.js', () => {
    const t = new MqttJsTransport('sim-01', {
      url: 'mqtts://mosquitto:8883',
      // El propio fichero de test sirve de PEM de mentira: aquí sólo se
      // comprueba qué opciones se construyen, no que la CA sea válida.
      caFile: fileURLToPath(import.meta.url),
    });
    // tlsOptions() es privado a propósito; se accede por índice para no
    // ensanchar la superficie pública sólo por poder probarla.
    const opts = (t as unknown as { tlsOptions(): Record<string, unknown> }).tlsOptions();
    expect(opts.rejectUnauthorized).toBe(true);
    expect(Array.isArray(opts.ca)).toBe(true);
    // `servername` NO debe fijarse a mano: mqtt.js lo toma del host de la URL,
    // y fijarlo desactivaría de hecho la verificación de nombre.
    expect(opts).not.toHaveProperty('servername');
  });
});
