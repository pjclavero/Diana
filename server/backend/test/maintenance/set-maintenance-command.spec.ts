import { MaintenanceController } from '../../src/modules/maintenance/maintenance.module';

/**
 * El defecto que cierra esta prueba: `sendModuleCommand` pasó a `async` (lee el
 * reasonCode del PUBACK de MQTT5) y esta llamada se quedó SIN `await`. El
 * endpoint devolvía una Promise sin resolver en `command`: `JSON.stringify` la
 * serializa como `{}`, así que la respuesta perdía `delivered` y `denied` —
 * justo en el endpoint que publica en `targets/v1/module/{id}/command`, el
 * tópico que la ACL de producción deniega. Y una promesa rechazada sin `await`
 * ni `.catch()` tumba el proceso de Node.
 */
function build(sendModuleCommand: jest.Mock) {
  const prisma = {
    module: { update: jest.fn().mockResolvedValue({ id: 'm1', slug: 'mod-a' }) },
  } as never;
  const mqtt = { sendModuleCommand } as never;
  const audit = { record: jest.fn().mockResolvedValue({}) } as never;
  return new MaintenanceController(prisma, mqtt, audit);
}

describe('MaintenanceController.setMaintenance · espera de verdad al broker', () => {
  it('la respuesta lleva el comando RESUELTO, no una promesa', async () => {
    const controller = build(
      jest.fn().mockResolvedValue({ command_id: 'c1', delivered: true, denied: false }),
    );

    const res = await controller.setMaintenance('mod-a', { enabled: true }, {});

    expect(res.command).not.toBeInstanceOf(Promise);
    expect(res.command).toMatchObject({ command_id: 'c1', delivered: true, denied: false });
    // Lo que se serializa al cliente: una promesa daría `{}`.
    expect(JSON.parse(JSON.stringify(res)).command.command_id).toBe('c1');
  });

  it('ACL denegada: `denied` LLEGA a la respuesta (era lo que se perdía)', async () => {
    const controller = build(
      jest.fn().mockResolvedValue({ command_id: 'c1', delivered: false, denied: true }),
    );

    const res = await controller.setMaintenance('mod-a', { enabled: false }, {});

    expect(JSON.parse(JSON.stringify(res)).command).toMatchObject({
      delivered: false,
      denied: true,
    });
  });

  it('si la publicación RECHAZA, el rechazo sale por el endpoint y no queda suelto', async () => {
    // Sin `await` esto era un unhandled rejection: no lo veía el cliente (que
    // recibía un 200 con `command: {}`) y tumbaba el proceso de Node.
    const controller = build(jest.fn().mockRejectedValue(new Error('Tópico fuera del contrato v1')));

    await expect(controller.setMaintenance('mod-a', { enabled: true }, {})).rejects.toThrow(
      /contrato v1/,
    );
  });
});
