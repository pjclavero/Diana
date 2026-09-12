import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Campos escribibles del módulo, por operación.
 *
 * Se exportan para que las pruebas puedan afirmar la AUSENCIA de `slug` y
 * `configVersion` sobre el dato real y no sobre una copia del mismo literal:
 * una prueba que reescriba la lista pasa aunque el servicio cambie.
 *
 * Lo que ya NO está en ninguna de las dos listas:
 *  - `configVersion` (hoy `desiredConfigVersion`): es propiedad del sistema.
 *    Sólo la avanza `ModuleConfigService.push`, una vez por empujón, con una
 *    reserva atómica. Un cliente que pudiera fijarla podría hacerla retroceder
 *    y con ello lograr que el módulo aceptase una configuración vieja como
 *    nueva, o adelantarla para que ignorase la siguiente de verdad.
 *  - `reportedConfigVersion`, `configState`, `configAppliedAt`: son
 *    OBSERVACIONALES. Sólo los escribe la ingesta de `config/reported` con un
 *    mensaje real del módulo. Poder escribirlos por REST equivaldría a poder
 *    declarar aplicada una configuración que nadie aplicó.
 *  - `online`, `lastSeenAt`, `offlineSince`, `bootId`: presencia observada.
 *    Nunca estuvieron, y se dice aquí para que no vuelvan.
 *  - `role`, `selector`, `selectorObservedAt`: posición del interruptor FÍSICO,
 *    observada en `module-status` (3.1). SÍ estuvieron aquí, y era un agujero:
 *    con la elección automática de coordinador, poder escribir `selector` por
 *    REST equivaldría a declararse coordinador sin tocar el hardware —el
 *    backend elegiría sobre un dato que nadie ha observado—. La única vía de
 *    escritura es ahora la ingesta de `module-status`.
 */
export const MODULE_CREATABLE_FIELDS = [
  'slug',
  'targetSystemId',
  'friendlyName',
  'serial',
  'mac',
  'ip',
  'hardwareRevision',
  'targetBoard',
  'firmwareVersion',
  'state',
  'maintenance',
] as const satisfies readonly string[];

/** Los creables MENOS `slug`: la identidad no se parchea. */
export const MODULE_UPDATABLE_FIELDS = MODULE_CREATABLE_FIELDS.filter(
  (f) => f !== 'slug',
) as string[];

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class ModulesService extends CrudService {
  constructor(prisma: PrismaService) {
    // `ownerId` NO es escribible por el CRUD: la propiedad se cambia sólo por
    // los endpoints link/unlink (ModuleOwnershipService), que aplican la regla
    // gestor⇄jugador y la auditoría. El `include` expone el dueño en lecturas.
    super(
      prisma.module,
      'module',
      // ── CREABLES ──────────────────────────────────────────────────────────
      // `slug` está AQUÍ y sólo aquí: es el `module_id` de MQTT y, por F-02, el
      // usuario del broker y el `client_id` que el broker impone. Se elige al
      // dar de alta el dispositivo y desde ese momento es identidad.
      [...MODULE_CREATABLE_FIELDS],
      {
        position: true,
        targets: true,
        owner: {
          select: { id: true, username: true, displayName: true, role: { select: { name: true } } },
        },
      },
      // ── MODIFICABLES ──────────────────────────────────────────────────────
      MODULE_UPDATABLE_FIELDS,
    );
  }
}
