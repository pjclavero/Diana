# IDENTITY_GENERATOR = UNIQUE — evidencia (carril MP0-A)

Rama `mp0a/h2i-identity`, base `b883da0`. Todo lo de abajo es local al
repositorio: no se ha tocado ningún broker, VM ni credencial real.

## 1. Situación previa (base b883da0)

En `infrastructure/mosquitto/` había **tres** caminos que producían identidad,
ninguno subordinado a otro:

| Camino | Qué producía | Autoridad |
|---|---|---|
| `acl` (a mano) | reglas `pattern … %c` + `user backend` / `user healthcheck` | fichero editado a mano |
| `generate-users.sh` | usuarios+contraseñas en `passwd` | **cualquier** cadena que cumpliera `^[a-z0-9][a-z0-9-]{2,62}$` |
| `set-coordinator.sh` | bloque `user <module_id>` dentro de la ACL | **cualquier** cadena que cumpliera la misma regex |

Consecuencia medible del reparto: la ACL autorizaba por patrón `%c` a
*cualquier* usuario autenticado, `generate-users.sh` podía crear un usuario que
ninguna regla respalda, y ya había **drift real** en el árbol:
`tests/fixtures/topology.json` declara `module-01…module-09` mientras
`test-acl.sh` autenticaba con `-u m01` / `-u m02`, usuarios que no existen. Ese
drift produce un **falso verde**: el CONNECT falla (rc=135, *Not authorized*) y
las pruebas negativas pasan por ausencia de mensaje, no porque la ACL deniegue
(la denegación de ACL es rc=0 con `Publish … failed: Not authorized`). El
código de salida no distingue los dos casos.

## 2. Qué se integró de `ola/h2i` (448cd0a) y por qué

Leído con `git show ola/h2i:<ruta>`, sin checkout ni merge.

| Pieza | Integrada | Justificación |
|---|---|---|
| `generate-identities.mjs` | **sí**, adaptado | Es el mecanismo de fuente única: un `identities.json` → 5 artefactos deterministas + `--check` de drift. |
| `identities.json` | **sí**, reescrito | Se conserva la estructura; el contenido es el de ESTA rama (ver §3). |
| `identities.generated.env.example`, `modules.generated.json`, `users.generated.txt`, `simulators/test/fixtures/identities.generated.json` | **sí**, regenerados | Son salida del generador; no se copian, se producen. |
| `identities-fuente-unica.test.ts` | **sí**, adaptado | Prueba de coherencia de los 5 artefactos. |
| `identidades-no-se-mezclan.test.ts` | **reescrito** | El original exige que `username` y `module_id` sean **disjuntos**, que es la decisión contraria a la de esta rama (§3). |
| `test-h2i-matrix.sh`, `test-f02-security-suite.sh`, `test-provision-security-suite.sh`, `run-acl-suite.sh`, `lib/broker-runtime.sh` | **no** | Requieren broker real y arrastran los tópicos `provision` y el contrato de `ola/h2i`, que dependen de `contracts/**`, `firmware/**` y `simulators/src/**` — fuera de la propiedad de este carril. Queda como **GAP-2**. |

## 3. Divergencia deliberada respecto de `ola/h2i`

`ola/h2i` **desacopla** las dos identidades (`username=module-01`,
`module_id=m01`) y con ello retira la dependencia de
`use_username_as_clientid`. Es una decisión defendible, pero exige cambiar
`tests/fixtures/topology.json`, `simulators/src/**`, `contracts/**` y
`firmware/**`, que pertenecen a otros carriles y hoy declaran
`module_id = module-01…module-09` (los mismos 11 usuarios que el broker real:
`backend`, `healthcheck`, `module-01`…`module-09`).

Esta rama, por tanto, **conserva el cierre de F-02 tal cual**: usuario ==
module_id y `use_username_as_clientid true`. Y le suma la barrera de `ola/h2i`
que sí cabe en este carril: la ACL generada no contiene `%c` ni `%u` — cada
regla nombra al usuario autenticado con el module_id literal en el tópico.

**Dos barreras independientes, ambas vigiladas por pruebas:**

1. la ACL no autoriza por `client_id` (sin `%c`/`%u`/`pattern`);
2. usuario == module_id + `use_username_as_clientid true`.

`identity_equals_module_id: true` en la fuente hace que el generador **aborte**
si alguien rompe la invariante 2.

## 4. Unicidad: cómo se cerraron los caminos alternativos

- `generate-users.sh` ya no decide qué identidades existen: consulta
  `--list-users` de la fuente única y **rechaza** cualquier usuario no
  declarado. Añade `--all` para crear/rotar las 11.
- `set-coordinator.sh` ya no acepta cualquier `module_id` que cumpla la regex:
  lo resuelve contra la fuente única y falla si no está declarado.
- `test-acl.sh` ya no lleva `m01`/`m02` escritos a mano: toma los dos módulos
  de prueba de la fuente única y añade un **paso 0 de control positivo** de
  autenticación, de modo que un DENY por credencial inexistente (rc=135) no
  pueda volver a leerse como "ataque bloqueado".
- La ACL pasa a ser **generada**; el único otro escritor legítimo es
  `set-coordinator.sh`, que reescribe exclusivamente el bloque
  `COORDINATOR-BLOCK` y cuyo contenido el generador **preserva** (verificado:
  `set-coordinator.sh module-02` seguido de `--check` sigue en OK).
  Una prueba barre `infrastructure/**` para que no aparezca un tercer escritor.

Ningún artefacto lleva contraseñas: `passwd` sigue en `.gitignore` y las
contraseñas sólo las produce `mosquitto_passwd`.

## 5. GAPs declarados (no se afirman como cerrados)

- **GAP-1 — verificación contra broker real.** Todo lo anterior está probado
  contra los ficheros, no contra un Mosquitto vivo. La ACL generada es más
  estricta que la de base (enumera 9 módulos en vez de un patrón universal),
  por lo que antes de desplegarla hay que ejecutar `test-acl.sh` contra un
  broker de pruebas con las 11 identidades creadas. Este carril no toca
  producción.
- **GAP-2 — suites de `ola/h2i` no integradas** (`test-h2i-matrix.sh`,
  `test-f02-security-suite.sh`, `test-provision-security-suite.sh`): dependen
  de tópicos `provision` y de contratos ajenos a este carril.
- **GAP-3 — secreto en el `argv` de mosquitto_pub/sub.** `test-acl.sh` ya no
  recibe contraseñas por argv (ahora por entorno), pero `mosquitto_pub -P` las
  sigue exponiendo en su propio argv. No es evitable con esos clientes;
  ejecutar sólo en host de pruebas.
- **GAP-4 — ámbito del barrido.** La meta-prueba vigila
  `infrastructure/mosquitto/**`, `tests/fixtures/topology.json` y la fuente;
  no barre `server/**` ni `firmware/**`, propiedad de otros carriles.

## 6. Mutaciones con evidencia de rojo

| Mutación | Efecto medido | Restaurado |
|---|---|---|
| mismo `username` en dos módulos | generador rc=1 (`usuario duplicado`); suite **7 fallos / 12 pasan** de 19 | sí, 19/19 |
| quitar `use_username_as_clientid` de mosquitto.conf | `F-02 barrera 2` **falla** (1 fallo / 9 pasan de 10) | sí, 10/10 |
| drift: línea añadida a mano en la ACL | `--check` rc=1 con `DRIFT`; suite 1 fallo / 8 pasan de 9 | sí, 9/9 |
| reintroducir `pattern … %c` en la ACL | `F-02 barrera 1` **falla** (1 fallo / 9 pasan de 10) | sí, 10/10 |

Además, tres de esas mutaciones viven como **controles positivos dentro de la
suite** (se ejecutan sobre una copia de la fuente en un directorio temporal),
así que la capacidad de ponerse roja se re-mide en cada ejecución.
