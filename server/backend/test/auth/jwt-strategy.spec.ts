import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy, JwtPayload } from '../../src/modules/auth/jwt.strategy';

/**
 * Ésta es LA prueba de la corrección de seguridad de F5, y no existía: se podía
 * revertir la corrección entera con dos líneas y las 592 pruebas seguían verdes.
 *
 * El agujero: el rol y los permisos viajaban DENTRO del token, congelados hasta
 * 8 h. Con F5 el cambio de rol pasa a ser rutinario (se asciende al activar el
 * código, se degrada al perder el último módulo), así que un ex-gestor
 * degradado conservaba sus permisos de gestor toda la vida de su token.
 * Revocarle los códigos no servía de nada: se estaba revocando la credencial
 * equivocada.
 *
 * Por eso lo que se comprueba aquí NO es que `validate()` devuelva algo, sino
 * que devuelve lo que dice la BASE **incluso cuando el token dice otra cosa**.
 */

const config = { jwt: { secret: 'x' } } as never;

function build(user: unknown) {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } } as never;
  return { strategy: new JwtStrategy(config, prisma), prisma: prisma as any };
}

/** Un token de gestor: lo que el portador AFIRMA ser. */
const tokenDeGestor: JwtPayload = {
  sub: 'u1',
  username: 'ana',
  role: 'gestor',
  permissions: ['modules:write', 'games:write'],
};

const enBase = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  username: 'ana',
  active: true,
  role: { name: 'gestor', permissions: ['modules:write', 'games:write'] },
  ...over,
});

describe('JwtStrategy · el rol se lee de la BASE, no del token', () => {
  it('un ex-gestor degradado a jugador NO conserva los permisos de su token', async () => {
    // El corazón del asunto: token de gestor, base que dice jugador.
    const { strategy } = build(
      enBase({ role: { name: 'jugador', permissions: ['games:read'] } }),
    );
    const user = await strategy.validate(tokenDeGestor);
    expect(user.role).toBe('jugador');
    expect(user.permissions).toEqual(['games:read']);
    expect(user.permissions).not.toContain('modules:write');
  });

  it('un jugador recién ascendido ejerce de gestor sin volver a entrar', async () => {
    // La misma ventana, del otro lado: si sólo se cerrara la degradación, el
    // comprador seguiría viendo 403 hasta que caducara su token.
    const { strategy } = build(enBase());
    const user = await strategy.validate({
      ...tokenDeGestor,
      role: 'jugador',
      permissions: ['games:read'],
    });
    expect(user.role).toBe('gestor');
    expect(user.permissions).toContain('modules:write');
  });

  it('consulta al usuario del token, no a otro', async () => {
    const { strategy, prisma } = build(enBase());
    await strategy.validate(tokenDeGestor);
    expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({ id: 'u1' });
  });

  it('una cuenta DESACTIVADA se rechaza aunque su token siga vigente', async () => {
    const { strategy } = build(enBase({ active: false }));
    await expect(strategy.validate(tokenDeGestor)).rejects.toThrow(UnauthorizedException);
  });

  it('un usuario BORRADO se rechaza', async () => {
    const { strategy } = build(null);
    await expect(strategy.validate(tokenDeGestor)).rejects.toThrow(UnauthorizedException);
  });

  it('si la base no responde se DENIEGA el paso, no se concede', async () => {
    // Fail-closed. Un fallo de base que dejara pasar al portador convertiría
    // una caída en una escalada de privilegios.
    const prisma = {
      user: { findUnique: jest.fn().mockRejectedValue(new Error('sin conexión')) },
    } as never;
    const strategy = new JwtStrategy(config, prisma);
    await expect(strategy.validate(tokenDeGestor)).rejects.toThrow();
  });

  it('el nombre de usuario también sale de la base', async () => {
    const { strategy } = build(enBase({ username: 'ana.renombrada' }));
    const user = await strategy.validate(tokenDeGestor);
    expect(user.username).toBe('ana.renombrada');
    expect(user.userId).toBe('u1');
  });
});
