import { AuthService } from '../../src/modules/auth/auth.service';

/**
 * `GET /auth/me` debe reflejar el estado REAL del usuario en la BD, no el del
 * token: en particular `must_change_password`, del que depende que el panel
 * fuerce la rotación de la contraseña semilla en el primer acceso.
 * (Regresión detectada por el supervisor en F1: el token no llevaba el campo.)
 */
describe('AuthService.currentUser', () => {
  function serviceWithUser(user: unknown): AuthService {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
    };
    return new AuthService(prisma as never, {} as never, {} as never);
  }

  it('devuelve must_change_password=true cuando la cuenta debe rotar la contraseña', async () => {
    const svc = serviceWithUser({
      id: 'u1',
      username: 'admin',
      mustChangePassword: true,
      role: { name: 'administrador', permissions: ['*'] },
    });

    const me = await svc.currentUser('u1');

    expect(me).toEqual({
      userId: 'u1',
      username: 'admin',
      role: 'administrador',
      permissions: ['*'],
      must_change_password: true,
    });
  });

  it('devuelve must_change_password=false tras haberla cambiado', async () => {
    const svc = serviceWithUser({
      id: 'u2',
      username: 'paco',
      mustChangePassword: false,
      role: { name: 'jugador', permissions: ['profile:read'] },
    });

    const me = await svc.currentUser('u2');

    expect(me.must_change_password).toBe(false);
    expect(me.permissions).toEqual(['profile:read']);
  });
});
