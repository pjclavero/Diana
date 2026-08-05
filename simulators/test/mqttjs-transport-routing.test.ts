import { describe, expect, it } from 'vitest';
import { dispatchByFilter } from '../src/transport/mqttjsTransport.js';
import type { IncomingMessage, MessageHandler } from '../src/transport/types.js';

/**
 * Regresión de X-18-INGESTA.
 *
 * `MqttJsTransport` (el transporte contra Mosquitto real) llamaba a TODOS los
 * manejadores con TODOS los mensajes, sin comprobar el filtro de suscripción.
 * El broker en memoria sí filtraba, así que las 34 pruebas del paquete pasaban
 * y el defecto sólo aparecía contra un broker de verdad: el `game/state` del
 * sistema entraba por el manejador de `module/{id}/command`, el módulo leía un
 * `command_id` inexistente y el proceso moría publicando un `status` inválido
 * contra el contrato congelado. Resultado: ni un solo impacto llegaba nunca al
 * backend.
 */
function msg(topic: string): IncomingMessage {
  return { topic, payload: { hola: true }, qos: 1, retain: false };
}

describe('MqttJsTransport · encaminamiento por filtro de suscripción', () => {
  it('entrega cada mensaje SÓLO a los manejadores cuyo filtro casa', () => {
    const recibidos: Record<string, string[]> = { comando: [], estado: [] };
    const handlers = new Map<string, MessageHandler[]>([
      ['targets/v1/module/module-01/command', [(m) => void recibidos.comando!.push(m.topic)]],
      ['targets/v1/system/+/game/state', [(m) => void recibidos.estado!.push(m.topic)]],
    ]);

    dispatchByFilter(handlers, msg('targets/v1/system/system-a/game/state'));
    dispatchByFilter(handlers, msg('targets/v1/module/module-01/command'));

    // El caso exacto que reventaba: el game/state NO puede entrar por el
    // manejador de comandos.
    expect(recibidos.comando).toEqual(['targets/v1/module/module-01/command']);
    expect(recibidos.estado).toEqual(['targets/v1/system/system-a/game/state']);
  });

  it('no entrega a un módulo los mensajes de otro módulo', () => {
    const vistos: string[] = [];
    const handlers = new Map<string, MessageHandler[]>([
      ['targets/v1/module/module-01/command', [(m) => void vistos.push(m.topic)]],
    ]);

    dispatchByFilter(handlers, msg('targets/v1/module/module-02/command'));
    expect(vistos).toEqual([]);
  });

  it('entrega a varios manejadores cuando varios filtros casan (comodín + exacto)', () => {
    const vistos: string[] = [];
    const handlers = new Map<string, MessageHandler[]>([
      ['targets/v1/module/+/hit', [() => void vistos.push('comodín')]],
      ['targets/v1/module/module-01/hit', [() => void vistos.push('exacto')]],
      ['targets/v1/module/module-01/status', [() => void vistos.push('otro')]],
    ]);

    dispatchByFilter(handlers, msg('targets/v1/module/module-01/hit'));
    expect(vistos.sort()).toEqual(['comodín', 'exacto']);
  });
});
