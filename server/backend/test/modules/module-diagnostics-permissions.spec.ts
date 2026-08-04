import 'reflect-metadata';
import { ModuleDiagnosticsController } from '../../src/modules/modules/module-diagnostics.controller';
import { PERMISSIONS_KEY } from '../../src/modules/auth/roles.decorator';
import { ROLE_PERMISSIONS } from '../../src/domain/rbac/permissions';

/**
 * Las seis rutas de diagnóstico ordenan cosas que PASAN EN LA SALA: encienden
 * LED, disparan calibraciones, hacen sonar un módulo. Ninguna prueba fijaba su
 * permiso, y el guard es PERMISIVO POR DEFECTO (`permissions.guard.ts`: sin
 * decorador, deja pasar). Es decir, borrar un decorador no rompía nada y abría
 * la ruta a cualquier usuario autenticado.
 *
 * Se comprueba el metadato del decorador, que es lo que el guard lee de verdad.
 */

const permisosDe = (metodo: string): string[] | undefined =>
  Reflect.getMetadata(PERMISSIONS_KEY, (ModuleDiagnosticsController.prototype as never)[metodo]);

describe('ModuleDiagnosticsController · toda ruta EXIGE permiso', () => {
  it.each([
    ['identify', ['modules:write']],
    ['testLed', ['maintenance:write']],
    ['testSensor', ['maintenance:write']],
    ['calibrate', ['calibration:write']],
    ['abortCalibration', ['calibration:write']],
    ['results', ['incidents:read']],
  ])('%s exige %s', (metodo, esperado) => {
    expect(permisosDe(metodo as string)).toEqual(esperado);
  });

  it('NINGUNA ruta se queda sin decorador (el guard dejaría pasar a cualquiera)', () => {
    const rutas = ['identify', 'testLed', 'testSensor', 'calibrate', 'abortCalibration', 'results'];
    for (const r of rutas) {
      expect(permisosDe(r)).toBeDefined();
      expect(permisosDe(r)!.length).toBeGreaterThan(0);
    }
  });
});

/**
 * El decorador sólo sirve si el rol correcto NO tiene ese permiso. Estas
 * comprobaciones atan las dos mitades: si mañana se le diera `calibration:write`
 * al rol `jugador`, el decorador seguiría ahí y no protegería nada.
 */
describe('ModuleDiagnosticsController · quién NO puede', () => {
  const tiene = (rol: string, permiso: string): boolean => {
    const permisos: string[] = (ROLE_PERMISSIONS as Record<string, string[]>)[rol] ?? [];
    return permisos.includes('*') || permisos.includes(permiso);
  };

  it('un jugador no puede calibrar ni encender LED', () => {
    expect(tiene('jugador', 'calibration:write')).toBe(false);
    expect(tiene('jugador', 'maintenance:write')).toBe(false);
  });

  it('el rol de sólo consulta no ordena nada físico', () => {
    expect(tiene('consulta', 'maintenance:write')).toBe(false);
    expect(tiene('consulta', 'calibration:write')).toBe(false);
    expect(tiene('consulta', 'modules:write')).toBe(false);
  });

  it('el administrador sí puede todo', () => {
    expect(tiene('administrador', 'calibration:write')).toBe(true);
    expect(tiene('administrador', 'maintenance:write')).toBe(true);
  });
});
