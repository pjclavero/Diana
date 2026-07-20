# Guía de recuperación de un módulo

Qué hacer cuando un módulo no arranca, no aparece en el backend o se comporta
de forma extraña. Ordenado de menos a más destructivo: **no salte pasos**, sobre
todo los que borran la NVS, porque eso pierde la calibración del módulo.

> Aviso: los procedimientos que tocan hardware **no se han ejecutado nunca**
> (ver `validacion-fisica-pendiente.md`). Están escritos a partir del diseño.

## 1. Diagnóstico sin tocar nada

### 1.1 ¿Qué dicen los LED?

| Lo que se ve | Significado probable |
|---|---|
| Todo apagado | sin alimentación, o firmware que no arranca |
| Rojo/blanco alternando en todas las dianas | módulo en estado `error` |
| Rojo/blanco parpadeo rápido en una diana | `sensor_error` en ese canal |
| Blanco tenue fijo | módulo en mantenimiento |
| Azul fijo en las 9 | estado `ready`, normal en reposo |

### 1.2 ¿Qué dice MQTT?

```bash
mosquitto_sub -h <broker> -u <usuario> -P <clave> -v \
  -t 'targets/v1/module/<module_id>/#'
```

- `presence` retenido con `online:false` y `reason:"lwt"` → el módulo se
  desconectó sin avisar: corte de red o de corriente, o cuelgue.
- `presence` con `reason:"shutdown"` → apagado ordenado. Es lo esperado tras un
  `reboot` por comando.
- No hay `presence` retenido → el módulo nunca ha llegado a conectar: nunca fue
  aprovisionado, o la credencial es incorrecta.
- `status.queue_depth` alto y creciendo → publica impactos pero no los confirma:
  problema de red o de ACL, no del módulo.

### 1.3 ¿Qué dice el puerto serie?

```bash
idf.py -p /dev/ttyUSB0 monitor
```

En cada arranque el firmware registra la causa del reinicio anterior
(`poweron`, `panic`, `watchdog`, `brownout`...). Esa línea es lo primero que hay
que leer:

- `brownout` repetido → problema de alimentación, no de firmware. Revisar la
  fuente y el condensador del bus de LED antes de tocar nada más.
- `watchdog` → una tarea se bloqueó. Hay volcado en la partición `coredump`.
- `panic` → excepción. También hay volcado.

## 2. Recuperar el volcado de fallo

```bash
idf.py coredump-info    # resumen
idf.py coredump-debug   # sesión gdb sobre el volcado
```

La partición `coredump` es de 256 KB y guarda el último fallo. **Extráigalo
antes de reflashear**: un flash lo sobrescribe.

## 3. Escalera de recuperación

### Nivel 1 — Reinicio remoto

```
targets/v1/module/<module_id>/command
{"schema_version":1,"command_id":"<uuid>","issued_at_ms":<ahora>,
 "expires_in_ms":5000,"nonce":<mayor que el último>,"issuer":"operator-cli",
 "module_id":"<module_id>","action":"reboot"}
```

El `nonce` **debe ser mayor** que el último aceptado de ese emisor, o el módulo
lo rechazará (protección de reenvío). Si no sabe cuál fue, consulte
`status.last_command` o use un valor claramente alto.

Conserva identidad, calibración y cola de eventos.

### Nivel 2 — Limpiar el estado de error

```json
{"...","action":"clear_error"}
```

Devuelve el módulo de `error` a `selftest`, que reintentará el arranque. Si el
autodiagnóstico vuelve a fallar, volverá a `error`: eso indica una avería real,
no un estado colgado.

### Nivel 3 — Vaciar la cola a mano

```json
{"...","action":"flush_queue"}
```

Fuerza el reenvío. Sólo tiene sentido si hay conexión: sin red no hace nada.

### Nivel 4 — Reflashear la aplicación

```bash
cd firmware/esp32
idf.py -p /dev/ttyUSB0 app-flash
```

`app-flash` escribe **sólo** la partición de aplicación: conserva NVS
(identidad, credenciales, calibración) y la cola. Es el reflasheo que hay que
usar por defecto.

### Nivel 5 — Rollback a la imagen anterior

Si el módulo arranca pero la versión nueva se comporta mal:

```json
{"...","action":"rollback"}   → topic targets/v1/module/<id>/ota
```

O, si no responde a MQTT, dejar que expire el plazo de confirmación (120 s): el
bootloader revierte solo, porque la imagen nueva no llegó a marcarse válida.

### Nivel 6 — Flash completo (DESTRUCTIVO)

```bash
idf.py -p /dev/ttyUSB0 flash
```

Reescribe bootloader, tabla de particiones y aplicación. **Borra la cola de
eventos pendientes.** La NVS sobrevive si la tabla de particiones no cambia.

### Nivel 7 — Borrado total (MUY DESTRUCTIVO)

```bash
idf.py -p /dev/ttyUSB0 erase-flash
```

**Pierde identidad, credenciales MQTT y toda la calibración.** El módulo queda
sin aprovisionar y hay que volver a calibrar las 9 dianas en banco
(`validacion-fisica-pendiente.md` §1). Use esto sólo si la NVS está corrupta.

Tras el borrado, el módulo arranca, detecta que no tiene `module_id` y se queda
en `error` con el registro `modulo SIN aprovisionar`. No inventa una identidad:
eso evita que dos módulos acaben con el mismo `module_id`.

## 4. Reaprovisionar un módulo

Tras un borrado total hay que escribir en NVS: `module_id`, `system_id`,
`serial`, `hw_rev`, `mqtt_user` y `mqtt_pass`.

> **Pendiente de implementar:** todavía no hay consola de aprovisionamiento.
> Está previsto que sea un comando por puerto serie. Hasta entonces, la
> alternativa es generar una partición NVS con `nvs_partition_gen.py` a partir
> de un CSV y flashearla en el offset de la partición `nvs`.

**Nunca** duplique el `module_id` entre módulos: la tupla
`(module_id, boot_id, local_sequence)` es la garantía de idempotencia de todo el
sistema (ADR-0003). Dos módulos con el mismo `module_id` producen impactos que
el backend deduplicará incorrectamente.

## 5. Qué NO hacer

- **No borre la NVS "por si acaso".** Pierde la calibración, que cuesta un banco
  de pruebas por módulo.
- **No reutilice un `nonce`.** El módulo rechazará el comando y parecerá que
  está colgado cuando no lo está.
- **No fuerce dos módulos a PRINCIPAL.** El sistema no permite empezar partida
  con dos coordinadores forzados (dosier §6.3), y el síntoma es confuso.
- **No dé por bueno un umbral que "parece que va".** Sin el procedimiento de
  calibración completo, un umbral que funciona en un golpe fuerte al centro
  fallará en el borde.
