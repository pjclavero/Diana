# Contratos MQTT · Diana v1

**Estado:** CONGELADO para la Ola 1 (`v1`), con la ampliación **v1.1** descrita en el §0.
**Cambios:** cualquier modificación incompatible exige un `v2` y un ADR. Los cambios compatibles (añadir campos opcionales, o un tópico nuevo que no reescribe ninguno existente) suben `schema_version` sólo si alteran la semántica de un mensaje ya emitido; una etiqueta de ampliación como "v1.1" es documental, no un valor que viaje en el payload.

Fuente normativa: `dosier_tecnico_matriz_dianas_modulares.md`, secciones 12, 14, 15, 17 y 23.3.

---

## 0. Ampliación v1.1 — canal de mantenimiento del backend

**Motivo.** El contrato v1 sólo daba al backend un camino para mandar órdenes a un módulo:
`module/{id}/command`, propiedad del coordinador según el §8 original. El backend intentaba
publicar ahí (F6) y el broker lo denegaba en silencio: la ACL bloqueaba el `client_id` del
backend en ese tópico, sin que nadie se enterase hasta auditar. La opción descartada era dar al
backend permiso de escritura sobre `module/{id}/command`: eso le habría permitido emitir
CUALQUIER orden de ese canal —incluidas las de juego— porque el broker autoriza por tópico, no
por contenido del payload.

**Decisión.** La autoridad se separa **por dominio, no por disponibilidad**:

> El coordinador gobierna el juego. El backend gobierna el mantenimiento. El módulo aplica
> localmente las reglas de seguridad.

**Qué cambia:**

1. Tópico nuevo `module/{module_id}/maintenance/command`, exclusivo del backend, con su propio
   esquema `module-maintenance-command.schema.json` y un repertorio cerrado de operaciones de
   mantenimiento (§2). No es un `v2`: no reescribe ningún tópico existente y el árbol `v1` no
   sufre ruptura estructural (§7).
2. `module-diagnostic.schema.json` gana un campo `request_id` **opcional** (detalle de
   compatibilidad en el propio esquema) para correlacionar la respuesta con la orden de
   mantenimiento que la originó, y una forma cerrada para `kind="command_rejected"`
   (`detail.accepted`, `detail.reason`). No se crea un tópico `maintenance/result`: el camino de
   vuelta módulo→backend ya existe (`module/{id}/diagnostic`, QoS 1, no retenido) y F6 ya lo
   persiste; duplicarlo habría creado dos caminos de vuelta para el mismo hecho.
3. `README.md` (este documento): tabla de tópicos, autoridad y §8 de permisos, para que quede
   explícito que el backend **no** tiene ni ha tenido nunca permiso de escritura sobre el tópico
   de juego — sólo se le abre un canal propio, más estrecho.

**Qué NO cambia:** el namespace `targets/v1/…`, ningún esquema de juego, la ACL de módulos hacia
`module/{id}/command` (siguen en sólo lectura), ni ninguno de los tópicos de la Ola 1.

---

## 1. Espacio de nombres

```
targets/v1/system/{system_id}/status
targets/v1/system/{system_id}/command
targets/v1/system/{system_id}/game/state
targets/v1/system/{system_id}/game/event

targets/v1/module/{module_id}/presence
targets/v1/module/{module_id}/status
targets/v1/module/{module_id}/telemetry
targets/v1/module/{module_id}/config/desired
targets/v1/module/{module_id}/config/reported
targets/v1/module/{module_id}/command
targets/v1/module/{module_id}/maintenance/command
targets/v1/module/{module_id}/hit
targets/v1/module/{module_id}/diagnostic
targets/v1/module/{module_id}/ota
```

`{system_id}` y `{module_id}`: `^[a-z0-9][a-z0-9-]{2,62}$` (minúsculas, sin `/`, `+` ni `#`).

## 2. Tabla de tópicos

| Tópico | Publica | Suscribe | QoS | Retain | Esquema |
|---|---|---|---|---:|:---:|---|
| `system/…/status` | backend | módulos, panel | 1 | sí | `system-status.schema.json` |
| `system/…/command` | backend | módulo principal | 1 | no | `system-command.schema.json` |
| `system/…/game/state` | principal | backend, satélites | 1 | sí | `game-state.schema.json` |
| `system/…/game/event` | principal | backend | 1 | no | `game-event.schema.json` |
| `module/…/presence` | módulo | backend | 1 | **sí** | `module-presence.schema.json` |
| `module/…/status` | módulo | backend | 1 | sí | `module-status.schema.json` |
| `module/…/telemetry` | módulo | backend | 0 | no | `module-telemetry.schema.json` |
| `module/…/config/desired` | backend | módulo | 1 | **sí** | `module-config.schema.json` |
| `module/…/config/reported` | módulo | backend | 1 | sí | `module-config.schema.json` |
| `module/…/command` | **coordinador (exclusivo)** | módulo | 1 | no | `module-command.schema.json` |
| `module/…/maintenance/command` | **backend (exclusivo)** | módulo | 1 | no | `module-maintenance-command.schema.json` |
| `module/…/hit` | módulo | principal, backend | 1 | no | `hit-event.schema.json` |
| `module/…/diagnostic` | módulo | backend | 1 | no | `module-diagnostic.schema.json` |
| `module/…/ota` | backend | módulo | 1 | no | `ota-command.schema.json` |

**Retenidos:** sólo estado observable (`presence`, `status`, `config/*`, `game/state`, `system/status`).
Los eventos (`hit`, `game/event`, `diagnostic`) **nunca** se retienen: un retenido reproduciría impactos al reconectar.

### 2.1 Autoridad sobre los dos canales de orden (ampliación v1.1)

Un módulo recibe órdenes por dos tópicos, y sólo dos, con dominios disjuntos:

| Canal | Quién escribe | Repertorio | Contenido |
|---|---|---|---|
| `module/{id}/command` | **sólo el coordinador** | juego | activar/desactivar diana, estados de juego, iniciar secuencia, pausar/finalizar ronda, órdenes sincronizadas (`module-command.schema.json`, acciones existentes de la Ola 1) |
| `module/{id}/maintenance/command` | **sólo el backend** | mantenimiento | probar LED, probar piezo, solicitar telemetría, autodiagnóstico, identificar módulo, consultar versión/estado, iniciar calibración controlada (`module-maintenance-command.schema.json`) |

El backend **no tiene, y no ha tenido nunca**, permiso de escritura sobre `module/{id}/command`
(§8). No se le concede porque el broker autoriza por tópico completo: darle acceso a ese canal
le habría dado acceso a TODAS las órdenes de juego, no sólo a las de mantenimiento que necesita.
El coordinador, simétricamente, no publica en `maintenance/command`: ese canal es del backend
porque las operaciones de mantenimiento las inicia un operador o un usuario a través del backend,
no el flujo de una partida.

## 3. Last Will and Testament

Cada módulo registra en CONNECT:

```
topic:   targets/v1/module/{module_id}/presence
qos:     1
retain:  true
payload: {"schema_version":1,"module_id":"…","online":false,"reason":"lwt"}
```

Al conectar publica el mismo tópico con `"online": true` y `"reason": "connect"`.
Al desconectar de forma ordenada publica `"reason": "shutdown"`.

## 4. Modelo temporal (requisito crítico)

El dosier §14.2 y §20.3 prohíben usar la hora de llegada al servidor como hora del impacto.
Se distinguen **cuatro** marcas y ninguna sustituye a otra:

| Marca | Origen | Dónde vive | Campo |
|---|---|---|---|
| T1 · captura en el ESP32 | reloj monotónico del módulo | payload del módulo | `device.uptime_us` + `device.event_us` |
| T2 · consolidación del coordinador | reloj del módulo principal | payload del coordinador | `coordinator.recv_us`, `coordinator.elapsed_us` |
| T3 · recepción MQTT | backend, al llegar el mensaje | columna BD, nunca en el payload | `received_at` |
| T4 · persistencia | backend, al confirmar el INSERT | columna BD | `persisted_at` |

### Por dónde viaja T2

Ningún módulo escribe jamás en el tópico de otro módulo. El coordinador, por tanto, **no**
reescribe el `hit` de un satélite:

| Quién detecta | Dónde va T1 | Dónde va T2 |
|---|---|---|
| Un satélite | `module/{satelite}/hit` con `coordinator: null` | `system/{sys}/game/event` con `kind=target_hit`, enlazado por `hit_event_id` |
| El propio coordinador | `module/{coordinador}/hit` con el bloque `coordinator` relleno | el mismo mensaje |

El backend une ambos por `event_id`. Así la ACL puede ser estricta —cada módulo escribe
sólo lo suyo— sin dejar inejecutable la consolidación temporal.

Reglas:

- `elapsed_us` (tiempo de juego mostrado al jugador) lo calcula **el coordinador** a partir de T1, no el backend.
- El backend puede **rechazar o marcar** un evento fuera de ventana, pero no reescribe T1 ni T2.
- `clock_offset_us` es la estimación del desfase satélite↔principal y se transporta para auditoría.
- Un evento sin T1 es inválido.

## 5. Idempotencia y ordenación

- `event_id`: UUIDv4 o ULID, **generado en el módulo que detecta**, estable entre reintentos.
- `local_sequence`: contador monotónico por módulo, persistido en NVS, no se reinicia al reconectar (sí al reflashear; entonces `boot_id` cambia).
- `boot_id`: UUID nuevo en cada arranque. `(module_id, boot_id, local_sequence)` es único.
- El principal y el backend deduplican por `event_id`. QoS 1 garantiza *at-least-once*: los duplicados son esperados y **no** son un error.

## 6. Caducidad de comandos

Todo comando lleva:

- `command_id` (UUID) — idempotencia de la orden.
- `issued_at_ms` (epoch UTC del emisor).
- `expires_in_ms` (por defecto 5000).
- `nonce` monotónico por emisor, **persistido en NVS**.

Un módulo **descarta** un comando si:

1. `command_id` ya fue ejecutado (caché de los últimos 128), o
2. `nonce` ≤ último nonce aceptado de ese emisor, persistido entre reinicios
   (protección de reproducción, dosier §23.3), o
3. han pasado más de `expires_in_ms` **desde `issued_at_ms`**.

La regla 3 se mide contra la marca del emisor, **no contra la recepción**. Medida desde la
recepción, el plazo se reiniciaría en cada reentrega de QoS 1 y no protegería contra nada.

La regla 2 exige persistencia: una caché en RAM se pierde al reiniciar y reabre la ventana
de reproducción. Es la misma razón por la que `local_sequence` vive en NVS.

### Techo para acciones críticas

`expires_in_ms` admite hasta 600 000 ms para operaciones largas como OTA. Ese plazo es
inaceptable para acciones que alteran el estado del módulo: un `reboot` capturado y
reinyectado ocho minutos después seguiría siendo válido.

Para `reboot`, `set_maintenance` y `start_calibration` el receptor rechaza cualquier
`expires_in_ms` **superior a 15 000 ms**, con motivo declarado en `last_command.detail`.
El esquema no puede expresarlo por acción sin duplicar el enum, así que es una regla del
receptor, verificable en sus pruebas.

### Módulo sin hora sincronizada

La regla 3 exige hora de pared. Un módulo que no haya sincronizado reloj **acepta** el
comando —rechazarlo lo dejaría inoperante— y se apoya en el nonce persistido como defensa
principal. En ese caso **declara** que no ha verificado la caducidad en
`last_command.detail`, y lo contabiliza aparte. No se finge una comprobación no realizada.

Consecuencia operativa: **una instalación sin NTP no tiene protección por caducidad**, sólo
por nonce. El servidor de hora debe ser local (el propio backend); Diana opera sin Internet.

El resultado se reporta en `module/…/status` con `last_command`.

## 6-bis. Caducidad en `maintenance/command` sin hora sincronizada (ampliación v1.1)

El canal de mantenimiento hereda el mecanismo de caducidad del §6 (`issued_at_ms` +
`expires_in_ms`, nonce independiente por canal) pero **no** hereda la regla de "acepta siempre
sin reloj" tal cual: aquí se separa por **consecuencia**, no por comando concreto.

- **Categoría "leer"** (`request_telemetry`, `identify`, `query_version`, `query_status`): no
  actúan sobre el hardware. Se **aceptan** sin hora sincronizada, exactamente igual que el resto
  del contrato (§6) — rechazarlas dejaría indiagnosticable el caso que más importa: un módulo
  recién arrancado, sin reloj, que es justo el que hay que auditar primero.
- **Categoría "actuar"** (`led_test`, `piezo_test`, `self_test`, `start_calibration`): mueven un
  actuador o alteran el estado de calibración. Se **rechazan** sin hora sincronizada
  (`command_rejected`, `detail.reason="expired"`), porque no hay manera honesta de acotar cuánto
  tiempo lleva circulando una orden que va a mover algo, y el nonce por sí solo no dice nada sobre
  antigüedad — sólo sobre orden relativo.
- **Categoría "seguridad"** (`abort_calibration`, la única): se **acepta SIEMPRE**, sin
  excepción — con o sin reloj sincronizado, y aunque su propio `expires_in_ms` ya haya vencido
  medido contra la hora del emisor. Es la única orden de "actuar" con esta excepción, y es
  deliberada: `abort_calibration` no arranca nada, para lo que otra orden arrancó. Un mensaje de
  parada que llega tarde —por reloj no sincronizado, por cola, por lo que sea— sigue queriendo
  decir "para", y tratarlo como caducado dejaría exactamente sin salida el escenario que más
  importa: una calibración en marcha cuando no debería estarlo, o alguien delante de la diana. El
  coste de aceptar un abort "caducado" es cero (como mucho, para un proceso que ya había
  terminado solo); el coste de rechazarlo es un actuador que sigue activo sin que nadie pueda
  detenerlo desde este canal.

**¿Toda orden que arranca algo tiene su contraria?** Repasado el enum completo con ese criterio:
`led_test`, `piezo_test` e `identify` van acotados por `params.duration_ms` (máx. 60 000 ms) y se
autoterminan solos — no abren un proceso, lo agotan; no necesitan orden de parada. `start_calibration`
sí abre un proceso de duración no acotada por el propio mensaje, y por eso tiene `abort_calibration`
— igual que ya reconoce `module-command.schema.json`, que define ese mismo par para el canal de
juego. `self_test` no tiene contraria, ni la tuvo nunca en el canal de juego: es una rutina interna
de duración conocida por el firmware, no un proceso que el emisor deje abierto. `request_telemetry`,
`query_version` y `query_status` son consultas de una sola respuesta, no arrancan nada que detener.

Esta separación es deliberada y choca a propósito con el hallazgo abierto X-14/F-16
(`firmware/esp32/components/diana_core/src/command.c:215-246`): el firmware hoy acepta CUALQUIER
comando sin comprobar caducidad cuando `clock_ok == false`, y la instalación no tiene salida a
Internet ni servidor NTP confirmado. La regla de este §6-bis no está resuelta por ese código: es
un requisito NUEVO para el canal de mantenimiento, pendiente de implementar en firmware (que,
además, nunca se ha compilado con ESP-IDF — ver más abajo) y ya soportado en el simulador.

**Responsabilidad doble, explícita:** el rechazo por "actuar sin reloj" (y el rechazo por
`game_in_progress`, ver `module-diagnostic.schema.json`) es responsabilidad del **módulo**, que
debe aplicarlo localmente sea cual sea el emisor — pero el **backend, como emisor, comprueba
también antes de publicar** (hora local conocida, ausencia de partida activa reportada por
`system/…/game/state`). No es una comprobación redundante decorativa: el guardarraíl del módulo
va a vivir meses únicamente en el simulador, porque el firmware real de este programa nunca se ha
compilado con ESP-IDF. Mientras eso no cambie, la comprobación del emisor es la única que se
ejecuta de verdad contra hardware.

## 7. Compatibilidad

- `schema_version` es un entero. Un receptor **rechaza** `schema_version` mayor que el que soporta y lo registra como `incident`.
- Campos desconocidos: `additionalProperties: false` en los esquemas de este directorio. Los productores no deben añadir campos sin bump de versión.
- El namespace `v1` del tópico cambia sólo con ruptura estructural del árbol de tópicos.

## 8. Seguridad

- Mosquitto sin acceso anónimo. Un usuario por módulo, y el usuario **es exactamente el
  `module_id`**, sin prefijo (`module-` se retiró al cerrar F-02, el único hallazgo crítico del
  proyecto — ver más abajo).
- El `client_id` MQTT de un módulo **debe ser igual a su `module_id`**. El broker **reescribe el
  `client_id` con el usuario autenticado antes de evaluar la ACL** (patrón `%u`, no `%c`): el
  cliente ya no puede declarar el `client_id` que le convenga, porque se sustituye por el que
  demostró al autenticarse. Esa reescritura es la que sostiene la autorización, y es la razón de
  fondo por la que el usuario tiene que ser igual al `module_id` sin prefijo: si usuario y
  `client_id`/`module_id` no coincidieran letra a letra (como ocurría con el prefijo
  `module-{module_id}`), la ACL no tendría con qué comparar y volvería a autorizar por un
  identificador que el propio cliente elige.

  **F-02 (cerrado):** hasta esta corrección la ACL autorizaba por `client_id`, un valor que
  elige el propio cliente al conectar; unas credenciales cualesquiera de módulo bastaban para
  suplantar a cualquier otro con sólo declarar su `client_id`. Se confirmó en vivo en julio y se
  ha reproducido y falla como debe tras el fix. **No revertir el prefijo `module-`**: hacerlo
  reabre el agujero sin que se note, porque el síntoma (todo sigue conectando) no avisa de que
  la comparación usuario↔`client_id` ha dejado de ser 1:1.
- ACL de un módulo, enumerada tópico a tópico (no basta con `module/{su_id}/#`):

  | Tópico | Permiso |
  |---|---|
  | `targets/v1/module/{su_id}/presence` | escritura |
  | `targets/v1/module/{su_id}/status` | escritura |
  | `targets/v1/module/{su_id}/telemetry` | escritura |
  | `targets/v1/module/{su_id}/hit` | escritura |
  | `targets/v1/module/{su_id}/diagnostic` | escritura |
  | `targets/v1/module/{su_id}/config/reported` | escritura |
  | `targets/v1/module/{su_id}/command` | **sólo lectura** |
  | `targets/v1/module/{su_id}/maintenance/command` | **sólo lectura** |
  | `targets/v1/module/{su_id}/config/desired` | **sólo lectura** |
  | `targets/v1/module/{su_id}/ota` | **sólo lectura** |
  | `targets/v1/system/+/game/state` | sólo lectura |

- Un comodín de escritura sobre `module/{su_id}/#` sería **incorrecto**: permitiría a un
  módulo comprometido escribir su propio `config/desired` y auto-otorgarse configuración,
  o publicar en su canal `ota`. La escritura se concede tópico a tópico.
- El backend es el único con permiso de escritura sobre `system/#`, `…/config/desired`,
  `…/ota` **y, desde la ampliación v1.1, `module/+/maintenance/command`**. El coordinador
  puede escribir `module/+/command` y `system/…/game/*`.
- **El backend NO tiene, bajo ningún ACL, permiso de escritura sobre `module/+/command`.**
  Antes de esta ampliación el backend intentaba publicar ahí (F6) y el broker lo denegaba en
  silencio; la corrección no es concederle ese permiso —eso le habría dado autoridad sobre
  CUALQUIER orden de juego, porque el broker autoriza por tópico completo, no por contenido del
  payload— sino abrirle `module/+/maintenance/command`, un canal propio y más estrecho cuyo
  repertorio está cerrado por esquema a operaciones de mantenimiento (§2.1). Simétricamente, el
  coordinador no tiene, ni necesita, permiso de escritura sobre `module/+/maintenance/command`.
- Ver `infrastructure/mosquitto/acl` y `docs/security/threat-model.md`. La ACL real de
  `infrastructure/` queda fuera del territorio de este contrato y debe actualizarse por el
  carril correspondiente para reflejar esta tabla; este documento fija la autoridad, no la
  implementa.

## 9. Validación

```bash
make contracts-test    # valida todos los ejemplos contra sus esquemas
```

`contracts/examples/valid/**` debe validar; `contracts/examples/invalid/**` debe fallar,
y cada ejemplo inválido documenta en `_reason` qué regla viola.
