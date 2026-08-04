import 'reflect-metadata';
import { ManagerActivationController } from '../../src/modules/invitations/manager-activation.controller';
import { PERMISSIONS_KEY } from '../../src/modules/auth/roles.decorator';

/**
 * Dos huecos que la supervisión encontró vivos, ambos del mismo tipo: código
 * que se puede borrar entero con la suite en verde.
 *
 * 1. NINGUNA prueba del repositorio comprobaba un decorador de permiso. Quitar
 *    `@RequirePermissions('users:read')` de `list()` —que devuelve el objeto
 *    completo, código de activación en claro incluido— no rompía nada.
 * 2. La auditoría de intentos fallidos se podía sustituir por un no-op sin que
 *    fallara una sola prueba, y con ella desaparecía el único rastro de que
 *    alguien estuviera tanteando códigos.
 */

const permisosDe = (metodo: string): string[] | undefined =>
  Reflect.getMetadata(PERMISSIONS_KEY, (ManagerActivationController.prototype as never)[metodo]);

describe('ManagerActivationController · permisos fijados por prueba', () => {
  it('listar los ascensos EXIGE `users:read`: enseña los códigos en claro', () => {
    expect(permisosDe('list')).toEqual(['users:read']);
  });

  it('regenerar y revocar EXIGEN `users:write`', () => {
    expect(permisosDe('regenerate')).toEqual(['users:write']);
    expect(permisosDe('revoke')).toEqual(['users:write']);
  });

  it('`mine` y `activate` NO exigen permiso: su destinatario es un jugador', () => {
    // Si se les pusiera un permiso de gestión, el comprador —que todavía es
    // jugador— no podría activar su propio ascenso. Es el bloqueante B1.
    expect(permisosDe('mine')).toBeUndefined();
    expect(permisosDe('activate')).toBeUndefined();
  });
});

describe('ManagerActivationController · auditoría', () => {
  const req = { user: { userId: 'u1', username: 'ana', role: 'jugador', permissions: [] } } as never;

  function build(activateImpl: jest.Mock) {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const activations = { activate: activateImpl } as never;
    return { ctrl: new ManagerActivationController(activations, audit as never), audit };
  }

  it('una activación correcta se audita', async () => {
    const { ctrl, audit } = build(jest.fn().mockResolvedValue({ activated: true }));
    await ctrl.activate({ code: 'ABCD2345' } as never, req);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].action).toBe('manager.activate');
  });

  it('un intento FALLIDO se audita y el error se propaga igual', async () => {
    const { ctrl, audit } = build(jest.fn().mockRejectedValue(new Error('Código no válido.')));
    await expect(ctrl.activate({ code: 'XXXX9999' } as never, req)).rejects.toThrow(
      'Código no válido.',
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    const registrado = audit.record.mock.calls[0][0];
    expect(registrado.action).toBe('manager.activate_failed');
    expect(registrado.after).toEqual({ reason: 'Código no válido.' });
  });

  it('el código probado NUNCA se registra en la auditoría', async () => {
    // Auditar el intento no puede convertir el registro en un listado de
    // códigos ajenos a la vista de quien lea la auditoría.
    const { ctrl, audit } = build(jest.fn().mockRejectedValue(new Error('Código no válido.')));
    await expect(ctrl.activate({ code: 'SECRETO1' } as never, req)).rejects.toThrow();
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain('SECRETO1');
  });
});
