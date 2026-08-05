import { ConflictException } from '@nestjs/common';
import { MaintenanceController } from '../../src/modules/maintenance/maintenance.module';

/**
 * `MaintenanceController` publicaba `self_test` e `identify` en
 * `targets/v1/module/{id}/command` (canal de JUEGO) vía `sendModuleCommand`.
 * Ampliación v1.1: el contrato quitó `"backend"` del enum `issuer` de ese
 * tópico y F-02 (ACL real) le deniega la escritura — doblemente prohibido.
 * Ahora usa `sendModuleMaintenanceCommand` sobre `module/{id}/maintenance/command`,
 * el mismo patrón que F6. `set_maintenance` no tiene `command_type` en el
 * esquema nuevo: se guarda en base pero NO se publica nada (no se inventa un
 * `command_type` ni se cuela por el canal de juego).
 */
const ADMIN = { userId: 'u-admin', role: 'administrador' };

function build(
  over: {
    sendModuleMaintenanceCommand?: jest.Mock;
    isPanelOccupied?: jest.Mock;
    moduleFindUnique?: jest.Mock;
  } = {},
) {
  const sendModuleMaintenanceCommand =
    over.sendModuleMaintenanceCommand ??
    jest.fn().mockResolvedValue({ request_id: 'r1', delivered: true, denied: false });
  const prisma = {
    module: {
      update: jest.fn().mockResolvedValue({ id: 'm1', slug: 'mod-a' }),
      findUnique: over.moduleFindUnique ?? jest.fn().mockResolvedValue({ targetSystemId: 'panel-1' }),
    },
  } as never;
  const mqtt = { sendModuleMaintenanceCommand } as never;
  const audit = { record: jest.fn().mockResolvedValue({}) } as never;
  const isPanelOccupied = over.isPanelOccupied ?? jest.fn().mockResolvedValue(false);
  const games = { isPanelOccupied } as never;
  return {
    controller: new MaintenanceController(prisma, mqtt, audit, games),
    sendModuleMaintenanceCommand,
    prisma,
    isPanelOccupied,
  };
}

describe('MaintenanceController · self-test / identify publican en el canal de MANTENIMIENTO', () => {
  it('self-test manda command_type "self_test" con requested_by', async () => {
    const { controller, sendModuleMaintenanceCommand } = build();
    await controller.selfTest('mod-a', { user: ADMIN } as never);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledWith('mod-a', 'self_test', {
      actor_type: 'operator',
      actor_id: 'u-admin',
    });
  });

  it('identify manda command_type "identify" con duration_ms', async () => {
    const { controller, sendModuleMaintenanceCommand } = build();
    await controller.identify('mod-a', { duration_ms: 7000 }, { user: ADMIN } as never);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalledWith(
      'mod-a',
      'identify',
      { actor_type: 'operator', actor_id: 'u-admin' },
      { duration_ms: 7000 },
    );
  });

  it('identify sin body usa 4000ms por defecto', async () => {
    const { controller, sendModuleMaintenanceCommand } = build();
    await controller.identify('mod-a', undefined, { user: ADMIN } as never);
    expect(sendModuleMaintenanceCommand.mock.calls[0][3]).toEqual({ duration_ms: 4000 });
  });

  it('self-test se bloquea con partida activa sobre el panel (game_in_progress)', async () => {
    const { controller, sendModuleMaintenanceCommand } = build({
      isPanelOccupied: jest.fn().mockResolvedValue(true),
    });
    await expect(controller.selfTest('mod-a', { user: ADMIN } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(sendModuleMaintenanceCommand).not.toHaveBeenCalled();
  });

  it('identify SIGUE PERMITIDO con partida activa (categoría "leer")', async () => {
    const { controller, sendModuleMaintenanceCommand } = build({
      isPanelOccupied: jest.fn().mockResolvedValue(true),
    });
    await controller.identify('mod-a', { duration_ms: 1000 }, { user: ADMIN } as never);
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });

  it('un módulo sin panel asignado no bloquea self-test (nada que ocupar)', async () => {
    const { controller, sendModuleMaintenanceCommand, isPanelOccupied } = build({
      moduleFindUnique: jest.fn().mockResolvedValue({ targetSystemId: null }),
    });
    await controller.selfTest('mod-a', { user: ADMIN } as never);
    expect(isPanelOccupied).not.toHaveBeenCalled();
    expect(sendModuleMaintenanceCommand).toHaveBeenCalled();
  });
});

describe('MaintenanceController.setMaintenance · sin command_type, sin bridge al canal de juego', () => {
  it('guarda el modo en base y NO publica nada por MQTT', async () => {
    const { controller, sendModuleMaintenanceCommand } = build();

    const res = await controller.setMaintenance('mod-a', { enabled: true }, { user: ADMIN } as never);

    expect(res.module).toMatchObject({ id: 'm1', slug: 'mod-a' });
    expect(res.command).toBeNull();
    expect(res.note).toMatch(/no está en el repertorio/);
    expect(sendModuleMaintenanceCommand).not.toHaveBeenCalled();
  });
});
