import 'reflect-metadata';

import { ALL_ROLES, ROLE, roleAllows } from '../../src/domain/rbac/permissions';
import { PERMISSIONS_KEY } from '../../src/modules/auth/roles.decorator';
import { ProvisioningController } from '../../src/modules/provisioning/provisioning.controller';

/**
 * RBAC del plano DEVICE_MANAGEMENT.
 *
 * Establecer la autoridad criptográfica de un dispositivo es la operación más
 * privilegiada del sistema. NO debía heredar de `commands:publish` —que
 * `operador`, `gestor` y `mantenimiento` tienen de serie— ni de
 * `modules:write`. `provisioning:issue` no está en ningún conjunto de
 * `ROLE_PERMISSIONS`, así que hoy sólo lo cubre el `*` de `administrador`.
 *
 * Si alguien decide más adelante concedérselo a otro rol, tendrá que escribirlo
 * en `permissions.ts` y este test se lo pondrá delante en el diff.
 */

function required(method: keyof ProvisioningController): string[] {
  return (
    (Reflect.getMetadata(
      PERMISSIONS_KEY,
      ProvisioningController.prototype[method] as object,
    ) as string[]) ?? []
  );
}

describe('RBAC · emitir órdenes de aprovisionamiento', () => {
  it('las dos rutas exigen permisos propios del plano', () => {
    expect(required('issue')).toEqual(['provisioning:issue']);
    expect(required('state')).toEqual(['provisioning:read']);
  });

  it('NO reutiliza un permiso que el personal técnico ya tiene', () => {
    // Cualquiera de estos habría abierto la emisión de órdenes firmadas a
    // operador, gestor o mantenimiento sin que nadie lo decidiera.
    for (const heredado of ['commands:publish', 'modules:write', 'maintenance:write']) {
      expect(required('issue')).not.toContain(heredado);
    }
  });

  it('sólo `administrador` puede emitir órdenes', () => {
    expect(roleAllows(ROLE.ADMINISTRADOR, ['provisioning:issue'])).toBe(true);
    const otros = ALL_ROLES.filter((r) => r !== ROLE.ADMINISTRADOR);
    for (const role of otros) {
      expect(roleAllows(role, ['provisioning:issue'])).toBe(false);
      expect(roleAllows(role, ['provisioning:read'])).toBe(false);
    }
  });

  it('CONTROL POSITIVO: los mismos roles SÍ pasan un permiso que sí tienen', () => {
    // Sin esto, «todos deniegan» podría venir de un `roleAllows` que devuelve
    // siempre false, y el test de arriba no valdría nada.
    expect(roleAllows(ROLE.OPERADOR, ['commands:publish'])).toBe(true);
    expect(roleAllows(ROLE.GESTOR, ['modules:write'])).toBe(true);
    expect(roleAllows(ROLE.MANTENIMIENTO, ['maintenance:write'])).toBe(true);
  });
});

describe('el camino es frontend → backend → dominio → MQTT', () => {
  it('la única entrada humana al plano son las rutas del controlador', () => {
    const methods = Object.getOwnPropertyNames(ProvisioningController.prototype).filter(
      (m) => m !== 'constructor',
    );
    expect(methods.sort()).toEqual(['issue', 'state']);
    // Y ambas están protegidas: ninguna ruta del plano queda sin permiso.
    for (const method of methods) {
      expect(required(method as keyof ProvisioningController).length).toBeGreaterThan(0);
    }
  });
});
