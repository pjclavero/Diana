# Huecos declarados en MP0 — provisioning de módulos

Registro de huecos abiertos durante MP0. **Ninguno se ha corregido en silencio**:
o están cerrados con evidencia, o figuran aquí con su estado real.

Trazabilidad: composición `mp0/integration @ b2bb09da`, sobre
`FIRMWARE_BASE = b883da0` (firmware verificado físicamente).

## No bloqueantes para MP0 (decisión del operador, 2026-08-21)

### `CONTRACT_GAP-NONCE-REJECTION-REASON`

La lista cerrada de `detail.reason` en `module-diagnostic.schema.json` se escribió
para el canal de **mantenimiento**, que el firmware todavía no implementa. Los
rechazos que hoy emite nacen del canal `module/{id}/command` y dos de ellos no
tienen un motivo exacto en esa lista:

| rechazo real | `reason` emitido | por qué es imperfecto |
|---|---|---|
| `nonce <= último aceptado` (reenvío) | `duplicate` | es una secuencia ya consumida, pero **no** el mismo `command_id` |
| `issued_at_ms` en el futuro (desfase de reloj) | `expired` | misma familia de ventana de validez, sentido contrario |

Ambos están marcados en `command.c` **en el punto donde se asignan**, no en un
comentario suelto. Si procede añadir `replay` y `clock_skew`, es decisión del
dueño de `contracts/**`. **No se abre el contrato sólo para mejorar el texto.**

Nota adicional: `schema_version` desconocida se mapea a `unknown_command`. Es
defendible pero es interpretación, no equivalencia literal del contrato.

### `CONTRACT_GAP-DO-ONLY-CROSSTALK`

Sin ADC no hay comparación de intensidad entre vecinos, sólo de desfase. El
contrato ya lo admite (vecino con `delta_us` solo), pero **la capacidad de
auditar el crosstalk en V1 es estrictamente menor**. Es una limitación física del
perfil DO-only, no un fallo del contrato. Queda el contador
`multi_trigger_count` como señal complementaria.

## Bloqueantes, pendientes de infraestructura

| hueco | qué falta | estado |
|---|---|---|
| `F02_BROKER_REAL` / `ACL_BROKER_REAL` | Mosquitto aislado | la ACL de MP0-A es **más estricta** que la vigente (9 módulos enumerados en vez de `pattern … %c`) y **nunca se ha ejercido contra un broker real** |
| `POSTGRES_MIGRATION_REAL` | PostgreSQL aislado | la migración cambia nulabilidad y añade un `CHECK`; **nunca ejecutada**. Prisma no modela `CHECK`: vive sólo en el fichero de migración |
| `ESP_IDF_BUILD` | ESP-IDF 5.5 | no existe en la máquina de desarrollo; se compila en el portátil |
| `DEVICE_MANAGEMENT_PATH_UNIQUE` | integrar el C de D1b | lo hace el **integrador**, no un carril: D1b y MP0-S pisan `diana_core` |

## Bloqueantes de seguridad y hardware

### `SECURITY_GAP-NVS-EN-CLARO`
`FIRMWARE_BASE` tiene `CONFIG_NVS_ENCRYPTION=n` y la firma de aplicación
desactivada. Fue **forzado por el build físico** (la clave no está ni debe estar
en el repositorio), no una decisión de escritorio. MP0-F escribirá `root_key` por
módulo en NVS: hoy quedaría en flash **en claro**. Debe resolverse **dentro** de
MP0-F, junto al ciclo completo de claves, no reactivando el `y` sin más.

### `HW_GAP-74HC165`
El primer 74HC165 se calentó mucho y D1 parecía activo permanente; se retiró
alimentación. Hipótesis: `DO` a 5 V entrando en lógica de 3,3 V. **PROHIBIDO
reenergizar esa cadena** hasta medir `DO` y resolver la adaptación de nivel. El
build del portátil es **sólo compilación: no se flashea**.

## Deuda declarada

- El pase `contracts-adr0007` del `Makefile` extrae contratos de otra rama a
  `/tmp`. **Ya es redundante en la composición** (el contrato reconciliado está
  en el árbol) y debe retirarse al fusionar.
- `test-acl.sh` del repositorio autentica con `m01`/`m02`, **usuarios que no
  existen**: sus negativos pasan por fallo de autenticación, no por ACL. Mismo
  defecto estructural corregido en la rama de P0-2 y nunca devuelto al repo.
- `npm run typecheck` del backend falla por `@prisma/client` ausente en
  `server/worker`. Preexistente.
