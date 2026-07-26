import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALL_ROLES,
  hasPermission,
  ROLE,
  ROLE_PERMISSIONS,
  roleAllows,
} from '../../src/domain/rbac/permissions';
import { AuthenticatedUser, PermissionsGuard } from '../../src/modules/auth/permissions.guard';

function contextFor(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function guardWith(required: string[]): PermissionsGuard {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

function userWithRole(role: string): AuthenticatedUser {
  return {
    userId: 'u1',
    username: role,
    role,
    permissions: ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] ?? [],
  };
}

describe('Roles y permisos (dosier 23.2)', () => {
  it('existen los tres roles de producto más los cuatro técnicos del dosier', () => {
    expect(ALL_ROLES).toEqual([
      'administrador',
      'gestor',
      'jugador',
      'operador',
      'arbitro',
      'consulta',
      'mantenimiento',
    ]);
  });

  it('sólo el administrador tiene el comodín', () => {
    expect(ROLE_PERMISSIONS[ROLE.ADMINISTRADOR]).toEqual(['*']);
    for (const role of ALL_ROLES.filter((r) => r !== ROLE.ADMINISTRADOR)) {
      expect(ROLE_PERMISSIONS[role]).not.toContain('*');
    }
  });

  describe('matriz de permisos', () => {
    const cases: Array<[string, string, boolean]> = [
      [ROLE.ADMINISTRADOR, 'users:write', true],
      [ROLE.ADMINISTRADOR, 'firmware:deploy', true],
      // gestor: jugador con módulos; gestiona pero NO sube firmware ni usuarios
      [ROLE.GESTOR, 'games:control', true],
      [ROLE.GESTOR, 'topology:write', true],
      [ROLE.GESTOR, 'players:write', true],
      [ROLE.GESTOR, 'firmware:deploy', true],
      [ROLE.GESTOR, 'modules:link', true],
      [ROLE.GESTOR, 'stats:reset', true],
      [ROLE.GESTOR, 'firmware:write', false],
      [ROLE.GESTOR, 'users:write', false],
      // jugador: sólo lo suyo, ninguna capacidad de gestión
      [ROLE.JUGADOR, 'profile:read', true],
      [ROLE.JUGADOR, 'games:write', false],
      [ROLE.JUGADOR, 'games:control', false],
      [ROLE.JUGADOR, 'statistics:read', false],
      // §3.4: el reinicio de estadística por partida es de gestor/admin. Un
      // jugador NO puede reiniciar la suya.
      [ROLE.JUGADOR, 'stats:reset', false],
      [ROLE.OPERADOR, 'stats:reset', false],
      [ROLE.ARBITRO, 'stats:reset', false],
      [ROLE.CONSULTA, 'stats:reset', false],
      [ROLE.MANTENIMIENTO, 'stats:reset', false],
      [ROLE.ADMINISTRADOR, 'stats:reset', true],
      [ROLE.JUGADOR, 'users:read', false],
      [ROLE.OPERADOR, 'games:control', true],
      [ROLE.OPERADOR, 'users:write', false],
      [ROLE.OPERADOR, 'firmware:deploy', false],
      [ROLE.ARBITRO, 'penalties:write', true],
      [ROLE.ARBITRO, 'ammo:write', true],
      [ROLE.ARBITRO, 'modules:write', false],
      [ROLE.ARBITRO, 'users:read', false],
      [ROLE.CONSULTA, 'games:read', true],
      [ROLE.CONSULTA, 'games:write', false],
      [ROLE.CONSULTA, 'games:control', false],
      [ROLE.CONSULTA, 'ammo:write', false],
      [ROLE.CONSULTA, 'exports:read', true],
      [ROLE.MANTENIMIENTO, 'calibration:write', true],
      [ROLE.MANTENIMIENTO, 'firmware:deploy', true],
      [ROLE.MANTENIMIENTO, 'games:control', false],
      [ROLE.MANTENIMIENTO, 'users:write', false],
    ];

    it.each(cases)('%s · %s → %s', (role, permission, expected) => {
      expect(roleAllows(role, [permission])).toBe(expected);
    });
  });

  it('un rol inexistente no concede nada', () => {
    expect(roleAllows('superusuario', ['games:read'])).toBe(false);
  });

  it('hasPermission admite comodín por recurso', () => {
    expect(hasPermission(['games:*'], 'games:control')).toBe(true);
    expect(hasPermission(['games:*'], 'users:write')).toBe(false);
  });
});

describe('PermissionsGuard', () => {
  it('deja pasar cuando el manejador no exige permisos', () => {
    const guard = guardWith([]);
    expect(guard.canActivate(contextFor(userWithRole(ROLE.CONSULTA)))).toBe(true);
  });

  it('deja pasar al administrador siempre', () => {
    const guard = guardWith(['users:write', 'firmware:deploy']);
    expect(guard.canActivate(contextFor(userWithRole(ROLE.ADMINISTRADOR)))).toBe(true);
  });

  it('rechaza a consulta cuando se exige escritura', () => {
    const guard = guardWith(['games:write']);
    expect(() => guard.canActivate(contextFor(userWithRole(ROLE.CONSULTA)))).toThrow(
      ForbiddenException,
    );
  });

  it('el mensaje de error dice qué permiso falta', () => {
    const guard = guardWith(['users:write']);
    try {
      guard.canActivate(contextFor(userWithRole(ROLE.OPERADOR)));
      throw new Error('debería haber lanzado');
    } catch (error) {
      expect((error as Error).message).toContain('users:write');
      expect((error as Error).message).toContain('operador');
    }
  });

  it('rechaza si no hay usuario autenticado', () => {
    const guard = guardWith(['games:read']);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  it('exige TODOS los permisos, no uno cualquiera', () => {
    const guard = guardWith(['games:read', 'users:write']);
    expect(() => guard.canActivate(contextFor(userWithRole(ROLE.OPERADOR)))).toThrow(
      ForbiddenException,
    );
  });
});
