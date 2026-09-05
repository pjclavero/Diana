# STATE — fuente canónica única del Proyecto Diana

> **Este documento manda.** Si otro documento del repositorio contradice algo de
> aquí, el otro documento está caducado, no éste. Existe porque el proyecto ha
> tenido documentos contradictorios y eso ya ha causado errores reales.
>
> Nada de lo escrito aquí se afirma sin una comprobación contra el repositorio o
> contra una ejecución. Lo que no se ha podido comprobar se marca
> `NO VERIFICADO` y se dice por qué.

```
DATE             = 2026-09-05
CANONICAL_BRANCH = mp0/integration
CANONICAL_HEAD   = ae6935746cdaf5c57bf70b9a9264757c34efe4f1
MILESTONE        = MP0-F.0 · PROVISIONING CONTRACT GATE (en curso, pasos 1-5 integrados)
```

`CANONICAL_BRANCH` y `CANONICAL_HEAD` se leen de `git rev-parse
origin/mp0/integration`, **no** de la documentación: `CANONICAL_BRANCHES.md`
llegó a listar `9b5e161` y `3711632`, ambos ya superados.

---

## 0. Regla de nomenclatura — obligatoria en todo informe

**Nunca `UNIQUE` ni `COMPLETE` sin acotar el ámbito.** `CURRENT_TREE = UNIQUE`
significa *«en el árbol que realmente compilamos no existe un segundo camino
conocido»*; no significa que sea formalmente imposible añadir uno. Esa palabra
suelta costó cinco rondas de supervisión.

Y estas cinco propiedades **no son la misma cosa**; se declaran por separado
siempre:

```
IMPLEMENTADO               el código existe en el árbol
PROBADO COMO API           hay pruebas que lo ejercen (suite de host)
CABLEADO EN FIRMWARE       está en CMake, compila cruzado y sobrevive al enlazado
ALCANZABLE POR TRANSPORTE  algo real puede hacérselo llegar (MQTT, HTTP…)
VALIDADO FÍSICAMENTE       medido sobre silicio y hardware real
```

D1b es el ejemplo vivo: es las tres primeras, **no** la cuarta ni la quinta.

---

## 1. Estado cerrado — NO REABRIR

Cerrado con seis rondas de supervisión independiente sobre commits congelados.
Fuente: [`docs/coordination/CIERRE-D1B-MP0.md`](coordination/CIERRE-D1B-MP0.md)
(commit de cierre `3527a91`, declarado en `54b4034`).

```
D1B_SOFTWARE_CORE = CONFORME
D1B               = CLOSED
MP0               = CLOSED
```

Deliberadamente **no** se declara `DEVICE_MANAGEMENT = COMPLETE` ni
`D1B_END_TO_END = PASS`.

---

## 2. OPEN_BLOCKERS

| id | estado | dónde se cierra |
|---|---|---|
| `CONTRACT_GAP-PROVISION-COMMAND-TOPIC` | contrato cerrado, **firmware no** | MP0-F.0 |
| `CONTRACT_GAP-PROVISION-STATE-TOPIC` | contrato cerrado, **firmware no** | MP0-F.0 |
| `MQTT_USERNAME_DOUBLE_PREFIX` | **ABIERTO · corrección EN CURSO en firmware, otro carril** | Ola 1 |
| `DEVICE_MANAGEMENT_COMMAND_TRANSPORT` | `NOT_REACHABLE` | MP0-F.0 / MP0-F.2 |
| `P0-2 TLS 8883` | sin fusionar en la línea canónica | antes de `PROVISIONING_BASE` |

Matiz importante sobre los dos `CONTRACT_GAP`: eran los `MP0_ACCEPTED_BLOCKER`
del cierre de MP0 y **han avanzado desde entonces**. En `ae69357`:

```
ADR-0008                                              ACEPTADO (2026-09-04)
contracts/mqtt/module-provision-command.schema.json   EXISTE
contracts/mqtt/module-provision-state.schema.json     EXISTE
server/backend/src/contracts/topics.ts                reconoce ambos TopicKind
firmware: enum DIANA_TOPIC_*                          9 valores, SIN provisioning
firmware/…/mqtt_client.c                              0 apariciones de "provision"
```

Es decir: **el contrato ya está abierto y versionado (v1.2); lo que falta es el
lado firmware.** Cualquier documento que siga diciendo «no hay esquema en
`contracts/mqtt/`» está caducado.

---

## 3. DEFERRED

```
MULTIPLANE_SEQ_GUARDS                 = NOT_WIRED · DEFERRED_TO_A3_B5
CONTRACT_GAP-DEVICE-MANAGEMENT-SCHEMA = ver docs/coordination/GAPS-MP0.md
```

---

## 4. PHYSICAL_PENDING

```
D1B_PHYSICAL_CRYPTO_COST = PENDING_PHYSICAL_VALIDATION
```

El coste real de una verificación P-256 sobre el ESP32-S3 no se ha medido: la
suite es de host y el build cruzado demuestra que el código entra en el binario,
no lo que tarda en ejecutarse.

Otros pendientes físicos: `docs/hardware/VALIDACION-FISICA-PENDIENTE.md` y
`docs/firmware/validacion-fisica-pendiente.md`. **NO VERIFICADO** desde este
carril: no se toca hardware físico.

---

## 5. PRODUCTION_DIVERGENCES

| divergencia | evidencia en el repo | estado |
|---|---|---|
| TLS/8883 de P0-2 | `infrastructure/mosquitto/mosquitto.conf` declara `listener 1883`; el `8883` está comentado (líneas 69-77) | el endurecimiento vive en `hotfix/p02-tls-6da16d4@ad2d166`, **sin fusionar** |
| ACL de MP0-A vs. la vigente | `docs/coordination/GAPS-MP0.md` | la ACL de MP0-A es más estricta (9 módulos enumerados) y **nunca ejercida contra un broker real** |
| Migración PostgreSQL | ídem | **nunca ejecutada**; Prisma no modela el `CHECK`, que vive sólo en el fichero de migración |

**NO VERIFICADO:** el estado *vivo* del despliegue de producción. Este carril es
sólo documental y tiene prohibido tocar producción; lo anterior describe lo que
dice el árbol, no lo que corre hoy en la máquina.

---

## 6. Cuadro de estado de D1b, por las cinco propiedades

```
D1B_CORE_IMPLEMENTED                        = YES
D1B_SOURCES_IN_CMAKE                        = YES
D1B_XTENSA_COMPILE                          = PASS   (6/6 objetos, espressif/idf:v5.5)
D1B_SYMBOLS_IN_ELF                          = YES    (23 símbolos tras --gc-sections)
D1B_RUNTIME_DISPATCH_WIRED                  = YES
DEVICE_MANAGEMENT_COMMAND_PATH_CURRENT_TREE = UNIQUE (residual: namespace dinámico)
DEVICE_MANAGEMENT_COMMAND_TRANSPORT         = NOT_REACHABLE
DEVICE_MANAGEMENT_STATE_PATH                = NOT_IMPLEMENTED (en firmware)
D1B_PHYSICAL_CRYPTO_COST                    = PENDING_PHYSICAL_VALIDATION
```

Traducido a la regla del §0: D1b está **implementado**, **probado como API** y
**cableado en firmware**; **no es alcanzable por transporte** y **no está
validado físicamente**.

---

## 7. Cifras reproducibles

```
make -C firmware test @ ae69357
  →  TOTAL: 853 comprobaciones, 853 correctas, 0 fallidas
     CONTRATO: conforme
     W5500 RSTn: conducido, pulsado con espera y sin reasercion del PHY  ok
     D1b camino unico: CURRENT_TREE = UNIQUE · guarda de regresion PASS
```

Ejecutado en este servidor el 2026-09-05.

**Cómo se lee esta cifra, y cómo no.** Se lee de la línea `TOTAL:`. Las líneas
`ok` de la salida incluyen unas 48 que **no pasan por el arnés `CHECK`** (las
validaciones de esquema de los 18 mensajes y de los 14 enumerados, entre otras),
así que `grep -c ok` da otro número y **ése no es el bueno**.

La cifra **748** que aparece en `CANONICAL_BRANCHES.md` y en
`docs/coordination/EVIDENCIA-MP0-RECOMPOSICION.md` fue una medida **real y
correcta en su momento**, sobre un árbol anterior. Caducó al crecer la suite; no
se borra, se fecha.

`CONTRACT_GAP-TEST-COUNT`: el «43/43» reportado desde el portátil sigue **sin
reproducirse**. No se usa como cifra de estado.

---

## 8. Ramas — SHAs verificados con `git branch -r -v` el 2026-09-05

| ref | commit | estatus |
|---|---|---|
| `mp0/integration` | `ae69357` | **LÍNEA DE TRABAJO VIGENTE** |
| `main` | `3414f1b` | intacto; destino de la convergencia futura |
| `develop` | `21c09db` | tronco |
| `codex/hardware-prototipo-v1` | `3a1d180` | firmware/hardware canónicos de banco |
| `codex/proto-do-w5500` | `b883da0` | `PHYSICAL_FIRMWARE_BASE_PREVIOUS`, evidencia histórica |
| `feat/wp04-firmware` | `73f5f93` | **NO FUSIONAR** · base obsoleta (~5 semanas, 603 ficheros) |
| `fix/w5500-reset-hardware` | `f52d013` | **código YA PORTADO** (ver §9.1); su parte documental, no |
| `hotfix/p02-tls-6da16d4` | `ad2d166` | TLS de P0-2, **sin fusionar** |
| `archive/mp0-integration-27652ed` | `27652ed` | preservación |

```
FIRMWARE_CANONICAL_COMMIT = 3a1d1802b68d3ba0c3ac7d394550b8ce99ad3682
INTEGRATION_BASE          = 3c51847f3f29ba9371e3956668289a32110b7ae2
INTEGRATION_HEAD          = ae6935746cdaf5c57bf70b9a9264757c34efe4f1
```

---

## 9. Contradicciones conocidas y su resolución

### 9.1 RSTn del W5500 — RESUELTA: se conduce, en GPIO8

Evidencia:

```
firmware/esp32/boards/esp32s3_proto_do_w5500.h:41   #define DIANA_PIN_ETH_RST 8
firmware/esp32/components/diana_platform_esp/src/net_w5500.c:119-135
    gpio_config_t con DIANA_PIN_ETH_RST en GPIO_MODE_OUTPUT,
    nivel 1 → 0 → espera → 1, y phy_cfg.reset_gpio_num = -1 (PARTE del arreglo)
firmware/esp32/tools/check_w5500_reset.py  → verde dentro de `make -C firmware test`
```

El perfil de placa activo es `esp32s3_proto_do_w5500.h` (lo incluyen
`main/app_main.c:17`, `main/app_tasks.c:13` y
`components/diana_platform_esp/src/platform_internal.h:18`), no `protoA` —cuyo
`DIANA_PIN_ETH_RST` es 21 y no aplica.

Documentos que decían lo contrario y quedan corregidos:
`docs/hardware/current/pinout.md` y `docs/hardware/current/conexionado.md`
(decían «W5500 RST queda NC» y «Firmware actual usa reset software»).
`docs/firmware/MAPA-FIRMWARE.md` decía que el arreglo estaba «pendiente de
portar»: ya no lo está.

**NO VERIFICADO por este carril:** que el cable físico de RSTn esté soldado hoy
en el montaje. La evidencia disponible es de banco (10/10 arranques consecutivos
el 2026-08-28) y es de terceros; aquí no se toca hardware. El comentario del
propio `esp32s3_proto_do_w5500.h:40` («el montaje actual deja RST/INT NC») es un
residuo del estado anterior y contradice al código que hay tres líneas más
abajo — es firmware, y DOCS no lo toca.

### 9.2 748 vs 853 — RESUELTA: 853

Ver §7. La 748 se marca como caducada allí donde aparece.

### 9.3 «El firmware nunca se ha compilado con ESP-IDF» — FALSA hoy

`docs/firmware/evidencia-build-esp-idf.md` registra `BUILD = PASS` con
`espressif/idf:v5.5`, con tamaños y SHA-256 de los cuatro artefactos, y
`D1B_SYMBOLS_IN_ELF = YES` con **23 símbolos** medidos con
`xtensa-esp32s3-elf-nm` sobre el ELF real.

Documentos que aún lo afirman y quedan marcados como históricos o corregidos:
`docs/INFORME-ESTADO-2026-07-21.md`, `docs/INFORME-TAREAS-vs-ENCARGO.md`,
`docs/coordination/INFORME-mejoras-panel-2026-07-22.md`,
`docs/coordination/STATUS.md`, `docs/phases/ROADMAP.md`,
`docs/product/alcance-panel-roles-firmware.md`,
`docs/security/evidence/firmware-ota.md`, `docs/security/findings.md` y
`CHANGELOG.md`.

**Ojo al alcance:** que compile y enlace **no** es que se haya flasheado ni
corrido en silicio desde ese entorno. El propio documento de evidencia lo dice.

### 9.4 Rama canónica con SHAs viejos — RESUELTA

`CANONICAL_BRANCHES.md` apuntaba a `9b5e161` / `3711632`. Real: `ae69357`.

### 9.5 Username MQTT `module-module-01` — ABIERTA, corrección EN CURSO

```
contracts/mqtt/README.md:42                  el username del módulo ES su module_id (F-02)
infrastructure/mosquitto/identities.json:37  { "username": "module-01", "module_id": "module-01" }
firmware/esp32/main/app_main.c:263           snprintf(user, …, "module-%.*s", …, a->id.module_id)
```

Con `module_id = "module-01"` el firmware envía `module-module-01`, que **no
existe** en el fichero de usuarios del broker
(`infrastructure/mosquitto/users.generated.txt`). El defecto está incluso
fosilizado en una prueba: `firmware/esp32/test_host/tests/test_reconnect.c:58`
pasa literalmente `"module-module-05"`.

**Otro carril lo está corrigiendo en el firmware ahora mismo.** Este documento
sólo registra el estado; DOCS no toca `firmware/`.

### 9.6 D1b y el transporte — NO ES CONTRADICCIÓN, es la distinción del §0

«Implementado y en el ELF» y «no alcanzable por MQTT» son ciertos a la vez.
`mqtt_client.c` no menciona `provision` y el enum de tópicos del firmware
(`components/diana_core/include/diana/messages.h:30-39`) tiene 9 valores, ninguno
de provisioning. Ambas cosas verificadas en `ae69357`.

### 9.7 Arquitectura analógica — NO ES CONTRADICCIÓN VIVA

El hardware real es DO-only (ADR-0007, aceptado 2026-08-21). Los documentos
analógicos (`docs/hardware/notas-de-diseno.md`, `docs/hardware/decisiones.md`,
`docs/firmware/pinout-preliminar.md`, `docs/firmware/pinout-definitivo.md`,
`docs/hardware/conexionado-prototipo.md`) **ya llevaban cabecera de aviso** antes
de esta revisión. Se conservan como diseño de la PCB futura y como evidencia.

---

## 10. Documentos marcados `HISTORICAL`

No se borran: son evidencia. Están fechados y no compiten como fuente actual.

- `docs/INFORME-ESTADO-2026-07-21.md`
- `docs/INFORME-TAREAS-vs-ENCARGO.md`
- `docs/coordination/INFORME-mejoras-panel-2026-07-22.md`
- `docs/coordination/AUDITORIA-PANTALLAS-2026-08-05.md`
- `docs/coordination/EVIDENCIA-MP0-RECOMPOSICION.md` (contiene la cifra 748)

---

## 11. Cómo mantener este fichero

1. `CANONICAL_HEAD` se refresca con `git rev-parse origin/mp0/integration`.
2. Las cifras de test se refrescan ejecutando `make -C firmware test` y copiando
   la línea `TOTAL:`, nunca contando `ok`.
3. Un documento que resulte equivocado **se marca caducado diciendo qué decía y
   qué se midió**. No se reescribe el pasado para que parezca que siempre estuvo
   bien.
