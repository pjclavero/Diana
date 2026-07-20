# Contratos MQTT · Diana v1

**Estado:** CONGELADO para la Ola 1 (`v1`).
**Cambios:** cualquier modificación incompatible exige un `v2` y un ADR. Los cambios compatibles (añadir campos opcionales) suben `schema_version` sólo si alteran la semántica.

Fuente normativa: `dosier_tecnico_matriz_dianas_modulares.md`, secciones 12, 14, 15 y 17.

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
| `module/…/command` | backend/principal | módulo | 1 | no | `module-command.schema.json` |
| `module/…/hit` | módulo | principal, backend | 1 | no | `hit-event.schema.json` |
| `module/…/diagnostic` | módulo | backend | 1 | no | `module-diagnostic.schema.json` |
| `module/…/ota` | backend | módulo | 1 | no | `ota-command.schema.json` |

**Retenidos:** sólo estado observable (`presence`, `status`, `config/*`, `game/state`, `system/status`).
Los eventos (`hit`, `game/event`, `diagnostic`) **nunca** se retienen: un retenido reproduciría impactos al reconectar.

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
- `nonce` monotónico por emisor.

Un módulo **descarta** un comando si:

1. `command_id` ya fue ejecutado (caché de los últimos 128), o
2. `nonce` ≤ último nonce aceptado de ese emisor (protección de reenvío, dosier §23.3), o
3. han pasado más de `expires_in_ms` desde la recepción del canal.

El resultado se reporta en `module/…/status` con `last_command`.

## 7. Compatibilidad

- `schema_version` es un entero. Un receptor **rechaza** `schema_version` mayor que el que soporta y lo registra como `incident`.
- Campos desconocidos: `additionalProperties: false` en los esquemas de este directorio. Los productores no deben añadir campos sin bump de versión.
- El namespace `v1` del tópico cambia sólo con ruptura estructural del árbol de tópicos.

## 8. Seguridad

- Mosquitto sin acceso anónimo. Un usuario por módulo (`module-{module_id}`).
- El `client_id` MQTT de un módulo **debe ser igual a su `module_id`**, sin prefijo. La ACL
  se apoya en esa igualdad (patrón `%c`) para acotar cada módulo a su propio subárbol.
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
  | `targets/v1/module/{su_id}/config/desired` | **sólo lectura** |
  | `targets/v1/module/{su_id}/ota` | **sólo lectura** |
  | `targets/v1/system/+/game/state` | sólo lectura |

- Un comodín de escritura sobre `module/{su_id}/#` sería **incorrecto**: permitiría a un
  módulo comprometido escribir su propio `config/desired` y auto-otorgarse configuración,
  o publicar en su canal `ota`. La escritura se concede tópico a tópico.
- El backend es el único con permiso de escritura sobre `system/#`, `…/config/desired`
  y `…/ota`. El coordinador puede escribir `module/+/command` y `system/…/game/*`.
- Ver `infrastructure/mosquitto/acl` y `docs/security/threat-model.md`.

## 9. Validación

```bash
make contracts-test    # valida todos los ejemplos contra sus esquemas
```

`contracts/examples/valid/**` debe validar; `contracts/examples/invalid/**` debe fallar,
y cada ejemplo inválido documenta en `_reason` qué regla viola.
