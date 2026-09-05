# Huecos declarados en MP0 — provisioning de módulos

Registro de huecos abiertos durante MP0. **Ninguno se ha corregido en silencio**:
o están cerrados con evidencia, o figuran aquí con su estado real.

> **ACTUALIZACIÓN 2026-09-05 — los tres `CONTRACT_GAP` marcados `OPEN` abajo han
> avanzado.** Se dejan con su texto original porque describen fielmente por qué
> se abrieron; lo que ha cambiado es el árbol, no el razonamiento. En
> `mp0/integration@ae69357`:
>
> ```
> ADR-0008                                            ACEPTADO (2026-09-04)
> contracts/mqtt/module-provision-command.schema.json  EXISTE
> contracts/mqtt/module-provision-state.schema.json    EXISTE
> server/backend/src/contracts/topics.ts               reconoce ambos TopicKind
> ```
>
> Con eso, la frase «`contracts/` no contiene **ningún** esquema del plano
> `DEVICE_MANAGEMENT`» de `CONTRACT_GAP-DEVICE-MANAGEMENT-SCHEMA` **está
> caducada**, y la mitad contractual de los dos gaps de tópico está cerrada.
>
> **Lo que sigue abierto es el lado firmware**, y sigue abierto de verdad: el
> enum `messages.h:30-39` mantiene 9 `TopicKind` sin provisioning y
> `mqtt_client.c` no menciona `provision`, así que
> `DEVICE_MANAGEMENT_COMMAND_TRANSPORT = NOT_REACHABLE`. Fuente canónica:
> [`docs/STATE.md`](../STATE.md) §2.

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

### `CONTRACT_GAP-H4-EMPTY-VS-ABSENT` — **NO GAP / hipotesis descartada**

Al ampliar el corpus de canonicalización de D1b (paso 7) se midió el trato que la
canónica da a un campo opcional **vacío** frente a uno **ausente**.

Resultado medido, no supuesto: producen **la misma cadena canónica**, byte a byte.

| vector | `canon_len` | SHA-256 de la canónica |
|---|---|---|
| `canon_vacio_explicito` (`rotation_id=""`, `current_epoch=""`, `provision_id=""`) | 174 | `a82ad2c7…4b20fcd53` |
| `canon_vacio_ausente` (los tres campos ausentes) | 174 | `a82ad2c7…4b20fcd53` |

Es **intencional** y está documentado en `prov_canonical.c`: `canon_record()` emite
`0xFFFFFFFF` (ausente) tanto para `NULL` como para `""`, y la equivalencia es
además **inevitable en C**, porque `diana_prov_command` usa arrays fijos y no
puede representar la diferencia. La prueba de pareja de `test_provisioning.c` lo
deja fijado como propiedad, no como accidente.

Lo que sí es un hueco de contrato: **`contracts/` no contiene hoy ningún esquema
del plano `DEVICE_MANAGEMENT`**. Comprobado: ningún fichero fuera de `firmware/`
menciona `provisioning_sequence`, y `contracts/mqtt/` no tiene esquema de
aprovisionamiento. Por tanto:

- no existe una tercera opinión contractual contra la que cruzar la canónica; la
  única referencia externa es `firmware/esp32/tools/gen_prov_vectors.py` (Python,
  independiente), y el cruce C ↔ Python está verde en los 19 vectores;
- **no se abre el contrato durante D1b** (gobernanza vigente: no autorizar nuevos
  `TopicKind` ni contrato MQTT v2 en esta fase). Queda registrado para MP0-F, que
  es donde toca decidir si el plano firmado entra en `contracts/**` y, si entra,
  si el esquema debe distinguir `""` de ausente — decisión que, de tomarse en
  sentido distinguidor, **obligaría a cambiar la canónica y a rotar los vectores**.


> **Reclasificacion (decision del operador).** `""` == ausente es sencillamente la
> semantica de la implementacion actual, y no existe un tercer contrato formal que
> la contradiga. No es un hueco del producto. Se conserva la medicion de arriba
> como caracterizacion, no como deuda.

### `CONTRACT_GAP-DEVICE-MANAGEMENT-SCHEMA` — OPEN

`contracts/` no contiene **ningun** esquema del plano `DEVICE_MANAGEMENT`.
Comprobado: ningun fichero fuera de `firmware/` menciona `provisioning_sequence`,
y `contracts/mqtt/` no tiene esquema de aprovisionamiento.

Consecuencia medible: el cruce de canonicalizacion demuestra **C == Python**, no
**C == contrato**. Un cambio coordinado en ambos lados pasaria inadvertido. Es la
limitacion intrinseca de un cruce de dos implementaciones, y hoy no hay tercero
posible.

**No se resuelve dentro de D1b**: abrirlo es evolucion contractual, prohibida en
esta fase. Corresponde a MP0-F decidir si el plano firmado entra en
`contracts/**`.

### `CONTRACT_GAP-PROVISION-STATE-TOPIC` — OPEN

Sigue abierto y sin cambios: `app_provision.c` deja `out.publish` sin consumir a
proposito. El plano **puede aplicar** autoridad pero no **publica** el estado
de autoridad resultante (`DEVICE_MANAGEMENT_STATE_PATH = NOT_IMPLEMENTED`).
MP0-F querra leer ese estado, asi que probablemente sea el primer gap a cerrar
alli, ya con el contrato abierto.


### `CONTRACT_GAP-PROVISION-COMMAND-TOPIC` — OPEN

Hallado por la supervisión final, y es el gap **simétrico** del de estado: el
firmware **no se suscribe a ningún tópico de provisioning**.

`components/diana_platform_esp/src/mqtt_client.c` suscribe exactamente
`targets/v1/module/{id}/command`, `.../config/desired`, `.../ota` y
`targets/v1/system/+/game/state`. El interceptor `diana_prov_app_handle`
empareja por sufijo `/provision`, que nunca llega. Por tanto, en el binario
real, **el plano D1b no puede recibir una orden**.

Afirmación correcta, y la única que debe aparecer en el repo:

> D1b puede validar y aplicar una orden que llegue a su entrypoint, pero el
> firmware actual no dispone de un tópico MQTT contractual suscrito que pueda
> entregársela.

Estado medido, separando propiedades que no son la misma:

```
D1B_CORE_IMPLEMENTED                = YES
D1B_RUNTIME_DISPATCH_WIRED          = YES
D1B_PRESENT_IN_ELF                  = YES
DEVICE_MANAGEMENT_COMMAND_TRANSPORT = NOT_REACHABLE
DEVICE_MANAGEMENT_STATE_PATH        = NOT_IMPLEMENTED
```

**No se resuelve añadiendo el tópico ahora.** Hacerlo obligaría a introducir un
`TopicKind` nuevo, es decir a modificar de facto el contrato v1 congelado, y
justamente para poner verde un gate. Cuando se abra esa puerta debe hacerse
deliberadamente: ADR, decisión de versión contractual, tópico de comando,
estado/reporting necesario y esquemas — provisioning completo, no un tópico
huérfano.

Se transfiere explícitamente, y no desaparece al cerrar MP0:

```
MP0_ACCEPTED_BLOCKER:
    CONTRACT_GAP-PROVISION-COMMAND-TOPIC
    CONTRACT_GAP-PROVISION-STATE-TOPIC
        -> MP0-F.0 (PROVISIONING CONTRACT GATE)
```

Consecuencia de alcance, dicha en voz alta: esto **ya no puede esperar a MP1**.
Antes se creía que sólo faltaba la publicación del estado; ahora se sabe que
falta también el camino de entrada. Por eso el primer trabajo de MP0-F no es
escribir `root_key`, sino MP0-F.0.
