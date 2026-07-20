# Arquitectura del firmware Diana

**Estado:** WP-04, primera entrega. Lógica probada en host; capa de hardware sin
compilar ni verificar.

## 1. Principio rector

El firmware está partido en dos mitades con una frontera dura:

```
┌───────────────────────────────────────────────┐
│ main/          aplicación, tareas FreeRTOS    │  sin compilar
├───────────────────────────────────────────────┤
│ diana_platform_esp   W5500 · MQTT · NVS ·     │  sin compilar
│                      piezo · LED · OTA        │
├───────────────────────────────────────────────┤
│ diana_hal            INTERFAZ (solo .h)       │  ← frontera
├───────────────────────────────────────────────┤
│ diana_core           lógica de negocio pura   │  PROBADA en host
└───────────────────────────────────────────────┘
```

`diana_core` no incluye ninguna cabecera de ESP-IDF. Es C11 portable. Todo lo
que necesita del mundo exterior lo recibe a través de una tabla de punteros a
función (`diana_hal`), que tiene dos implementaciones:

- `diana_platform_esp` — la real, sobre ESP-IDF v5.x.
- `test_host/hal_host.c` — simulación en PC: reloj virtual, RNG determinista,
  NVS en memoria que sobrevive a un "reinicio" simulado, cola FIFO con capacidad
  configurable y un broker MQTT falso que registra lo publicado.

Esto no es purismo: es lo que permite que la parte delicada del paquete (tiempo,
idempotencia, cola, OTA) tenga evidencia de ejecución real sin hardware.

## 2. Módulos de `diana_core`

| Fichero | Responsabilidad |
|---|---|
| `types.c` | enumerados del contrato y sus cadenas exactas |
| `json.c` | emisor JSON sin `malloc`, con detección de desbordamiento |
| `ids.c` | UUIDv4, ULID y validadores de los patrones del contrato |
| `identity.c` | identidad en NVS, `boot_id`, reserva de `local_sequence` |
| `config.c` | configuración y calibración, monotonía de `config_version` |
| `module_fsm.c` | máquina de estados del módulo (dosier 13.3) |
| `target_fsm.c` | máquina de estados de cada diana (dosier 13.4) |
| `sensors.c` | antirrebote, blanking, agrupación y crosstalk (dosier 9.6) |
| `event.c` | construcción y serialización de `hit-event` |
| `queue.c` | cola persistente, replay, política de cola llena, dedup |
| `command.c` | caducidad, `command_id` repetido, nonce monotónico |
| `led.c` | estado → color + patrón, presupuesto de potencia |
| `sha256.c` | SHA-256 portable para verificar la imagen OTA |
| `ota.c` | orden de comprobaciones OTA, rollback |
| `messages.c` | tópicos, QoS/retain, presencia, estado, telemetría, diagnóstico |

## 3. Tareas (dosier 13.2)

| Tarea | Núcleo | Prioridad | Periodo |
|---|---:|---:|---|
| `diana_sens` | 1 | 10 | dirigida por eventos, cierre de ventana cada 2 ms |
| `diana_led` | 1 | 4 | 20 ms (50 fps) |
| `diana_net` | 0 | 6 | dirigida por eventos |
| `diana_tlm` | 0 | 3 | `telemetry_interval_ms`, 1 s por defecto |

Los sensores y los LED van al núcleo 1, aislados del tráfico de red, para que
una tormenta MQTT no retrase la atención de un impacto. Todas las tareas se
registran en el watchdog de tarea.

## 4. Camino de un impacto

```
comparador → ISR (IRAM)                 registra (canal, esp_timer_get_time())
           → cola de la ISR              lo mínimo posible dentro de la ISR
           → tarea de sensores
              ├── lee amplitud por multiplexor (ADC)
              ├── diana_sensor_admit()   antirrebote + blanking + canal activo
              ├── agrupa dentro de group_window_us
              ├── diana_sensor_classify()canal principal + crosstalk
              ├── consulta target_fsm    clasifica según el estado de la diana
              ├── diana_hit_event_build()event_id, local_sequence, boot_id, device
              ├── diana_hit_event_check()invariantes del contrato
              └── publica  ── si hay red ──→ MQTT QoS 1, retain=false
                          └─ si no ───────→ cola persistente (replay al volver)
```

El `t_us` que acaba en `device.event_us` es el de la **interrupción**, no el del
momento en que la tarea llega a procesarlo. Es T1 del ADR-0002.

## 5. Modelo temporal (ADR-0002)

El firmware sólo es dueño de T1. Concretamente:

- Rellena `device.boot_id`, `device.uptime_us` y `device.event_us`.
- `device.epoch_ms` sólo si hay hora sincronizada; es informativo y **nunca**
  sustituye a `event_us`.
- Un satélite publica siempre `coordinator: null`. El bloque `coordinator` (T2)
  lo rellena el módulo principal al consolidar.
- El firmware no conoce ni puede escribir `received_at` ni `persisted_at`: no
  existen en su código. Hay una prueba que comprueba que no aparecen en el
  payload.

## 6. Idempotencia (ADR-0003)

- `event_id`: UUIDv4 generado en el módulo que detecta, estable entre reintentos.
- `local_sequence`: monotónica, persistida en NVS **por bloques reservados**. Al
  arrancar se reserva un bloque de 64 y se persiste la nueva frontera. Un corte
  de corriente puede saltar hasta 64 números, pero jamás repetirlos.
- `boot_id`: UUIDv4 nuevo en cada arranque, así que la tupla
  `(module_id, boot_id, local_sequence)` sigue siendo única incluso tras borrar
  la NVS.
- El módulo mantiene además una caché de 64 `event_id` para no encolar dos veces
  el mismo evento.

## 7. Cola persistente

- **En host:** anillo en memoria sobre la estructura `host_persistent`, que
  sobrevive al reinicio simulado.
- **En ESP32:** partición `evtqueue` de 1,5 MB, anillo de ranuras fijas de 1 KB
  con cabecera (magia + secuencia + longitud + CRC32). Se escribe primero el
  payload y después la cabecera: un corte a mitad deja una ranura sin magia
  válida que se ignora al reconstruir, en vez de corromper la cola.
- Se almacena la **estructura** del evento, no su JSON, para poder marcar
  `replay=true` al reenviar sin tocar el `event_id`.
- Política de cola llena configurable: `DROP_OLDEST` (por defecto) o
  `REJECT_NEW`. En ambos casos se emite un diagnóstico `queue_overflow`.

## 8. Seguridad

- Credenciales MQTT en NVS cifrada (`CONFIG_NVS_ENCRYPTION`), nunca publicadas
  ni registradas. Hay una prueba que comprueba que la contraseña no aparece en
  el payload de presencia.
- Comandos: caducidad, `command_id` repetido (caché de 128) y nonce monotónico
  por emisor. Un comando dirigido a otro `module_id` se rechaza.
- `schema_version` superior a la soportada se rechaza y se registra.
- OTA: firma verificada por el propio ESP-IDF antes de activar; el firmware no
  reimplementa criptografía. Sin verificador disponible, **se rechaza**.

## 9. Lo que esta arquitectura NO resuelve todavía

- La descarga de la imagen OTA contra `esp_https_ota` está sin implementar; sólo
  está la lógica de decisión.
- La aplicación completa de `config/desired` (más allá de `config_version`) está
  a medias.
- La elección de coordinador en modo AUTO no está implementada: el selector se
  lee y se reporta, pero la negociación es de otro paquete.
- No hay sincronización de reloj entre módulos (`clock_offset_us` se transporta,
  pero nadie lo calcula todavía).
