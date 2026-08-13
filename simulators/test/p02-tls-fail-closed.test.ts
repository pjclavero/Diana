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
});
