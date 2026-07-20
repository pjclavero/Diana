# INFORME DEL SUPERVISOR TÉCNICO

Este documento lo escribe **únicamente** el agente supervisor. El organizador no lo edita.

Dictámenes permitidos: `CONFORME` · `CONFORME CON OBSERVACIONES` · `NO CONFORME`.

Regla: no se emite `CONFORME` sin evidencias de pruebas ejecutadas.

---

## PUERTA DE LA OLA 0 — Contratos y fundación

**Fecha:** 2026-07-20 · **Rama:** `develop` · **HEAD revisado:** `8addff4`
**Fuente normativa:** `dosier_tecnico_matriz_dianas_modulares.md` (v0.1, 2965 líneas)
**Producido por:** el organizador (WP-00). El supervisor no ha escrito ninguna línea del
material revisado; este informe es el único fichero de su autoría.

### DICTAMEN: `NO CONFORME`

Justificación resumida: el trabajo es de calidad alta y el requisito más delicado del
proyecto —que la hora de llegada al servidor no sustituya a la del impacto— está
**correctamente blindado por contrato y verificado por prueba ejecutada**. Sin embargo hay
dos defectos que impiden abrir la Ola 1, porque siete equipos están a punto de construir
sobre estos ficheros:

1. **H-01** — La ACL de MQTT declarada en el contrato es incompatible con la propia tabla
   de tópicos del contrato. Implementada literalmente, el coordinador no puede publicar
   ni el estado ni los eventos de partida, ni consolidar impactos. La cadena T2 es
   inejecutable tal como está especificada, y esa misma ACL es el **único** mecanismo que
   impide al backend publicar tiempos propios.
2. **H-02** — Los `$ref` de los doce esquemas son irresolubles bajo resolución estándar de
   URI base. El validador incluido lo enmascara con un registro de doble base; cualquier
   otra herramienta (ajv en NestJS, generadores de tipos, CI, el simulador) falla.
   Verificado ejecutando la resolución estricta: `Unresolvable`.

Ambos son de corrección barata **ahora** y cara después. Con ellos resueltos y los
hallazgos MAYORES atendidos, la puerta puede reabrirse de inmediato.

---

## 1. Alcance revisado y método

| Artefacto | Extensión | Método |
|---|---|---|
| `dosier_tecnico_matriz_dianas_modulares.md` | 2965 líneas | Lectura íntegra por partes (secciones 1-38 + dictamen) |
| `contracts/mqtt/README.md` | 127 líneas | Lectura íntegra y contraste §§12-15, 17, 23 del dosier |
| `contracts/mqtt/*.schema.json` | 12 esquemas | Lectura íntegra de los 12 |
| `contracts/schemas/common.schema.json` | 1 | Lectura íntegra |
| `contracts/examples/**` | 16 válidos + 12 inválidos | Validador ejecutado + inspección manual de 4 |
| `contracts/validate.py` | 130 líneas | Lectura del código y ejecución |
| `docs/adr/0001`…`0006` | 6 ADR | Lectura íntegra |
| `docs/coordination/*` | 8 ficheros | Lectura íntegra |
| Raíz (`README`, `CONTRIBUTING`, `SECURITY`, `CHANGELOG`, `.gitignore`, `VERSION`) | — | Lectura íntegra |
| Secretos | todo el árbol + historial git | `grep -rInE` de patrones + búsqueda de ficheros + `git log --all --name-only` |
| Rotura del contrato | 27 payloads propios | Ejecutados contra los esquemas (sección 5) |

No se ha tocado `/home/ia02/diana-wt/*`. El repositorio se ha usado en sólo lectura salvo
este fichero.

---

## 2. Comprobación tópico por tópico (dosier §15.1)

Los 13 tópicos del dosier están presentes, con esquema, QoS y retención asignados.
**Ninguno falta y no se ha inventado ninguno.**

| # | Tópico del dosier §15.1 | ¿En el contrato? | Esquema | QoS | Retain | Coherente con §15.2 |
|---|---|:--:|---|:--:|:--:|:--:|
| 1 | `system/{id}/status` | sí | `system-status` | 1 | sí | sí |
| 2 | `system/{id}/command` | sí | `system-command` | 1 | no | sí |
| 3 | `system/{id}/game/state` | sí | `game-state` | 1 | sí | sí |
| 4 | `system/{id}/game/event` | sí | `game-event` | 1 | no | sí |
| 5 | `module/{id}/presence` | sí | `module-presence` | 1 | sí | sí |
| 6 | `module/{id}/status` | sí | `module-status` | 1 | sí | sí |
| 7 | `module/{id}/telemetry` | sí | `module-telemetry` | 0 | no | sí (§15.2 «telemetría frecuente → 0») |
| 8 | `module/{id}/config/desired` | sí | `module-config` | 1 | sí | sí |
| 9 | `module/{id}/config/reported` | sí | `module-config` | 1 | sí | sí |
| 10 | `module/{id}/command` | sí | `module-command` | 1 | no | sí |
| 11 | `module/{id}/hit` | sí | `hit-event` | 1 | no | sí (§15.2 «impacto → 1») |
| 12 | `module/{id}/diagnostic` | sí | `module-diagnostic` | 1 | no | sí |
| 13 | `module/{id}/ota` | sí | `ota-command` | 1 | no | sí (§15.2 «OTA → 1») |

**Retenidos.** La regla declarada («sólo estado observable; los eventos nunca se retienen»)
es correcta y es exactamente la protección adecuada: un `hit` retenido reproduciría
impactos al reconectar. No hay ningún retenido peligroso *por su tópico*. Sí hay dos
huecos de ciclo de vida del retenido: ver **H-12**.

**Last Will.** Correcto y bien construido: mismo tópico que `presence`, QoS 1, retain true,
`online:false`, `reason:"lwt"`, con `connect` y `shutdown` como contrapartes. El ejemplo
`valid/module-presence/lwt.json` valida. Observación en **H-12**.

---

## 3. Comprobación evento por evento (dosier §15.4)

Los 17 tipos de evento del dosier tienen expresión contractual. **Ninguno falta.**

| # | Evento §15.4 | Dónde vive en el contrato |
|---|---|---|
| 1 | Presencia | `module-presence` (tópico retenido) |
| 2 | Conexión | `module-presence.reason = "connect"` |
| 3 | Desconexión | `module-presence.reason = "shutdown" \| "lwt"` |
| 4 | Impacto válido | `hit-event.classification = "valid_hit"` |
| 5 | Impacto incorrecto | `hit_on_safe`, `hit_on_already_hit`, `out_of_order`, `early_shot` |
| 6 | Vibración descartada | `crosstalk_rejected` (+ bloque `neighbours` para auditarla) |
| 7 | Impacto ambiguo | `ambiguous` |
| 8 | Cambio de estado | `module-status` (retenido) y `game-event.kind = "target_activated"` |
| 9 | Inicio de ronda | `game-event.kind = "round_armed" / "countdown_started" / "round_started"` |
| 10 | Pausa | `round_paused` / `round_resumed` |
| 11 | Fin | `round_finished` / `round_aborted` |
| 12 | Error de sensor | `module-diagnostic.kind = "sensor_error"` |
| 13 | Reinicio | `module-diagnostic.kind = "boot" / "reset_reason"` |
| 14 | Baja tensión | `module-diagnostic.kind = "low_voltage"` |
| 15 | Sobretemperatura | `module-diagnostic.kind = "over_temperature"` |
| 16 | Resultado de calibración | `module-diagnostic.kind = "calibration_result"` |
| 17 | Actualización de firmware | `module-diagnostic.kind = "ota_result"` + `ota-command` |

Cobertura adicional bien traída y no exigida: `queue_overflow`, `mqtt_disconnect`,
`schema_rejected`, `command_rejected`, `coordinator_lost`, `module_lost`. Son precisamente
los eventos que hacen auditable la degradación del §14.3 y del §24.

**Estados de diana (§13.4).** Los 10 del dosier (`APAGADA`, `SEGURA_AZUL`, `ACTIVA_ROJA`,
`ALCANZADA_VERDE`, `CALIBRACION`, `BLOQUEADA`, `ERROR_SENSOR`, `PENALIZACION`,
`MANTENIMIENTO`, `DESHABILITADA`) están en `targetState`, más `countdown` y `error`, que el
dosier §2 y §10.5 exigen como estados visuales. **Cobertura completa.**

**Estados de módulo (§13.3).** Los 13 del dosier están en `moduleState`
(`boot`, `selftest`, `network`, `registering`, `ready`, `error`, `calibration`,
`maintenance`, `game_prepare`, `game_countdown`, `game_active`, `game_paused`,
`game_finished`). **Cobertura completa.**

**Modos de juego (§16).** **Aquí sí falta cobertura**: ver **H-03**.

---

## 4. Evidencia ejecutada

### 4.1 Validador oficial

```
$ cd /home/ia02/Diana && python3 contracts/validate.py --verbose
  ok  schema   game-event.schema.json
  ok  schema   game-state.schema.json
  ok  schema   hit-event.schema.json
  ok  schema   module-command.schema.json
  ok  schema   module-config.schema.json
  ok  schema   module-diagnostic.schema.json
  ok  schema   module-presence.schema.json
  ok  schema   module-status.schema.json
  ok  schema   module-telemetry.schema.json
  ok  schema   ota-command.schema.json
  ok  schema   system-command.schema.json
  ok  schema   system-status.schema.json
  ok  schema   common.schema.json
  ok  válido  valid/game-event/target-hit.json
  ok  válido  valid/game-state/running.json
  ok  válido  valid/hit-event/crosstalk-rejected.json
  ok  válido  valid/hit-event/replayed-from-queue.json
  ok  válido  valid/hit-event/valid-hit.json
  ok  válido  valid/module-command/identify.json
  ok  válido  valid/module-command/set-targets.json
  ok  válido  valid/module-config/desired.json
  ok  válido  valid/module-diagnostic/low-voltage.json
  ok  válido  valid/module-presence/lwt.json
  ok  válido  valid/module-presence/online.json
  ok  válido  valid/module-status/ready.json
  ok  válido  valid/module-telemetry/nominal.json
  ok  válido  valid/ota-command/update.json
  ok  válido  valid/system-command/start-game.json
  ok  válido  valid/system-status/ready.json
  ok  rechaza invalid/hit-event/future-schema-version.json
  ok  rechaza invalid/hit-event/missing-device-time.json
  ok  rechaza invalid/hit-event/rejection-without-reason.json
  ok  rechaza invalid/hit-event/server-timestamp-injected.json
  ok  rechaza invalid/hit-event/target-index-out-of-range.json
  ok  rechaza invalid/module-command/missing-expiry.json
  ok  rechaza invalid/module-command/unknown-action.json
  ok  rechaza invalid/module-config/incomplete-calibration.json
  ok  rechaza invalid/module-presence/bad-module-id.json
  ok  rechaza invalid/module-status/wrong-target-count.json
  ok  rechaza invalid/ota-command/update-without-signature.json
  ok  rechaza invalid/system-command/start-without-game.json

contratos: 41 comprobaciones, 0 fallos
EXIT=0
```

Confirmado: `TEST_MATRIX` C-01…C-05 `VERDE` es **cierto y reproducible**. El recuento del
`CHANGELOG` (16 válidos, 12 inválidos) coincide con el árbol real.

### 4.2 Resolución estricta de `$ref` (prueba del supervisor)

Registrando cada esquema **sólo bajo su `$id` real**, es decir, sin el atajo de doble base
que aplica `validate.py`:

```
$ python3 - <<'PY'   # registro estricto por $id
...
PY
RESOLUCION ESTRICTA FALLA: _WrappedReferencingError Unresolvable: common.schema.json#/$defs/schemaVersion
```

Causa: `common.schema.json` tiene `$id` `…/contracts/schemas/common.schema.json` y vive en
`contracts/schemas/`, pero los esquemas de `contracts/mqtt/` lo referencian como
`"common.schema.json#/$defs/…"`, que bajo resolución estándar apunta a
`…/contracts/mqtt/common.schema.json`, inexistente. → **H-02**.

### 4.3 Búsqueda de secretos

```
$ grep -rInE "(password|passwd|secret|token|api[_-]?key|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}\.)" --exclude-dir=.git .
$ find . -path ./.git -prune -o \( -name "*.pem" -o -name "*.key" -o -name ".env" -o -name "*.p12" -o -name "id_rsa*" -o -name "*.htpasswd" \) -print
$ git log --all --oneline --name-only | grep -iE "\.env|\.pem|\.key|passwd|secret"
```

**Resultado: ningún secreto.** Las 13 coincidencias de `grep` son todas prosa de política
(`SECURITY.md`, `MASTER_PLAN.md`, `WORK_PACKAGES.md`, `.gitignore`, descripciones de
esquema). Ningún fichero sensible en el árbol ni en el historial completo (4 commits).
El `.gitignore` cubre `.env*`, `*.key`, `*.pem`, `secrets/`, `*.htpasswd`, `mosquitto/passwd`,
`backups/*.dump` y `sdkconfig`. **Correcto.**

### 4.4 Estructura del repositorio

Separación firmware / servidor / contratos **respetada y sin fugas**: `firmware/esp32/`
(board, components, main, tests, tools) no contiene nada de servidor; `server/` agrupa
backend, frontend, worker y database; `contracts/` es único y `OWNERSHIP.md` lo asigna a
WP-00 con la única excepción documentada de `contracts/api/openapi.json` (artefacto
generado por WP-02). Coherente con el dosier §19.1 leído a través de ADR-0004, y con la
tabla de propiedad de rutas del §31.4. **Conforme.**

---

## 5. Intentos de romper el contrato

27 payloads escritos por el supervisor y ejecutados contra los esquemas. Los diez exigidos
por el encargo de revisión son los T01-T10.

### 5.1 Los diez ataques exigidos — **todos rechazados**

| ID | Ataque | Resultado | Mensaje del validador |
|---|---|:--:|---|
| T01 | `hit-event` con `elapsed_us` plano puesto por el servidor | RECHAZADO | `Additional properties are not allowed ('elapsed_us' was unexpected)` |
| T02 | `hit-event` con `received_at` + `server_elapsed_us` | RECHAZADO | `Additional properties are not allowed ('received_at', 'server_elapsed_us' were unexpected)` |
| T03 | `module_id` = `module-+` | RECHAZADO | `does not match '^[a-z0-9][a-z0-9-]{2,62}$'` |
| T04 | `module_id` = `module#03` | RECHAZADO | idem |
| T05 | `module_id` = `module-03/../../system-a` (fuga de tópico) | RECHAZADO | idem |
| T06 | Comando sin `nonce` | RECHAZADO | `'nonce' is a required property` |
| T07 | Impacto con `amplitude: -5` | RECHAZADO | `-5 is less than the minimum of 0` |
| T08 | `schema_version: 0` | RECHAZADO | `1 was expected` |
| T09 | `schema_version: 2` | RECHAZADO | `1 was expected` |
| T10 | `module-config` con 10 dianas | RECHAZADO | `maxItems`/`minItems` = 9 |

**Conclusión sobre el modelo temporal:** no he encontrado ningún hueco por el que un
backend pueda colar un tiempo propio *dentro del payload*. `additionalProperties: false` en
los doce esquemas, `device` obligatorio en `hit-event`, y la ausencia total de cualquier
campo `received_at`/`persisted_at`/`server_*` en el espacio de nombres del contrato lo
cierran de forma efectiva. T12 confirma además que un evento sin T1 se rechaza aunque
traiga T2. **Este es el punto más fuerte de la entrega.** La única vía que queda abierta no
es de esquema sino de autorización, y es la ACL: ver **H-01**.

### 5.2 Ataques adicionales del supervisor

| ID | Payload | Resultado | Hallazgo |
|---|---|:--:|:--:|
| T11 | `device.event_us: -1` | RECHAZADO | — |
| T12 | Sin `device` pero con `coordinator` relleno | RECHAZADO | — |
| T13 | Un satélite rellena él mismo el bloque `coordinator` con `elapsed_us: 0` | **ACEPTADO** | H-08 |
| T14 | `classification: valid_hit` sobre `target_state_before: safe` | **ACEPTADO** | H-17 |
| T15 | `valid_hit` con `amplitude: 5` y `threshold: 9000` | **ACEPTADO** | H-17 |
| T16 | `hit-event` de partida sin `game_id` ni `round_id` | **ACEPTADO** | H-11 |
| T17 | `action: set_targets` **sin** `params.targets` | **ACEPTADO** | H-07 |
| T18 | Comando `reboot` de `operator-cli` con `expires_in_ms: 600000` | **ACEPTADO** | H-05 |
| T19 | `module-status` con las 9 dianas declarando `target_index: 1` | **ACEPTADO** | H-10 |
| T20 | `module-status` con `role: "auto"` | **ACEPTADO** | H-09 |
| T21 | `set_topology` con los 9 módulos en la posición `(0,0)` | **ACEPTADO** | H-10 |
| T22 | `game-state` con `targets_hit: 81` y `targets_remaining: 81` | **ACEPTADO** | H-17 |
| T23 | `mode: "memory"` (dosier §16.5) | RECHAZADO | **H-03** |
| T24 | OTA con `url: http://evil.example.net/fw.bin` | **ACEPTADO** | H-16 |
| T25 | `diagnostic.detail = {"mqtt_password": "hunter2"}` | **ACEPTADO** | H-15 |
| T26 | Vecino declarado con el índice de la propia diana impactada | **ACEPTADO** | H-10 |
| T27 | `event_id` ULID en minúsculas | RECHAZADO | correcto (ULID es Crockford en mayúsculas) |

---

## 6. Respuesta a las preguntas de la puerta

**¿El modelo temporal impide de verdad que la hora de llegada sustituya a la del impacto?**
Sí, en el payload. Verificado con T01, T02 y T12. El modelo de cuatro marcas de ADR-0002 es
la lectura correcta de §14.2, §20.3 y §29.7, y la corrección del ejemplo §15.3 del dosier
está bien fundada. **Hueco restante:** el esquema no sabe quién publica; sólo la ACL lo
sabe, y la ACL declarada es contradictoria (**H-01**) y todavía no existe como fichero
(**H-13**). Además un módulo puede fabricar T2 (**H-08**).

**¿La idempotencia cubre QoS 1, el reenvío de cola y el reflasheo?**
Sí, y está bien razonada. `event_id` generado en el módulo detector y estable entre
reintentos cubre QoS 1 (duplicados como métrica, no como error) y el reenvío de cola
(`replay: true`, que explícitamente no implica duplicado — probado con
`valid/hit-event/replayed-from-queue.json`). El reflasheo lo cubre `boot_id`: aunque la NVS
se borre y `local_sequence` vuelva a 0, la tupla `(module_id, boot_id, local_sequence)`
no colisiona con el histórico, y la deduplicación real sigue siendo por `event_id`, que es
inmune al reinicio del contador. Dosier §14.4 satisfecho. Queda sin fijar la ventana de
retención de la deduplicación (**H-20**).

**¿Los contratos cubren todos los tópicos §15.1 y todos los eventos §15.4?**
Sí a ambos, uno por uno, en las secciones 2 y 3. **No falta ninguno.**

**¿QoS, retenidos y Last Will son correctos y coherentes con §15.2?**
Sí. Ningún retenido peligroso por tópico; los eventos nunca se retienen, que es la decisión
correcta. Pendiente el ciclo de vida de los retenidos (**H-12**).

**¿Caducidad y número de secuencia protegen contra reproducción de comandos antiguos?**
**Parcialmente, y con un defecto.** El `nonce` monotónico por emisor sí bloquea la
reproducción, pero la caducidad, tal como está redactada, no (**H-05**).

**¿Munición / disparos / impactos / precisión respetan §17.2-17.3 y el caso "no calculable"?**
Sí en la doctrina: ADR-0006 separa las seis magnitudes, define las dos fórmulas exactamente
como el dosier, hace `null` los disparos y ambas precisiones cuando se desconoce la munición
restante, expone `accuracy_status: "not_computable"` y **prohíbe explícitamente** sustituir
los disparos desconocidos por la munición inicial o derivar fallos de la diferencia. Es la
lectura correcta y estricta de §17.3. No hay todavía artefacto de contrato que lo imponga
(**H-19**), lo cual es legítimo porque `contracts/api/` es de la Ola 1.

**¿Estados de diana y de módulo cubren §13.3 y §13.4?**
Sí, completos ambos. Detalle en la sección 3.

**¿La estructura respeta la separación firmware/servidor/contratos?**
Sí. Sección 4.4.

**¿Hay secretos?**
No. Sección 4.3.

**¿Las correcciones al dosier de `DECISIONS.md` son legítimas?**
Dos de tres, sí. Detalle en **H-06**.

---

## 7. Hallazgos

### BLOQUEANTE

**H-01 · La ACL de MQTT del contrato es incompatible con su propia tabla de tópicos.**
`contracts/mqtt/README.md` §8 (repetido en `SECURITY.md` y `docs/architecture/overview.md`
§7) declara: «cada módulo escribe sólo bajo `targets/v1/module/{su_id}/#`» y «el backend es
el único con permiso de escritura sobre `system/#`». La tabla §2 del mismo fichero asigna,
en cambio, `system/…/game/state` y `system/…/game/event` al **principal**, que es un módulo.
Tres contradicciones concretas:

1. El coordinador no podría publicar `game/state` ni `game/event` — los dos tópicos que la
   tabla le atribuye y por los que circula T2, la autoridad temporal de la partida.
2. La descripción de `hit-event.schema.json` dice «Reenviado por el coordinador con el
   bloque `coordinator` relleno», y el ejemplo `valid/hit-event/valid-hit.json` es
   exactamente eso: `module_id: "module-03"` con el bloque `coordinator` ya relleno. Para
   producirlo, el principal tendría que escribir en `targets/v1/module/module-03/hit`, que
   la ACL le prohíbe. **La consolidación de impactos es inejecutable tal como está
   especificada.**
3. La lista de lectura del módulo (`…/command`, `…/config/desired`, `…/ota`,
   `system/+/game/state`) no incluye `module/+/hit` ni `system/{id}/command`, que el
   coordinador necesita para su función.

Gravedad: WP-01 va a escribir el fichero `acl` a partir de este texto y WP-04/WP-05 van a
codificar contra esta tabla. Además la ACL es el **único** control que impide al backend
publicar en `module/…/hit`, es decir, el cierre real del requisito de ADR-0002.

**Corrección exigida:** definir el rol *coordinador* como sujeto de ACL con permisos
propios (escritura en `system/{id}/game/#`, lectura de `system/{id}/command` y de
`module/+/hit`), y resolver explícitamente cómo se publica el impacto consolidado. La
opción limpia es un tópico distinto —p. ej. `system/{id}/game/hit`— en lugar de que un
módulo reescriba el tópico de otro; si se mantiene el reenvío sobre `module/{id}/hit`, hay
que documentar la excepción de ACL y su consecuencia de suplantación. Actualizar en
consecuencia §8 del README de contratos, `SECURITY.md`, `overview.md` §7 y el ejemplo
`valid-hit.json`.

**H-02 · Los `$ref` de los doce esquemas son irresolubles fuera del validador propio.**
`common.schema.json` declara `$id: https://diana.seccionnueve/contracts/schemas/common.schema.json`
y vive en `contracts/schemas/`; los doce esquemas de `contracts/mqtt/` lo referencian como
`"common.schema.json#/$defs/…"`. Bajo resolución estándar de URI base eso apunta a
`…/contracts/mqtt/common.schema.json`, que no existe. Probado en 4.2:
`Unresolvable: common.schema.json#/$defs/schemaVersion`.

El validador incluido lo enmascara deliberadamente: `load_registry()` registra cada recurso
bajo *ambas* bases y bajo su nombre de fichero. Es decir, **el único consumidor que
funciona es el que trae el parche**. ajv (NestJS/backend), los generadores de tipos para el
simulador y el firmware, y cualquier verificación en CI fallarán en el primer intento. Con
los contratos declarados «CONGELADOS» y tres paquetes a punto de derivar de ellos, esto se
paga siete veces.

**Corrección exigida:** hacer los `$ref` resolubles por sí solos. La opción mínima y
compatible es `"../schemas/common.schema.json#/$defs/…"` en los doce esquemas; la
alternativa es mover `common.schema.json` a `contracts/mqtt/`. Después, **eliminar el
registro de doble base de `validate.py`** para que el validador deje de ocultar el problema,
y añadir a la suite una comprobación de resolución estricta por `$id`.

### MAYOR

**H-03 · Faltan dos modos de juego del dosier en un enum cerrado y congelado.**
El dosier §16 define siete modos; sólo §16.7 (duelo) está marcado como «evolución
posterior». `game-state.mode` y `system-command.game.mode` admiten cuatro: `random`,
`sequence`, `all_against_clock`, `reaction`. **Faltan `memory` (§16.5) y `no_shoot`
(§16.6)**, ambos dentro del alcance. Probado: T23 rechaza `"memory"`.

Agrava el hallazgo que `CONTRIBUTING.md` §Contratos regla 1 dice «un cambio incompatible
exige `v2` y un ADR; no se modifica `v1` en sitio»: añadir dos valores a un enum cerrado ya
congelado obligaría a un `v2` completo. Y que la reducción **no figura en la tabla
«Correcciones al dosier» de `DECISIONS.md`**, pese a ser una reducción de alcance frente a
la fuente normativa; sólo aparece de refilón en `WORK_PACKAGES.md` como «los 4 modos de
juego del encargo §10».

**Corrección exigida:** añadir `memory` y `no_shoot` a los dos enums antes de congelar
—`no_shoot` además tiene ya semántica en el contrato (`hit_on_safe`, `penalty_applied`)— o,
si la reducción de alcance es deliberada, declararla explícitamente en «Correcciones al
dosier» con su motivo y su ADR, y no como un detalle de un paquete de trabajo.

**H-04 · La Ola 0 se ha aprobado a sí misma antes de esta puerta.**
`MASTER_PLAN.md` §2 marca la Ola 0 como `APPROVED`, y `STATUS.md` da WP-00 como `APPROVED`
con la columna «Revisión: **Supervisor**». En el momento de escribir esto, el supervisor no
había emitido ningún dictamen: este fichero decía literalmente «_Pendiente de la revisión de
cierre._». Esto viola el dosier §31.2 («ningún equipo aprueba su propio trabajo»), la regla 3
del propio `MASTER_PLAN.md` y la sección «Quién aprueba» de `CONTRIBUTING.md`. Es exactamente
el riesgo P-05 que `RISKS.md` declara ALTO.

**Corrección exigida:** revertir WP-00 y la Ola 0 a `PENDING` en `STATUS.md` y
`MASTER_PLAN.md`, y no volver a marcar `APPROVED` salvo con referencia al dictamen de este
fichero. Ningún paquete puede figurar como revisado por el supervisor sin dictamen escrito.

**H-05 · La caducidad de comandos no protege contra reproducción de comandos antiguos.**
`contracts/mqtt/README.md` §6 define el descarte por caducidad como «han pasado más de
`expires_in_ms` desde **la recepción del canal**». Medida desde la recepción, la ventana se
reinicia en cada entrega: un comando capturado hoy y reinyectado mañana llega con una
ventana intacta de 5 s. La caducidad no aporta nada frente al ataque que el dosier §23.3
nombra («protección frente a comandos antiguos»); toda la defensa recae en el `nonce`.

Y el `nonce` tiene su propio hueco: el contrato no dice que el último `nonce` aceptado por
emisor se **persista en NVS**. `local_sequence` y `config_version` sí llevan esa exigencia
explícita; el `nonce` no. Tras un reinicio o un reflasheo, un módulo que arranque con el
contador a 0 acepta cualquier comando antiguo capturado. Con `expires_in_ms` admitiendo
hasta 600 000 ms (T18: `reboot` de `operator-cli` con 10 minutos de validez), la ventana
práctica es amplia.

**Corrección exigida:** (a) redefinir la caducidad contra una referencia no reiniciable
—`issued_at_ms` contrastado con reloj sincronizado, o un desafío/respuesta— y decir qué
hace un módulo sin reloj de pared, que el propio contrato admite (`epoch_ms` es anulable);
(b) exigir explícitamente la persistencia del último `nonce` por emisor en NVS, con el
mismo rango que `local_sequence`; (c) justificar o reducir el techo de `expires_in_ms` para
acciones críticas (`reboot`, `ota`, `set_maintenance`).

**H-06 · «El encargo» es normativo en doce sitios y no está en el repositorio.**
`DECISIONS.md`, `MASTER_PLAN.md`, `WORK_PACKAGES.md`, `TEST_MATRIX.md` y los ADR 0004, 0005
y 0006 citan «el encargo» §4, §9, §10, §11, §12, §13, §18, §19 y su «regla 3.2» como fuente
de requisitos. No existe ningún fichero de ese nombre en el árbol (verificado con `ls -a` y
`find`). Consecuencia directa sobre la pregunta que esta puerta debía responder:

- Corrección al dosier §15.3 (`elapsed_us` plano → bloques `device`/`coordinator`):
  **legítima**. Es un error objetivo del ejemplo, demostrable contra §14.2 y §29.7 del propio
  dosier, que exigen distinguir las marcas. Bien argumentada en ADR-0002.
- Corrección «Reparabile» → «Reparable»: **legítima**, errata tipográfica.
- Corrección al dosier §19.1 (árbol de carpetas): **no es un error objetivo del dosier**. Es
  un cambio de requisito, y su única justificación es «el encargo §4», un documento que no
  se puede auditar. El resultado técnico me parece bueno y ADR-0004 lo argumenta bien, pero
  está clasificado como corrección de error cuando es una decisión de requisito.

**Corrección exigida:** incorporar el encargo al repositorio (o el extracto normativo
pertinente) para que sus referencias sean verificables, y reclasificar la fila §19.1 de
«Correcciones al dosier» como decisión de requisito con ADR, no como corrección de errata.
Mismo tratamiento para la reducción de modos de juego de **H-03**.

**H-07 · `module-command` no valida los parámetros según la acción.**
`system-command` exige `game` si la acción es `arm_game`/`start_game`, y `ota-command` exige
`firmware` si la acción es `update`. `module-command` no tiene ninguna condicional: T17
demuestra que `action: "set_targets"` **sin** `params.targets` valida sin error, igual que
`start_calibration` sin nada. El esquema delega en un comentario («validados por el firmware
según la acción»), lo que traslada al firmware una responsabilidad que el contrato asume en
los otros dos casos y rompe la simetría de un contrato congelado.

**Corrección exigida:** añadir `if/then` por acción en `module-command.schema.json` al menos
para `set_targets` (exige `params.targets` no vacío), `set_all_targets` (exige `params.state`),
`identify`/`led_test` (exige `params.duration_ms`) y `set_maintenance` (exige `params.enabled`),
con su ejemplo inválido correspondiente. Es el mismo patrón que ya se usa dos veces.

### MENOR

**H-08 · Un satélite puede fabricar T2.** T13: un `hit-event` publicado por un módulo
cualquiera con el bloque `coordinator` relleno (`elapsed_us: 0`) valida. El contrato no ata
el bloque `coordinator` a quien tiene autoridad para producirlo. **Exigido:** o bien un
tópico distinto para el impacto consolidado (encaja con la corrección de H-01), o bien un
campo `coordinator.by` con el `module_id` del principal que el backend contraste contra
`system-status.coordinator_module_id`.

**H-09 · `moduleRole` admite `auto`, contra su propia descripción.** `common.schema.json`
documenta «`auto` sólo aparece como posición del selector, nunca como rol resuelto», pero lo
incluye en el enum de `moduleRole`, y T20 lo confirma aceptado. **Exigido:** `moduleRole`
= `["principal","satellite"]`; `AUTO` ya está donde debe, en `selectorPosition`.

**H-10 · No hay unicidad en ninguna colección indexada.** T19: las nueve entradas de
`module-status.targets` pueden declarar `target_index: 1`. T21: los nueve módulos de
`set_topology` pueden ocupar la posición `(0,0)`, pese a que el dosier §6.1 exige «detectar
posiciones duplicadas». T26: un vecino puede declararse con el índice de la propia diana
impactada. **Exigido:** `uniqueItems` o restricción equivalente sobre `target_index` en
`module-status.targets`, `module-config.calibration`, `game-state.active_targets` y
`hit-event.neighbours`, y sobre `position` en `system-command.topology`.

**H-11 · `hit-event` no exige `game_id`/`round_id`.** T16 valida. El dosier §25.2 exige
correlación por `game_id`, `round_id` y `event_id`; un impacto de partida sin ellos sólo es
correlacionable a través del `game-event` del coordinador. **Exigido:** exigirlos
condicionalmente cuando `target_state_before` implique contexto de partida, o documentar
explícitamente que la atribución es responsabilidad exclusiva del coordinador.

**H-12 · Ciclo de vida de los retenidos sin especificar.** Tres huecos: (a) nada obliga al
coordinador a publicar una fase terminal en `game/state` al acabar la ronda, de modo que un
módulo que reconecte tras un reinicio del broker puede recibir un `phase: "running"` viejo y
encender LED de partida; (b) nada define cómo se limpia el retenido de `presence`,
`status` y `config/*` al dar de baja o sustituir un módulo, que el dosier §6.1 contempla;
(c) la ACL de lectura del módulo usa `targets/v1/system/+/game/state`, con comodín sobre
cualquier instalación, frente al §23.3 «rechazo de mensajes de otra instalación».
**Exigido:** regla explícita de publicación terminal y de purga de retenidos, y sustituir el
`+` por el `system_id` de la instalación.

**H-13 · Referencias colgantes.** No existen: `infrastructure/mosquitto/acl` y
`docs/security/threat-model.md` (citados por `contracts/mqtt/README.md` §8),
`docs/firmware/led-states.md` (citado por `common.schema.json`), `Makefile` y el objetivo
`make contracts-test` (citado por el README de contratos y por `CONTRIBUTING.md`),
`.env.example`, `compose.yml`. En consecuencia, **el «Arranque rápido» del `README.md` raíz
no funciona en ningún paso** salvo el de `python3 contracts/validate.py`. Son rutas de la
Ola 1, pero se presentan como existentes. **Exigido:** marcarlas como pendientes o retirarlas
hasta que WP-01 las entregue.

**H-14 · `commandEnvelope` está definido y no se usa.** `common.schema.json` define
`$defs/commandEnvelope` con los cinco campos obligatorios de todo comando; ninguno de los
tres esquemas de comando lo referencia (verificado con `grep`): los tres copian los campos a
mano. Es precisamente el tipo de duplicación que ADR-0004 prohíbe entre paquetes.
**Exigido:** referenciarlo vía `allOf` en `module-command`, `system-command` y `ota-command`,
o eliminarlo.

### OBSERVACIÓN

**H-15 ·** `module-diagnostic.detail` es `additionalProperties: true`; T25 acepta
`{"mqtt_password":"hunter2"}`. La prohibición («sin secretos ni credenciales») es sólo
textual, sobre un tópico que el panel muestra en vivo (§22.5). Considerar un `propertyNames`
que rechace claves tipo `*password*`, `*token*`, `*secret*`.

**H-16 ·** `ota-command.firmware.url` no está restringida a la red local (T24 acepta un host
externo). El riesgo real está bien mitigado por `sha256` + `signature` obligatorias y la
verificación previa a activar; conviene fijarlo también en el contrato.

**H-17 ·** No hay coherencia semántica entre campos: T14 (`valid_hit` sobre diana `safe`),
T15 (`valid_hit` con amplitud por debajo del umbral), T22 (`targets_hit: 81` con
`targets_remaining: 81`). Es una decisión defendible —el JSON Schema valida forma, no
reglas de juego— pero debe declararse dónde se validan esas reglas y quién las prueba.

**H-18 ·** ADR-0005 fija `memory=4096` con `balloon=1024`. Bajo presión del nodo, la VM puede
quedar en 1 GB, por debajo del mínimo orientativo de 2 GB del dosier §26.2. La decisión es
del usuario y está bien documentada; procede vigilar el globo y probar carga con el valor
real, no con los 4 GB nominales.

**H-19 ·** La regla de precisión no calculable (§17.2-17.3), correctamente definida en
ADR-0006, no tiene todavía artefacto de contrato: `contracts/api/` está vacío. Legítimo en
la Ola 0, pero el OpenAPI de WP-02 debe reflejar `accuracy_status: "not_computable"` y la
anulabilidad de los tres campos, y `B-05` debe ejecutarse antes de cerrar la Ola 2.

**H-20 ·** ADR-0003 fija la ventana de retención de la deduplicación «por partida» sin
cuantificarla. Un evento reenviado desde la cola tras una desconexión larga (§14.3, §24.1)
puede quedar fuera de la ventana y contarse dos veces. Fijar la ventana con un número.

---

## 8. Lo que está bien y debe conservarse

No todo son hallazgos, y conviene que quede escrito para que las correcciones no lo rompan:

- El modelo de cuatro marcas es la respuesta correcta a §14.2/§20.3/§29.7, y la elección de
  **excluir T3/T4 del payload** convierte un requisito de disciplina en una imposibilidad
  estructural. Es la mejor decisión de la Ola 0.
- `additionalProperties: false` en los doce esquemas: sin él, T01 y T02 pasarían.
- Los doce ejemplos inválidos son pruebas negativas de verdad, no decorado, y el dosier
  §31.2 las exige. El validador comprueba que un inválido que valida es un fallo.
- Transmitir `crosstalk_rejected` en vez de descartarlo en silencio (D-06), con el bloque
  `neighbours`, hace auditable la decisión más delicada del firmware (§9.6).
- `boot_id` (D-08) resuelve un problema real que `local_sequence` sola no cubre.
- ADR-0006 es fiel al dosier hasta el detalle de **prohibir** derivar fallos de la munición.
- La regla de evidencia de `CONTRIBUTING.md` y la prohibición de «debería funcionar».
- Cobertura completa, uno por uno, de los 13 tópicos, los 17 eventos, los 10+2 estados de
  diana y los 13 estados de módulo.

---

## 9. Dictamen

# `NO CONFORME`

**Bloqueantes:** H-01 (ACL incompatible con la tabla de tópicos; la consolidación de
impactos es inejecutable y el cierre real de ADR-0002 depende de ella) y H-02 (los `$ref`
sólo resuelven con el validador propio; cualquier otra herramienta falla).

**Mayores que deben cerrarse en el mismo ciclo:** H-03 (faltan `memory` y `no_shoot` en un
enum congelado, sin declararlo como reducción de alcance), H-04 (autoaprobación de la Ola 0),
H-05 (la caducidad no protege contra reproducción; `nonce` sin persistencia exigida),
H-06 (el encargo no está en el repositorio y sostiene la única corrección sustantiva al
dosier), H-07 (`module-command` sin validación por acción).

No se autoriza la apertura de la Ola 1 para los paquetes que consumen contratos —WP-02
backend, WP-03 frontend, WP-04 firmware, WP-05 simulador— hasta que H-01 y H-02 estén
corregidos y `contracts/validate.py` vuelva a pasar en verde **con la resolución estricta
de `$ref` incorporada a la suite**. WP-06 (hardware) y WP-08 (VM) no dependen de los
contratos y pueden continuar.

La calidad del trabajo revisado es alta y el núcleo del proyecto —la autoridad temporal—
está bien resuelto. Los dos bloqueantes son de corrección barata hoy y muy cara cuando siete
paquetes hayan construido encima. Corregidos H-01 a H-07, y con la evidencia de ejecución
correspondiente, el dictamen pasaría a `CONFORME CON OBSERVACIONES`.

**Firmado:** supervisor técnico (WP-12) · 2026-07-20
**Evidencia de este dictamen:** secciones 4 y 5 de este documento, todas ejecutadas por el
supervisor sobre `develop@8addff4`.
