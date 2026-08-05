import 'reflect-metadata';
import { SystemStatusController } from '../../src/modules/systems/system-status.controller';
import { PERMISSIONS_KEY } from '../../src/modules/auth/roles.decorator';
import { ROLE_PERMISSIONS } from '../../src/domain/rbac/permissions';

/**
 * `GET /systems/:id/status` es una ruta NUEVA. El `PermissionsGuard` es
 * PERMISIVO POR DEFECTO (sin decorador, deja pasar a cualquier usuario
 * autenticado): si mañana alguien borra `@RequirePermissions`, nada más
 * falla. Se fija aquí el metadato que el guard lee de verdad.
 */

const permisosDe = (metodo: string): string[] | undefined =>
  Reflect.getMetadata(PERMISSIONS_KEY, (SystemStatusController.prototype as never)[metodo]);

describe('SystemStatusController · la ruta EXIGE permiso', () => {
  it("status exige 'systems:read'", () => {
    expect(permisosDe('status')).toEqual(['systems:read']);
  });

  it('no se queda sin decorador (el guard dejaría pasar a cualquiera)', () => {
    expect(permisosDe('status')).toBeDefined();
    expect(permisosDe('status')!.length).toBeGreaterThan(0);
  });
});

describe('SystemStatusController · quién NO puede', () => {
  const tiene = (rol: string, permiso: string): boolean => {
    const permisos: string[] = (ROLE_PERMISSIONS as Record<string, string[]>)[rol] ?? [];
    return permisos.includes('*') || permisos.includes(permiso);
  };

  it('el jugador (sólo lo suyo) no tiene lectura amplia de sistemas', () => {
    expect(tiene('jugador', 'systems:read')).toBe(false);
  });

  it('el resto de roles autenticados sí (lectura común, dosier 23.2)', () => {
    for (const rol of ['administrador', 'gestor', 'operador', 'arbitro', 'consulta', 'mantenimiento']) {
      expect(tiene(rol, 'systems:read')).toBe(true);
    }
  });
});
