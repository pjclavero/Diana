# P0-2 · Inventario de reconciliación `hotfix/p02-tls-6da16d4` → `mp0/integration`

> **Este documento NO es un plan de merge.** Es un inventario clasificado, delta a
> delta, hecho comparando **contenido** (`git show` / `git diff` entre árboles), no
> mensajes de commit. Fusionar `hotfix/p02-tls-6da16d4` con `git merge` **regresaría**
> trabajo posterior de `mp0/integration` (ACL generada, `PublishResult`, identidades,
> `dispatchByFilter`, canal de mantenimiento). Está prohibido.

## 1. Cabecera

| dato | valor |
|---|---|
| repo | `https://github.com/pjclavero/Diana.git` |
| rama de trabajo | `lane/infra-p02` |
| `BASE_SHA` (= `origin/mp0/integration`) | `ae6935746cdaf5c57bf70b9a9264757c34efe4f1` |
| `HEAD_SHA` (esta rama al inventariar) | `ae6935746cdaf5c57bf70b9a9264757c34efe4f1` |
| fuente inventariada | `origin/hotfix/p02-tls-6da16d4` = `ad2d166dbef9e93a2f284e4c85ddecc17d1185a3` |
| ancestro común (`merge-base`) | `6da16d431556fae2f50a81d89e90225364063dc4` |
| divergencia medida | **16 commits** exclusivos del hotfix · **76** exclusivos de integración |
| fecha del inventario | 2026-09-05 |
| carril | INFRA-P02, Ola 1 |

Divergencia real y vieja: el hotfix se ramificó de `6da16d4` (2026-08-12/13) y
`mp0/integration` ha reconstruido desde entonces buena parte de los mismos ficheros
con criterios **más estrictos** en unos casos y **sin TLS en absoluto** en otros.

### Estado de partida, medido (no de memoria)

`git show origin/mp0/integration:infrastructure/mosquitto/mosquitto.conf` parseado por
directivas efectivas:

```
listener 1883        <- MQTT EN CLARO, es el único listener MQTT
protocol mqtt
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl
use_username_as_clientid true
listener 9001        <- WebSockets, también en claro
use_username_as_clientid true
```

No hay ni una directiva `cafile`/`certfile`/`keyfile` activa. `compose.yml` publica
`"${MQTT_PORT:-1883}:1883"`. `configuration.ts` tiene `url: process.env.MQTT_URL ??
'mqtt://mosquitto:1883'` y **no** conoce `MQTT_CA_FILE`.

```
INTEGRATION_TLS_STATE = NONE      (hoy, medido)
```

Coincide con lo que `CANONICAL_BRANCHES.md:131` y `docs/coordination/STATUS.md:107`
(X-11 / F-07) ya declaran abierto.

---

## 2. Tabla commit a commit

Orden cronológico. La clasificación es del **delta neto** del commit frente a lo que
`mp0/integration` tiene HOY, no frente a `6da16d4`.

| # | commit | asunto (abreviado) | clasificación | justificación (medida) |
|---|---|---|---|---|
| 1 | `732dab8` | validación de CA en el cliente del backend | **PORT** | El `mqtt.service.ts` del hotfix es **anterior** al de integración: le faltan `PublishResult`, la detección de PUBACK `reasonCode≥0x80`, `recordPublishDenied`, el canal `maintenance` y la retirada de `sendModuleCommand`. Sólo se porta el método `tlsOptions()` + el spread `...this.tlsOptions()` en `connect`, y en `configuration.ts` el campo `caFile` y la construcción de `url` desde `MQTT_PROTOCOL/HOST/PORT`. Nunca el fichero entero. |
| 2 | `2586dbc` | estado real del árbol de producción, explícito | **MIXTO — descomponer** | Toca 7 ficheros con destinos distintos: `mosquitto.conf` **PORT**, `compose.yml` **PORT**, `generate-certs.sh` **TAKE**, `verify-restore.sh` **TAKE**, `backup.sh`/`restore.sh` **TAKE**, `acl` **SUPERSEDED**. Ver §3. |
| 3 | `c7208e2` | worker: retirar toda credencial y configuración MQTT | **TAKE** | Integración sigue pasando `MQTT_USERNAME`/`MQTT_PASSWORD` del **backend** al worker (`compose.yml:204-207`), que no es cliente MQTT. Mínimo privilegio; delta pequeño y aislado, sin dependencia del TLS. |
| 4 | `2e849ec` | correcciones del supervisor independiente | **MIXTO** | `.gitignore`: la parte `passwd` sin anclar es **ALREADY_PRESENT** (integración ya lo arregló al final del fichero con `infrastructure/mosquitto/passwd`); la línea `certs/` es **TAKE** (integración no la tiene y `generate-certs.sh` escribe ahí). `.env.example`/`compose.yml`/`mosquitto.conf` **PORT**. `tls-endpoint-default.spec.ts` **TAKE**. |
| 5 | `56bd768` | segunda ronda del supervisor | **PORT** | Refina `.env.example`, `compose.yml`, `mosquitto.conf` y el test de endpoint. Aporta la evidencia `p02-baseline-produccion.md` (**TAKE**). El delta de `acl` es **SUPERSEDED**. |
| 6 | `72e15f7` | control real sobre `MQTT_URL` y barrido completo | **PORT** | Núcleo de la escapatoria: `MQTT_URL` tiene precedencia absoluta y un `mqtt://` la anula entera. Aporta el aborto en producción dentro de `tlsOptions()`. Los docs (`findings.md`, `threat-model.md`, `STATUS.md`, `mqtt-acl.md`) son **CONFLICT** (ver §3.11). `04-firewall.sh` **TAKE**. |
| 7 | `3f9e93e` | cerrar el listener en claro dando TLS a la herramienta | **MIXTO** | Retirada del 1883: **PORT** en `mosquitto.conf`/`compose.yml`/`compose.dev.yml`. Simulador (`cli.ts`, `mqttjsTransport.ts`): **PORT** de sólo `--cafile`/`caFile`/`tlsOptions()`; el resto del fichero del hotfix es anterior (pierde `dispatchByFilter` y `pendingFilters`) → tomarlo sería una regresión medida. `test-acl.sh` **CONFLICT**. `broker-sin-listener-en-claro.spec.ts` **TAKE**. `p02-tls-fail-closed.test.ts` (simuladores) **TAKE**. |
| 8 | `53bc6d1` | la prueba de ACL deja de aprobar por fallo de autenticación | **CONFLICT** | Integración resolvió **el mismo defecto** (falsos verdes por AUTH_DENIED) por otra vía: leer identidades reales de `identities.json`. El hotfix usa identidades desechables `module-acltest-a/b` + `module-aclobserver`. No se puede tomar ninguna de las dos enteras. `main.ts` (`bootstrap().catch`) es **TAKE**, aislado y necesario para que el fail-closed se lea. |
| 9 | `1f3786d` | el arnés tenía el defecto que denunciaba | **PORT** | Endurece el test de puertos: parsea **YAML**, no regex; un puerto no interpretable **lanza**. Exige añadir `js-yaml` a `server/backend/package.json` (devDependency **ausente** hoy en integración: verificado). Los 3 workflows son sólo comentarios → **ALREADY_PRESENT** funcionalmente (el `MQTT_URL: mqtt://localhost:1883` de CI ya es idéntico y es correcto: broker efímero, y `tlsOptions()` sólo aborta con `NODE_ENV=production`). |
| 10 | `13ba6be` | cerrar las evasiones supervivientes (D-1..D-9) | **MIXTO** | `generate-users.sh` **SUPERSEDED** (el de integración impone `identities.json` como fuente única, `LC_ALL=C`, `--all`, y rechaza usuarios no declarados: estrictamente mejor). Se rescatan **sólo** tres avisos operativos como **PORT** de comentario: montaje `:ro` del `passwd`, propietario legible por uid 1883, y SIGHUP tras el alta. `mosquitto.conf`/`compose.yml`/`test-acl.sh` según sus filas. |
| 11 | `f003879` | test-acl.sh ejecutado E2E contra broker real | **TAKE** | Documento de evidencia nuevo (`p02-test-acl-e2e.md`). El doc de despliegue que también toca sí colisiona (ver §3.11). |
| 12 | `f682876` | F-02 verificada sobre el broker REAL bajo TLS | **TAKE** | Amplía la misma evidencia. Es el único registro de F-02 medida **bajo TLS**; su valor no depende de qué código se porte. |
| 13 | `ff046d9` | saneamiento forense del árbol de producción | **TAKE** | `p02-saneamiento-arbol-produccion.md`: inventario de sólo lectura de `/opt/diana`, con clases A-E y sha256 vivos. Documento nuevo, sin colisión. |
| 14 | `0b1d8b0` | saneamiento ejecutado + la CA sale del árbol | **TAKE** | Fija la semántica clave: `ca.key` vive en `$CA_DIR` (`/root/diana-pki`), **fuera** del árbol de despliegue. Modifica `generate-certs.sh`, que es fichero nuevo. |
| 15 | `740af9e` | regresión automatizada de la semántica de la CA | **TAKE** | `pki-ca-fail-closed.spec.ts`: fichero nuevo, sin colisión. |
| 16 | `ad2d166` | plegar D-1, D-2 y D-3 antes del build | **TAKE** | Cabeza del hotfix. Guardarraíl `comprobar_ca_key_fuera()` invocado en **todas** las salidas de `generate-certs.sh` (antes sólo en la ruta menos transitada). Es exactamente el patrón "prueba capaz de ponerse roja". |

El conteo **vinculante** de clasificaciones es el de la tabla por tema (§3): varios
commits reparten deltas hacia destinos distintos y contarlos por commit engaña.

---

## 3. Tabla por tema

Once temas, uno a uno, con lo que hay **hoy** en `mp0/integration` frente al hotfix.

### 3.1 `listener 8883` y configuración TLS de Mosquitto — **PORT**

| | |
|---|---|
| **integración** | `listener 1883` + `protocol mqtt`. Bloque TLS **comentado** con receta "descomenta esto". Sin `cafile`/`certfile`/`keyfile` activos. |
| **hotfix** | `listener 8883`, `cafile /mosquitto/certs/ca.crt`, `certfile server.crt`, `keyfile server.key`, `require_certificate false`, `tls_version tlsv1.2`. Receta comentada **eliminada** a propósito ("invita a reabrir un listener en claro por error"). |

Se porta el bloque de listener, no el fichero: el `mosquitto.conf` de integración tiene
comentarios propios sobre F-02 (barrera 1 vs barrera 2, `identidades-no-se-mezclan.test.ts`)
que el hotfix **no** tiene y que no deben perderse. `require_certificate false` es
deliberado: TLS **de servidor**; mTLS cambiaría el modelo de identidad y queda fuera.

Deuda que el hotfix documenta y **hay que preservar al portar**: el `listener 9001`
(WebSockets) sigue **en claro**, dentro de la red interna, con el mismo `password_file`
y la misma ACL. Nunca escribir "no queda ningún camino en claro" a secas.

### 3.2 Retirada del 1883 productivo — **PORT**, con condición previa (R1)

| | |
|---|---|
| **integración** | `compose.yml:303` publica `"${MQTT_PORT:-1883}:1883"`. El broker escucha en claro y el puerto está publicado al host. |
| **hotfix** | Publica sólo `"${MQTT_TLS_PORT:-8883}:8883"`. El `listener 1883` desaparece **también de la red interna**, con lápida escrita en el `.conf` ("NO REABRIR para depurar"). |

Sí se retira, y sin dejar perfil de laboratorio *en producción*. El laboratorio queda
en dos sitios separados y aislados:

- **perfil `test`**: el hotfix mueve `postgres-test`, `mosquitto-test` y
  `contracts-validate` de la red `internal` a una red nueva `testnet`. Es un delta
  **independiente y valioso**: hoy en integración el broker de pruebas —que escucha en
  claro a propósito— **comparte red con producción** en cuanto se activa el perfil.
  Clasificado **TAKE** por separado.
- **CI**: `MQTT_URL: mqtt://localhost:1883` en los tres workflows. Correcto y se queda:
  broker efímero sin credenciales reales, y el aborto de `tlsOptions()` sólo dispara con
  `NODE_ENV=production`. **ALREADY_PRESENT** (idéntico); sólo cambian comentarios.

Aviso del propio hotfix que sobrevive intacto y es **bloqueante para el hardware**: el
firmware vigente lleva `mqtt://%s:1883` **cableado** y no puede usar el 8883. Retirar el
1883 deja a los módulos físicos fuera hasta que exista el carril de TLS de firmware.

### 3.3 CA y certificados — **TAKE**

| | |
|---|---|
| **integración** | No existe `generate-certs.sh`. `.gitignore` cubre `*.key` y `infrastructure/mosquitto/passwd`, **no** `certs/`. |
| **hotfix** | `generate-certs.sh` nuevo (173 líneas): CA propia en `$CA_DIR` (`/root/diana-pki`, root-only, **fuera** de `/opt/diana`), `ca.crt`/`server.crt` 0644, `server.key` 0600, SAN con `mosquitto`, `localhost`, `127.0.0.1` e IP de LAN; idempotente; `FORCE=1` rota servidor, `NEW_CA=1` crea CA nueva; guardarraíl `comprobar_ca_key_fuera()` en todas las salidas. `.gitignore` añade `certs/`. |

**Material que NO debe entrar nunca en el repositorio** (§6): `ca.key`, `server.key`,
`server.crt`, `ca.crt`, `infrastructure/mosquitto/passwd`. Comprobado: el árbol del
hotfix **no contiene** ningún `.key`/`.crt`/`.pem` ni `passwd` (`git ls-tree -r` sobre
la rama: cero coincidencias). No hay secreto que exfiltrar en este porte.

`ca.crt` (público) sí se monta, y **fichero a fichero**, nunca el directorio: montar
`certs/` entero metería `ca.key` en el contenedor si alguien la deja ahí. Los montajes
del hotfix ya son individuales y `:ro`.

### 3.4 TLS en backend — **PORT** (`configuration.ts`, `mqtt.service.ts`) · **TAKE** (`main.ts`)

| | |
|---|---|
| **integración** | `configuration.ts`: `url: MQTT_URL ?? 'mqtt://mosquitto:1883'`; **no existe** `caFile`. `mqtt.service.ts` conecta sin opciones TLS. `main.ts` usa `void bootstrap()`. |
| **hotfix** | `caFile: process.env.MQTT_CA_FILE \|\| null`; URL compuesta desde `MQTT_PROTOCOL ?? 'mqtts'` + `MQTT_HOST` + `MQTT_PORT ?? 8883`; `tlsOptions()` con tres fallos cerrados; `bootstrap().catch()` que imprime la causa y `exit(1)`. |

Defecto que el hotfix corrige y que **sigue vivo en integración**: `compose.yml` pasa
`MQTT_HOST`/`MQTT_PORT` y `configuration.ts` **sólo lee `MQTT_URL`** → cambiar el puerto
en compose no tiene efecto ninguno. Configuración que aparenta gobernar algo que no
gobierna.

Sólo se portan esos bloques. Tomar `mqtt.service.ts` del hotfix **borraría**
`PublishResult`, la lectura de `reasonCode` del PUBACK MQTT5, `recordPublishDenied`,
`sendModuleMaintenanceCommand` y la retirada de `sendModuleCommand`, y devolvería
`publish()` a síncrono. Eso es **DO_NOT_TAKE** explícito.

### 3.5 TLS en worker — **TAKE**

| | |
|---|---|
| **integración** | El worker recibe `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME` y `MQTT_PASSWORD` **del backend** (la credencial más privilegiada del broker) sin ser cliente MQTT. |
| **hotfix** | Las cuatro variables retiradas, con justificación medida (sin `mqtt` en su `package.json`, sin código MQTT en `server/worker/src`, único interlocutor TCP = postgres). |

No es TLS: es superficie de robo. Delta independiente, portable el primero.

### 3.6 TLS en simulador — **PORT**

| | |
|---|---|
| **integración** | `MqttJsTransportOptions` sin `caFile`; `cli.ts` sin `--cafile`; `compose.yml` le pasa `MQTT_HOST`/`MQTT_PORT` que **el simulador no lee** (su broker se elige sólo con `--broker`). |
| **hotfix** | `caFile?: string`, `tlsOptions()` con el mismo criterio que el backend (lanza si `mqtts://` sin CA; en claro se permite sin ruido, porque el laboratorio es caso legítimo), `--cafile` en `cli.ts`, montaje `ca.crt:ro` en `compose.yml`, retirada de las dos variables muertas. |

Igual que el backend: **sólo** el añadido TLS. El `mqttjsTransport.ts` del hotfix es
anterior y perdería `dispatchByFilter` y `pendingFilters` — el encaminamiento por filtro
cuya ausencia tumbaba la ingesta (X-18-INGESTA). Tomarlo entero es **DO_NOT_TAKE**.

### 3.7 Healthcheck — **PORT** (mosquitto) · **TAKE** (backup)

| | |
|---|---|
| **integración (mosquitto)** | `mosquitto_pub -h 127.0.0.1 -p 1883 -u … -t _health/probe`. |
| **hotfix (mosquitto)** | `mosquitto_pub -h localhost -p 8883 --cafile /mosquitto/certs/ca.crt …`. Va por TLS contra un nombre presente en el SAN, así que comprueba también que el material TLS sigue válido. |
| **integración (backup)** | `pgrep -f cron-loop-entrypoint.sh` — sólo "el bucle vive". |
| **hotfix (backup)** | proceso vivo **+** `grep '^OK '` en `/backups/last-status` **+** copia con menos de 1800 min. `start_period` 30s, `timeout` 10s. |

El healthcheck de backup **depende** del `last-status` que escribe `backup.sh` (§3.11):
portarlo antes deja el servicio en `unhealthy` permanente. Dependencia dura.

Ojo también con el `pgrep -f`: el patrón puede autocoincidir. El hotfix lo redirige a
`/dev/null` y lo combina con condiciones de efecto (fichero de estado, antigüedad), que
es la forma correcta.

### 3.8 ACL y la invariante F-02 — **SUPERSEDED / DO_NOT_TAKE**

| | |
|---|---|
| **integración** | ACL **GENERADA** desde `infrastructure/mosquitto/identities.json` (`generate-identities.mjs`, con `--check`). **Cero** `%c`/`%u` en reglas (medido: las 2 apariciones están en comentarios). Una regla literal por identidad autenticada: `backend`, `module-01`…`module-09`, `healthcheck`. F-02 cerrada con **dos barreras independientes**. |
| **hotfix** | ACL escrita a mano con **26** apariciones de `%c`. F-02 cerrada con **una sola** barrera (`use_username_as_clientid` + usuario==module_id). |

Es la inversión más importante del inventario: aquí **integración es estrictamente
mejor**. Portar la ACL del hotfix **reabriría** el modelo de autorización por client_id
que F-02 denunció. La única línea rescatable es el usuario de prueba `module-aclobserver`
(+ `module-acltest-a/b`), que sólo hace falta si se adopta el arnés del hotfix →
**NEEDS_DECISION**, atado a §3.9.

Ambas ramas ya llevan el plano `provision` (DEVICE_MANAGEMENT v1.5): **ALREADY_PRESENT**.

Conclusión del hotfix que conviene conservar aunque su ACL se descarte: el formato
`acl_file` de Mosquitto **no puede** condicionar una regla al flag `retain`; la
prohibición de "provisioning no retenido" es de aplicación en el receptor, no de ACL.

### 3.9 Tests del broker

| fichero | estado |
|---|---|
| `server/backend/test/mqtt/tls-fail-closed.spec.ts` | **TAKE** (nuevo) |
| `server/backend/test/mqtt/tls-endpoint-default.spec.ts` | **TAKE** (nuevo) |
| `server/backend/test/mqtt/pki-ca-fail-closed.spec.ts` | **TAKE** (nuevo) |
| `server/backend/test/mqtt/broker-sin-listener-en-claro.spec.ts` | **TAKE** (nuevo) — **requiere `js-yaml`** |
| `simulators/test/p02-tls-fail-closed.test.ts` | **TAKE** (nuevo) |
| `infrastructure/mosquitto/test-acl.sh` | **CONFLICT** |

Los cinco primeros son ficheros nuevos: `server/backend/test/mqtt/` en integración
contiene `connected-since`, `maintenance-command-topic`, `no-backend-writes-game-command`,
`no-floating-mqtt-promises`, `publish-ack-timeout`, `publish-denied` — ninguna colisión
de nombre. `js-yaml` **no** está en `server/backend/package.json` de integración
(verificado): hay que añadirlo como devDependency o el test no arranca.

`broker-sin-listener-en-claro.spec.ts` es el guardián del tema 3.2 y merece leerse
entero antes de portar: parsea YAML (una versión anterior con regex era esquivable con
la sintaxis larga `- target: 1883 / published: 1883`, y la siguiente con un **rango**
`- "1880-1890:1880-1890"` que `Number()` convertía en `NaN` y un filtro descartaba).
Ahora un puerto no interpretable **lanza**. Y su primer `it` **afirma** que el 9001
sigue en claro: deuda declarada, no camino olvidado — si alguien pone TLS al 9001, el
test se rompe a propósito para que se venga a borrar la deuda a mano.

`test-acl.sh` es **CONFLICT** genuino: las dos ramas arreglaron el **mismo** defecto
(pruebas negativas en verde porque el CONNECT fallaba) por caminos incompatibles.
Integración lee las identidades de la fuente única y no sabe hablar TLS (`HOST`/`PORT`
parametrizados, sin `--cafile`). El hotfix habla TLS y usa identidades desechables.
Reconciliación propuesta: **conservar la base de integración** y portarle sólo el
transporte TLS (parámetro `CAFILE` y `--cafile` en cada `mosquitto_pub`/`sub`) más las
dos reglas de método del hotfix: (1) un rechazo de AUTENTICACIÓN nunca cuenta como
demostración de AUTORIZACIÓN, y (2) preflight con exigencia **positiva** —"distinto de
AUTH_DENIED" no vale, porque cualquier fallo de red o TLS caería en el `else` y se
anunciaría como OK.

Nota lateral encontrada al parsear: el `test-acl.sh` de integración declara `HOST`/`PORT`
**dos veces** (líneas 110-111 y 129-130) con `usage` distintos. Defecto preexistente, no
del porte, pero conviene mirarlo al tocar el fichero.

### 3.10 Comportamiento fail-closed — **PORT** (+ **TAKE** de `main.ts`)

| | |
|---|---|
| **integración** | Ninguno relativo a TLS. Un `MQTT_URL=mqtt://…` sencillamente funciona. |
| **hotfix** | Tres cierres: (a) URL TLS **sin** `MQTT_CA_FILE` → lanza en el arranque; (b) CA ilegible → lanza; (c) URL en claro con `NODE_ENV=production` → **aborta**; fuera de producción, avisa. `rejectUnauthorized: true` explícito; `servername` **no** se fija a mano (fijarlo desactivaría de hecho la verificación de nombre). `main.ts` hace que la causa se **lea** en vez de salir como unhandled rejection. |

Es el núcleo defensivo del carril: sin (c), `MQTT_URL` sigue siendo la escapatoria que
anula todo lo demás sin romper nada visible.

### 3.11 `verify-restore.sh`, backups y documentación

**`verify-restore.sh`** (212 líneas, sólo en el hotfix) — **TAKE**. Ensayo de
restauración real, aislado y desechable: siembra un postgres desechable con la última
copia **automática** real, inserta marcadores, levanta una instancia desechable del
**planificador real** (la copia la dispara el cron, no el operador), restaura en un
segundo postgres desechable con el `restore.sh` real, verifica marcadores, autoridad,
esquema, índices, constraints *vivas* y enums, y compara huellas. Incluye **control
positivo**: repite contra una copia truncada y una vacía; si esas no fallan, el ensayo
se declara sin valor. No toca producción (sólo lee del volumen).

**`backup.sh` / `restore.sh`** — **TAKE**. Corrigen un defecto medido en VM109
(2026-08-09): sin `pipefail` en `/bin/sh`, un `pg_dump` fallido devolvía el rc de `gzip`
(0) y el script publicaba un `.sql.gz` **válido de 20 bytes y cero contenido**, lo
copiaba a weekly e imprimía "finalizado correctamente" con rc=0. El hotfix propaga el rc
por fichero, valida `gzip -t` y el marcador `PostgreSQL database dump complete`, pone
`chmod 600` al volcado (contiene hashes de contraseña) y escribe `last-status`.
`restore.sh` hace lo simétrico. Es exactamente la clase de defecto que este proyecto
resume como "`exit 0` no es evidencia": **conviene portarlo aunque el TLS se retrase**.

**Documentación** — clasificación mixta:

| documento | estado |
|---|---|
| `docs/security/evidence/p02-baseline-produccion.md` | **TAKE** (nuevo) |
| `docs/security/evidence/p02-saneamiento-arbol-produccion.md` | **TAKE** (nuevo) |
| `docs/security/evidence/p02-test-acl-e2e.md` | **TAKE** (nuevo) |
| `docs/operations/operacion.md` | **CONFLICT** (+127 líneas sobre base divergente) |
| `docs/deployment/procedimiento.md` | **CONFLICT** (+73) |
| `docs/security/findings.md` (F-07/X-11) | **CONFLICT** — no cerrar hasta que el porte esté **medido** |
| `docs/security/threat-model.md`, `accepted-risks.md`, `infrastructure/README.md`, `simulators/README.md` | **PORT** (párrafos concretos) |
| `docs/coordination/STATUS.md` | **DO_NOT_TAKE desde este carril** (propiedad ajena; §6) |
| `docs/security/evidence/mqtt-acl.md` | **SUPERSEDED** (integración documenta la ACL generada) |

Los tres documentos de evidencia son ficheros **nuevos**, sin colisión, y son el único
registro de que F-02 se verificó **sobre el broker real bajo TLS**. Se toman aunque el
código se porte más tarde: son historia medida, no configuración.

---

## 4. Orden de porteo recomendado

Cada paso es un PR pequeño y verificable. Las dependencias son duras salvo donde se diga.

```
 0. (previo, sin código)  decisiones D1-D3 del operador  ──────────► §5
     │
 1.  worker: retirar MQTT_* de compose.yml            (indep.)
 2.  perfil test → red `testnet`                      (indep.)
 3.  backup.sh + restore.sh (rc, gzip -t, marcador,   (indep.)
     chmod 600, last-status)
     └─► 4. healthcheck de backup en compose.yml       (DEPENDE de 3)
 5.  verify-restore.sh                                 (DEPENDE de 3)
 6.  .gitignore: añadir `certs/`                       (indep.)
     └─► 7. generate-certs.sh                          (DEPENDE de 6)
         └─► 8. mosquitto.conf: listener 8883 + TLS,   (DEPENDE de 7)
                 SIN retirar aún el 1883
             └─► 9. compose.yml: publicar 8883, montar
                     los 3 ficheros de cert, healthcheck
                     del broker por TLS  (8883 y 1883 conviven)
                 └─► 10. configuration.ts: caFile +
                          URL desde PROTOCOL/HOST/PORT
                     └─► 11. mqtt.service.ts: tlsOptions()
                              + main.ts bootstrap().catch()
                         └─► 12. .env.example y
                                  server/backend/.env.example
                             └─► 13. simulador: caFile + --cafile
                                 └─► 14. test-acl.sh: transporte TLS
                                          sobre la base de INTEGRACIÓN
                                     └─► 15. VERIFICAR F-02 y ACL contra
                                              el 8883 (broker de laboratorio)
                                         └─► 16. RETIRAR el 1883
                                                  (conf + compose + compose.dev
                                                   + 04-firewall.sh)
                                             └─► 17. tests de regresión
                                                      (js-yaml + los 5 spec)
                                                 └─► 18. documentación y
                                                          evidencias
```

Tres claves del orden:

- **8883 y 1883 conviven de los pasos 8 al 15.** Retirar el claro *antes* de haber
  medido que el TLS funciona convierte un carril de seguridad en una caída.
- **El paso 11 es el punto de no retorno del backend**: en cuanto `tlsOptions()` entra,
  `NODE_ENV=production` (que es el **defecto** de `compose.yml`) **aborta el arranque**
  si la URL no es `mqtts://`. Por eso 12 no puede ir después.
- **17 va al final**: `broker-sin-listener-en-claro.spec.ts` se pone **roja** mientras
  exista el 1883. Portarlo antes del paso 16 rompe CI por diseño.

---

## 5. Riesgos

### R1 · Los módulos ESP32 físicos se quedan fuera (BLOQUEANTE)

El firmware vigente lleva `mqtt://%s:1883` **cableado**: no puede hablar 8883. El propio
hotfix lo dice y corrige el comentario de `compose.yml` que afirmaba lo contrario. En
cuanto se ejecuta el paso 16, todo módulo físico deja de conectar hasta que exista el
carril de TLS de firmware. **Exige decisión humana** (D1).

### R2 · Regresión silenciosa por porte "de fichero" en vez de "de delta"

Tres ficheros del hotfix son **anteriores** a los de integración y tomarlos enteros
borra trabajo posterior sin ningún conflicto de git que avise:

| fichero | qué se perdería |
|---|---|
| `mqtt.service.ts` | `PublishResult`, `reasonCode` del PUBACK, `recordPublishDenied`, canal de mantenimiento, `publish()` asíncrono |
| `simulators/src/transport/mqttjsTransport.ts` | `dispatchByFilter`, `pendingFilters` — el encaminamiento cuya ausencia tumbaba la ingesta (X-18) |
| `infrastructure/mosquitto/acl` | la segunda barrera de F-02: volvería a autorizar por `%c` |

Mitigación: ningún paso del §4 usa `git checkout <hotfix> -- <fichero>` sobre estos
tres. Se editan a mano y se verifica **parseando** (AST / directivas), no contando texto.

### R3 · Fallo cerrado que tumba producción en el arranque

`tlsOptions()` **lanza** con CA ausente o ilegible, y `main.ts` termina el proceso.
Combinado con `NODE_ENV: ${NODE_ENV:-production}` en `compose.yml`, cualquier despliegue
que llegue con el orden alterado (código nuevo, `.env` viejo, o `ca.crt` no montado) deja
el backend en bucle de reinicio. Es el comportamiento **correcto**, y por eso el orden de
§4 es vinculante. Riesgo hermano ya documentado en el hotfix: `passwd` en 0600 con
propietario que el uid 1883 del broker no puede leer → "Unable to open pwfile" y bucle de
reinicio del broker.

### Riesgos menores, pero reales

- **R4** — `certs/` en `.gitignore` **antes** de generar nada. Al revés, un `git add -A`
  en la VM committea `server.key`. El orden de §4 lo respeta.
- **R5** — el healthcheck de backup portado sin `last-status` deja el servicio
  `unhealthy` para siempre; y `depends_on: service_healthy` puede propagarlo.
- **R6** — `js-yaml` ausente: el test de puertos no arranca y su verde es vacío.
- **R7** — hasta el paso 2, el broker de pruebas en claro comparte red `internal` con
  producción siempre que se active el perfil `test`.
- **R8** — el `listener 9001` **sigue en claro** después de todo el porte. No escribir en
  ningún documento "no queda ningún camino en claro"; la afirmación cierta y defendible
  es "no queda ningún camino **MQTT/TCP** en claro".

### Decisiones que exigen al operador

| id | decisión | por qué no puede tomarla un agente |
|---|---|---|
| **D1** | ¿Se retira el 1883 productivo **antes** de que el firmware hable TLS, aceptando que los módulos físicos queden fuera? ¿O el paso 16 se congela hasta el carril de firmware? | Deja hardware real sin servicio. |
| **D2** | Ubicación definitiva de `ca.key` y política de rotación (`CA_DIR=/root/diana-pki` es el defecto del script; el destino declarado es almacenamiento **offline** separado de la VM). | Custodia de material criptográfico. |
| **D3** | Identidades de prueba de `test-acl.sh`: ¿se adoptan `module-acltest-a/b` + `module-aclobserver` (obliga a añadirlas a `identities.json`, la fuente única, y a crear sus contraseñas), o el arnés TLS se monta sobre las identidades reales que ya usa integración? | Crea credenciales válidas en el broker. |
| **D4** | ¿El `listener 9001` en claro se abre como carril propio (WSS) o se acepta como riesgo declarado con fecha? | Aceptación de riesgo. |
| **D5** | ¿Se porta el bloque de backups (§3.11) **por delante** del TLS, dado que corrige un defecto medido de copias vacías dadas por buenas? | Prioriza carriles entre sí. |

---

## 6. Lo que NO debe portarse nunca, y por qué

1. **La ACL del hotfix** (`infrastructure/mosquitto/acl`). 26 reglas `pattern … %c`
   frente a las reglas literales por identidad autenticada de integración. Portarla
   **reabre** el modelo de autorización que F-02 denunció y anula una de las dos
   barreras. `SUPERSEDED`, sin excepción.
2. **`generate-users.sh` del hotfix.** Pierde la fuente única `identities.json`, el
   `LC_ALL=C` (sin él, `[a-z0-9]` deja de ser ASCII bajo otro locale y la validación
   *parece* validar), el `--all` y el rechazo de usuarios no declarados. `SUPERSEDED`;
   sólo se rescatan tres avisos operativos, que son comentarios.
3. **`mqtt.service.ts` y `mqttjsTransport.ts` como ficheros.** Ver R2.
4. **Cualquier material criptográfico o de credenciales**: `ca.key`, `server.key`,
   `server.crt`, `ca.crt`, `infrastructure/mosquitto/passwd`. Ninguno está hoy en el
   hotfix (verificado con `git ls-tree -r`), y el porte debe dejarlo así: `.gitignore`
   con `certs/` **antes** de generar nada.
5. **`git merge origin/hotfix/p02-tls-6da16d4`.** 76 commits de divergencia en el otro
   sentido, con reescrituras completas de frontend, simuladores y contratos. Un merge
   silencioso revierte los puntos 1-3 a la vez.
6. **`docs/coordination/STATUS.md`** y el resto de documentos existentes ajenos a este
   carril: propiedad de otros agentes en la Ola 1. La línea X-11/F-07 se actualiza
   cuando el porte esté **medido**, y por quien tenga la propiedad del fichero.
7. **La receta "TLS preparado pero comentado"** que integración aún conserva en
   `mosquitto.conf`. No es del hotfix, pero debe **desaparecer** al portar: dejar una
   receta alternativa comentada invita a reabrir un listener en claro por error.

---

## 7. Gate objetivo · `INTEGRATION_TLS_STATE = PRODUCTION_REPRESENTATIVE`

```
INTEGRATION_TLS_STATE = NONE                        (hoy, ae69357, medido)
INTEGRATION_TLS_STATE = PRODUCTION_REPRESENTATIVE   (objetivo)
```

El gate NO significa "el TLS está desplegado en VM109" — significa que **el árbol de
`mp0/integration` representa el broker de producción**, de modo que un despliegue desde
esa rama reproduce lo que hay en la VM, y las pruebas del repositorio pueden ponerse
rojas si alguien lo deshace. Se alcanza cuando **todas** estas condiciones se cumplen y
son **verificables desde el repositorio**:

| # | condición | cómo se comprueba (no "confía en mí") |
|---|---|---|
| G1 | `mosquitto.conf` declara `listener 8883` con `cafile`/`certfile`/`keyfile` y `tls_version tlsv1.2` | parseo de directivas efectivas (sin comentarios) |
| G2 | **Ningún** `listener` MQTT sin material TLS, en `mosquitto.conf` ni en `mosquitto.test.conf` fuera de su red aislada | `broker-sin-listener-en-claro.spec.ts` |
| G3 | **Ningún** puerto 1883 publicado en `compose.yml` ni `compose.dev.yml` | mismo test, **parseando YAML**, con rangos y sintaxis larga cubiertos |
| G4 | `configuration.ts` tiene `caFile` y construye la URL desde `MQTT_PROTOCOL/HOST/PORT` con defecto `mqtts`/`8883` | `tls-endpoint-default.spec.ts` |
| G5 | `mqtt.service.ts` falla cerrado: TLS sin CA → lanza; CA ilegible → lanza; claro en producción → aborta | `tls-fail-closed.spec.ts` + `pki-ca-fail-closed.spec.ts` |
| G6 | El simulador exige `--cafile` con `mqtts://` | `simulators/test/p02-tls-fail-closed.test.ts` |
| G7 | El healthcheck del broker va por TLS validando la CA | inspección de `compose.yml` + arranque real |
| G8 | `generate-certs.sh` presente y su guardarraíl `ca.key`-fuera cubre **todas** las salidas | ejecución en las tres rutas (idempotente, `FORCE=1`, `NEW_CA=1`) |
| G9 | `.gitignore` cubre `certs/` y `passwd` a cualquier profundidad | `git check-ignore -v` sobre rutas reales |
| G10 | `04-firewall.sh` abre 8883 y **no** 1883 | parseo de las reglas nftables |
| G11 | `test-acl.sh` corre **sobre TLS** y distingue AUTH_DENIED de ACL_DENIED | ejecución E2E contra broker de laboratorio |
| G12 | F-02 verificada **bajo TLS**, con evidencia fechada | `p02-test-acl-e2e.md` reproducido, no sólo copiado |
| G13 | `js-yaml` en `server/backend/package.json` y los 5 spec en verde | CI |
| G14 | Los tests son **calibrables**: cada uno se pone rojo ante su mutación declarada (reintroducir `listener 1883`, `- "1880-1890:1880-1890"`, borrar `MQTT_CA_FILE`) | ronda de mutación explícita, registrada |

### Qué falta HOY, exactamente

**Todo G1-G14.** Ninguna condición se cumple sobre `ae69357`. En concreto, y medido:

- G1-G3: el broker sólo tiene `listener 1883`; `compose.yml:303` publica `1883:1883`.
- G4-G5: `configuration.ts` no conoce `MQTT_CA_FILE`; no hay ni un fallo cerrado de TLS.
- G6: `MqttJsTransportOptions` no tiene `caFile`.
- G7: healthcheck contra `127.0.0.1:1883`.
- G8: `generate-certs.sh` **no existe** en el árbol.
- G9: falta `certs/` (`passwd` **sí** está resuelto, por otra vía).
- G10: `04-firewall.sh` abre `tcp dport 1883`.
- G11: `test-acl.sh` no sabe hablar TLS (no acepta `--cafile`).
- G12: la evidencia existe en el hotfix y **no** en integración.
- G13: `js-yaml` ausente; los 5 spec ausentes.
- G14: no hay ronda de mutación registrada sobre esta rama.

**Condiciones que no dependen del código** y bloquean el gate igualmente: **D1** (el
firmware con `mqtt://…:1883` cableado impide que "producción representativa" incluya a
los módulos físicos) y **D2** (custodia de `ca.key`). Mientras D1 siga abierta, lo más
que puede alcanzarse honestamente es un estado intermedio:

```
INTEGRATION_TLS_STATE = TLS_WIRED_NOT_EXCLUSIVE
  (8883 con TLS operativo y verificado; 1883 aún presente para el firmware;
   G1, G4-G9, G11-G14 verdes; G2, G3 y G10 pendientes de D1)
```

Nombrarlo así evita el error de nomenclatura que este proyecto ya ha pagado: separar
"cableado" de "exclusivo", y acotar el árbol al que se refiere la afirmación.

---

*Inventario producido por el carril INFRA-P02 sobre `lane/infra-p02`. Sin merge, sin
push a `mp0/integration`, sin tocar producción, VM109, el broker real ni certificados
reales.*
