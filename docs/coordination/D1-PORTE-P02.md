# D1 · Porte selectivo de P0-2 a `mp0/integration`

> **Esto NO es un merge.** `hotfix/p02-tls-6da16d4` diverge 16 commits en un
> sentido y 76 en el otro. Un `merge` habría revertido en silencio la ACL
> generada, `PublishResult`, `dispatchByFilter` y el canal de mantenimiento. El
> porte es delta a delta, y cada delta lleva su evidencia ejecutada.

## 1. Cabecera

| dato | valor |
|---|---|
| repo | `https://github.com/pjclavero/Diana.git` |
| rama de trabajo | `lane/d1-p02` |
| `BASE_SHA` (= `origin/mp0/integration`) | `ac2b6db5c335d9656f407b00b03b54ffb1000ece` |
| `HEAD_SHA` | `66b5eda31544083d4a6d15d0f3d5c626211ece06` |
| fuente del porte | `origin/hotfix/p02-tls-6da16d4` = `ad2d166dbef9e93a2f284e4c85ddecc17d1185a3` |
| inventario que se sigue | `docs/coordination/P02-RECONCILIACION.md` §4, orden de 18 pasos |
| fecha | 2026-09-05 |
| gate alcanzado | **`INTEGRATION_TLS_STATE = TLS_WIRED_NOT_EXCLUSIVE`** |

**El gate NO es `PRODUCTION_REPRESENTATIVE`, y no puede serlo hoy.** El listener
1883 en claro sigue vivo por decisión del operador: el firmware vigente lleva
`mqtt://%s:1883` cableado y retirarlo dejaría a los módulos físicos fuera de
servicio. Nombrar el estado con precisión —cableado, no exclusivo— es el punto
del ejercicio, no una formalidad.

Y una frase que **no** debe escribirse en ningún sitio tras este porte: «no
queda ningún camino en claro». Quedan **dos**: el 1883 de transición y el
`listener 9001` de WebSockets, que sigue sin cifrar dentro de la red interna
(deuda D4). Lo cierto y defendible es que **el camino recomendado, y el que usa
el backend, van por TLS**.

## 2. Commits de este carril

| commit | pasos del §4 | contenido |
|---|---|---|
| `d957c2f` | 1, 2 | worker sin credenciales MQTT; perfil `test` a la red `testnet` |
| `29ca19f` | 6, 7 | `.gitignore` cubre `certs/`; `generate-certs.sh` |
| `349c2b4` | 8 | `listener 8883` con TLS; 1883 marcado como transición |
| `c8f2cd3` | 9 | compose publica 8883, monta el material, sondea por TLS |
| `c2e37cf` | 10, 11, 12, 17a | `caFile`, `tlsOptions()`, `bootstrap().catch()`, `.env`, 3 spec |
| `4307926` | 13 | simulador: `caFile`, `--cafile`, y un test que no valía |
| `66b5eda` | 14, 15 | `test-acl.sh` con transporte TLS; dos falsos verdes corregidos |

Y en este mismo árbol, sin commit propio todavía al escribir esta línea:
`04-firewall.sh` (abre 8883, conserva 1883 marcado) y las tres evidencias TAKE
con su aviso de procedencia.

## 3. Deltas portados

| # | delta | clasificación | cómo se portó | evidencia |
|---|---|---|---|---|
| 1 | worker sin `MQTT_*` | TAKE | edición de `compose.yml` | `mqtt` ausente de `server/worker/package.json`; cero referencias MQTT en `server/worker/src`; compose parseado con PyYAML |
| 2 | perfil `test` → `testnet` | TAKE | edición de `compose.yml` | PyYAML: redes `['edge','internal','testnet']`, los 3 servicios del perfil en `['testnet']` |
| 3 | `.gitignore` + `certs/` | TAKE (adaptado) | ver §5.1 | `check-ignore -v`: 3 rutas ignoradas por la línea 68; `firmware/.../broker_ca.pem` **no** ignorado (rc=1) |
| 4 | `generate-certs.sh` | TAKE íntegro | fichero nuevo, sin colisión | 6 rutas ejercitadas en sandbox, §4.1 |
| 5 | `listener 8883` + TLS | PORT de bloque | edición a mano de `mosquitto.conf` | parseo de directivas efectivas + broker real, §4.2 |
| 6 | retirada de la receta TLS comentada | PORT | eliminada | ya no aparece en el fichero |
| 7 | compose: 8883, montajes, healthcheck TLS | PORT | edición | PyYAML + el healthcheck ejecutado contra el broker real |
| 8 | `configuration.ts`: `caFile` + URL por partes | PORT de delta | dos bloques, nunca el fichero | `publishAckTimeoutMs` intacto; 17 tests |
| 9 | `mqtt.service.ts`: `tlsOptions()` | PORT de delta | método + spread | símbolos de integración intactos, §5.2 |
| 10 | `main.ts`: `bootstrap().catch()` | TAKE | reemplazo de una línea | `tsc` limpio |
| 11 | `.env.example` (raíz y backend) | PORT (adaptado) | ver §5.3 | — |
| 12 | simulador: `caFile`, `--cafile` | PORT de delta | método + opción; `live.ts` escrito aquí | 106 tests del simulador verdes |
| 13 | `test-acl.sh` sobre TLS | CONFLICT → reconciliado | base de integración + transporte del hotfix | 13/13 contra el 8883, §4.3 |
| 14 | `04-firewall.sh` | TAKE (adaptado) | 8883 se abre, 1883 se conserva marcado | parseo de reglas |
| 15 | 3 spec de fallo cerrado del backend | TAKE | ficheros nuevos | 17 tests, 6 mutaciones detectadas |
| 16 | `p02-tls-fail-closed.test.ts` (simulador) | TAKE + reparado | ver §5.4 | 4 tests, 3 mutaciones detectadas |
| 17 | 3 evidencias `p02-*.md` | TAKE + aviso | banner de procedencia añadido | sin material sensible (escaneado) |

## 4. Evidencia ejecutada

Todo lo de abajo se ejecutó de verdad en esta máquina, con contenedores
efímeros, certificados desechables creados en `/tmp` y contraseñas de usar y
tirar. **Nada tocó producción, VM109, el broker real ni material criptográfico
real.**

### 4.1 `generate-certs.sh` — seis rutas (G8)

| ruta | rc | efecto observado |
|---|---|---|
| A · sin CA y sin `NEW_CA` | 1 | no crea raíz de confianza por accidente |
| B · `NEW_CA=1` | 0 | CA creada, `ca.key` 0600 en `CA_DIR` |
| C · segunda pasada | 0 | idempotente: «nada que hacer» |
| D · `FORCE=1` | 0 | sha256 de la CA **estable**, certificado de servidor **rotado** |
| E · `ca.key` dentro de `CERT_DIR` | 1 | guardarraíl `comprobar_ca_key_fuera()` |
| F · `NEW_CA=1` con `ca.key` presente | 1 | no la sobrescribe (sha256 idéntico antes y después) |

SAN medido: `DNS:mosquitto, DNS:localhost, IP:127.0.0.1, IP:192.168.1.209`.
Permisos medidos: `server.key` 600, `ca.crt`/`server.crt` 644, `ca.key` 600
**fuera** del árbol de despliegue; `CERT_DIR` contiene exactamente
`ca.crt server.crt server.key`.

**Calibración honesta de F.** A la primera, F dio rc=0. No era un fallo del
guardarraíl: con un `server.crt` válido presente el script sale por la rama
idempotente y ni llega al bloque de CA. Hubo que retirar `server.crt` para que
la ruta se alcanzara. Sin ese detalle, un rc=0 se habría anotado como defecto
inexistente.

### 4.2 Broker Mosquitto real con la configuración portada

Directivas efectivas parseadas (sin comentarios), no contadas:

```
listener 8883   protocol=mqtt        TLS=SI  use_username_as_clientid=true  tls_version=tlsv1.2
listener 1883   protocol=mqtt        TLS=NO  use_username_as_clientid=true
listener 9001   protocol=websockets  TLS=NO  use_username_as_clientid=true
ninguna directiva de autenticación antes del primer listener
```

Contenedor `eclipse-mosquitto` arrancado con esa configuración:

| prueba | rc | lectura |
|---|---|---|
| publish por TLS en 8883 validando la CA | 0 | TLS operativo (es el comando exacto del healthcheck de compose) |
| el mismo publish **sin** `--cafile` | 14 | «Protocol error»: el 8883 exige TLS de verdad |
| publish en 1883 en claro | 0 | el listener de transición **sigue abierto** |
| credencial incorrecta en 8883 | 5 | «not authorised» |

**F-02 bajo TLS, medida por efecto y no por el `rc`.** Con QoS 0 una denegación
de ACL no llega al cliente: el broker descarta en silencio y `mosquitto_pub`
devuelve 0. Ese 0 no es evidencia de nada. Con MQTT v5 y QoS 1 el PUBACK lleva
reason code:

```
module-01 → targets/v1/module/module-01/telemetry   PUBACK RC:16   aceptado
module-01 → targets/v1/module/module-02/telemetry   PUBACK RC:135  0x87 Not authorized
module-01 → targets/v1/module/module-01/command     PUBACK RC:135  0x87 Not authorized
```

En los tres casos el `rc` de `mosquitto_pub` fue **0**. Queda escrito.

Y conectando con `-i module-02 -u module-01`, el log del broker registra al
cliente como `module-01`: la barrera 1 sigue reescribiendo el `client_id` bajo
TLS.

**Observación que conviene no repetir mal.** Con `tls_version tlsv1.2` el broker
negoció **TLSv1.3**. La build de OpenSSL de la imagen trata esa directiva como
**mínimo**, no como versión exacta. 1.3 ≥ 1.2, así que no es un problema —pero
la directiva no significa lo que su nombre sugiere, y no debe citarse como
«fijamos TLS 1.2».

### 4.3 `test-acl.sh` de extremo a extremo sobre el 8883

Con el coordinador activado y la ACL del árbol restaurada por copia al terminar
(sha256 idéntico, verificado):

| escenario | resultado |
|---|---|
| A · 8883 **con** TLS | **13 correctos, 0 fallos** |
| B · 8883 **sin** `MQTT_CAFILE` | aborta en el control positivo, rc=7 |
| C · TLS con contraseñas incorrectas | aborta en el control positivo, rc=5 |

B y C son la propiedad que importa: un fallo de **transporte** o de
**autenticación** aborta en vez de anunciarse como una denegación de
**autorización**.

### 4.4 Calibración: cada prueba puesta roja a propósito (G14)

Backend, tres spec, 17 tests:

| mutación | resultado |
|---|---|
| M0 sin mutar | 17/17 verdes |
| M1 protocolo por defecto vuelve a `mqtt` | 2 rojos |
| M2 puerto por defecto vuelve a 1883 | 1 rojo |
| M3 se retira el aborto en producción | 1 rojo |
| M4 la CA deja de ser obligatoria con `mqtts://` | 1 rojo |
| M5 `rejectUnauthorized` pasa a `false` | 1 rojo |
| M6 se retira el spread `...this.tlsOptions()` | 4 rojos |
| M7 árbol restaurado | 17/17 verdes |

Simulador, antes y después del test añadido en §5.4:

| mutación | antes | después |
|---|---|---|
| S1 desaparece el `throw` de `--cafile` | rojo | rojo |
| S2 `rejectUnauthorized: false` | **VERDE** | rojo |
| S3 se retira el spread | rojo | rojo |

Prueba 12 de `test-acl.sh` (F-02), en tres pasos:

1. retirar **sólo** `use_username_as_clientid`: sigue **verde**. Y es correcto:
   la barrera 2 —ACL con `module_id` literal, sin `%c`— cubre el hueco ella
   sola, tal y como afirma la cabecera de la ACL. La prueba mide la
   **conjunción** de las dos barreras y no distingue cuál actúa.
2. retirar **las dos** (ACL sustituida por `pattern write .../%c/hit`, que es
   exactamente el modelo de la ACL del hotfix): la prueba se pone **roja** e
   imprime el payload suplantado. Es capaz de ponerse roja.
3. el arnés **anterior** al porte, contra ese mismo broker con F-02 reabierto,
   **ni siquiera llega** a la prueba 12: aborta en la línea 133.

Las mutaciones se aplicaron y revirtieron con copia previa (`cp`). En ningún
momento se usó `clean` ni `shred`.

### 4.5 Batería exigida

| comprobación | antes | después |
|---|---|---|
| `make -C firmware test` | TOTAL 945 / MQTT-TLS 26, 0 fallos | **igual** |
| `contracts/validate.py` | 88 comprobaciones, 0 fallos | **igual** |
| `generate-identities.mjs --check` | rc=0 | **rc=0** |
| `%c` en `acl` fuera de comentarios | 0 | **0** |
| `tsc --noEmit` (backend) | 1 error | **1 error, el mismo** |
| `jest test/mqtt` | 6 suites | **9 suites, 67 tests, verdes** |
| `vitest` (simulador) | — | **18 ficheros, 107 tests, verdes** |
| `tsc --noEmit` (simulador) | rc=0 | **rc=0** |

Sobre el `tsc`: el encargo hablaba de **7** errores preexistentes. Medidos sobre
este árbol, con el cliente Prisma del backend generado, son **1**
(`../worker/src/tasks.ts` no encuentra `@prisma/client`, porque el cliente del
*worker* no está generado). Se reporta lo medido, no lo esperado.

## 5. Desviaciones deliberadas respecto del hotfix

### 5.1 `.gitignore`: `infrastructure/mosquitto/certs/`, no `certs/`

El hotfix ignora `certs/` sin anclar. Este árbol tiene ficheros **versionados**
bajo `firmware/esp32/main/certs/`; un patrón sin anclar dejaría cualquier
fichero nuevo de ese directorio fuera de control en silencio. Se ancla a la ruta
del broker y se verifica con `check-ignore` en ambos sentidos.

### 5.2 Tres ficheros que NO se tomaron enteros

Los tres son **anteriores** en el hotfix, y tomarlos habría borrado trabajo
posterior sin un solo conflicto que avisara:

| fichero | qué se habría perdido | comprobación tras el porte |
|---|---|---|
| `mqtt.service.ts` | `PublishResult`, `reasonCode` del PUBACK, `recordPublishDenied`, canal de mantenimiento | los cinco símbolos presentes |
| `mqttjsTransport.ts` | `dispatchByFilter`, `pendingFilters` (X-18-INGESTA) | 6 apariciones; `mqttjs-transport-routing.test.ts` verde |
| `acl` | la barrera 2 de F-02: **26** `%c` frente a 0 | 0 `%c` fuera de comentarios |

### 5.3 `MQTT_PORT` se conserva

El hotfix la **elimina** de `.env.example` porque allí el 1883 ya no existe.
Aquí sí existe, así que la variable se queda y se le añade encima
`MQTT_TLS_PORT` más el comentario con la condición de retirada. Eliminarla
habría dejado el fichero de ejemplo mintiendo sobre el árbol.

### 5.4 `live.ts` y el hilo de la CA en el simulador

`simulators/src/live.ts` **no existe** en el hotfix: es trabajo posterior de
integración. El campo `caFile` y `DIANA_MQTT_CA_FILE` se han escrito en este
carril, con el mismo criterio que `run`, para que el subcomando `live` no
quedase como la única vía sin TLS.

## 6. Lo que quedó FUERA, y por qué

| delta | motivo |
|---|---|
| **Paso 16 · retirada del 1883** (conf, compose, compose.dev, firewall) | Decisión **D1** del operador. Deja los módulos ESP32 físicos sin servicio. |
| **`broker-sin-listener-en-claro.spec.ts`** | Se pondría **roja por diseño** mientras exista el 1883, y un test rojo permanente se acaba desactivando. Entra con el paso 16. |
| **`js-yaml` como devDependency** | Sólo lo necesita ese spec. Sin él, no hace falta todavía. |
| **Pasos 3, 4, 5 · `backup.sh`, `restore.sh`, healthcheck de backup, `verify-restore.sh`** | `infrastructure/backups/**` es propiedad del carril **D5**, que lo está reescribiendo ahora. Su versión es la que se portará. Fuera de este carril por completo. |
| **La ACL del hotfix** | `SUPERSEDED`. 26 `%c` frente a reglas literales por identidad autenticada. Portarla **reabre** F-02. |
| **`generate-users.sh` del hotfix** | `SUPERSEDED`. Pierde la fuente única, el `LC_ALL=C` y el rechazo de usuarios no declarados. |
| **Identidades `module-acltest-a/b` + `module-aclobserver`** | Decisión **D3**. Exigen tocar `identities.json` y crear credenciales válidas en el broker. |
| **`docs/coordination/STATUS.md`, `findings.md` (F-07/X-11), `operacion.md`, `procedimiento.md`** | Propiedad ajena en la Ola 1, y no procede cerrar F-07 mientras el 1883 siga abierto. |
| **`mqtt-acl.md`** | `SUPERSEDED`: integración documenta la ACL generada. |

## 7. Hallazgos de este carril (no venían en el inventario)

1. **`test-acl.sh` de `mp0/integration` no se podía ejecutar.** Una segunda
   declaración de `HOST`/`PORT` releía `$3/$4/$5` como contraseñas, con un
   `usage` incompatible con el de arriba: con la invocación documentada abortaba
   en `line 133: 5: falta la contraseña de module-02` antes de la primera
   comprobación. Corregido.
2. **Quince tópicos entre comillas simples con `$MOD_A`/`$MOD_B` dentro.** La
   variable no expandía, así que el script trabajaba sobre tópicos literales
   `targets/v1/module/$MOD_A/...`. Las pruebas **negativas** pasaban por el
   motivo equivocado y las **positivas** fallaban por el mismo. La prueba 12
   —la de F-02— era un falso verde. Corregido y calibrado.
3. **`p02-tls-fail-closed.test.ts` afirmaba más de lo que probaba.** Su cabecera
   declaraba que `rejectUnauthorized: false` debía ponerlo rojo; se aplicó esa
   mutación y siguió **verde**. Se añadió el test que sí lo ve.
4. **`tls-fail-closed.spec.ts` construía `MqttService` con 3 argumentos.** Jest
   pasaba (los tipos no existen en ejecución) pero `tsc` daba TS2554: un test
   verde que no compila. Corregido con el `prisma` que este árbol sí exige.
5. **`set-coordinator.sh` escribe la ACL en modo 0600.** El broker corre como
   uid 1883 y **no puede leerla**: `Error: Unable to open acl_file` y el
   contenedor sale con código 13. Reproducido. Es la misma clase de fallo que el
   inventario anota para `passwd`. **No se ha tocado** porque no es TLS y el
   arreglo (un `chmod 644` tras reescribir) merece su propio delta revisable.

## 8. Lo que exige decisión del operador

| id | decisión | consecuencia de no tomarla |
|---|---|---|
| **D1** | ¿Se retira el 1883 antes de que el firmware hable TLS? | El gate se queda en `TLS_WIRED_NOT_EXCLUSIVE` indefinidamente. G2, G3 y G10 no pueden ponerse en verde. |
| **D2** | Ubicación definitiva de `ca.key` y política de rotación. El defecto del script es `CA_DIR=/root/diana-pki`; el destino declarado es almacenamiento **offline** separado de la VM. | La raíz de confianza vive en la misma máquina que protege. |
| **D3** | Identidades de prueba de `test-acl.sh`. | El arnés seguirá usando identidades reales, que es lo que hace hoy y funciona. |
| **D4** | El `listener 9001` en claro: ¿carril WSS propio o riesgo aceptado con fecha? | Queda un camino sin cifrar en la red interna, hoy sin fecha. |
| **D6** | *(nuevo)* El `chmod` de `set-coordinator.sh` (hallazgo §7.5): ¿se corrige en este carril o en el de la ACL? | Activar un coordinador deja el broker sin arrancar. |

**Prerrequisito de despliegue, no decisión.** Antes del primer `up` con este
árbol hay que ejecutar `infrastructure/mosquitto/generate-certs.sh`. Sin
`ca.crt`, el backend falla cerrado y entra en bucle de reinicio —que es el
comportamiento **correcto**, y por eso el orden de los pasos era vinculante.

---

*Carril D1, sobre `lane/d1-p02`. Sin merge de `hotfix/p02-tls-6da16d4`, sin push
a `mp0/integration`, sin tocar producción, VM109, el broker real, certificados
reales ni hardware.*
