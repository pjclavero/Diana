# ADR-0003 · Idempotencia de eventos

**Estado:** aceptado · 2026-07-20

## Contexto

MQTT QoS 1 es *at-least-once*: los duplicados son parte normal del protocolo, no una
anomalía. Además un módulo que pierde la conexión reenvía su cola local. El dosier §14.4
exige que nada de esto genere impactos duplicados.

## Decisión

- `event_id` (UUIDv4 o ULID) lo genera **el módulo que detecta**, no el coordinador ni el
  backend, y es estable entre reintentos.
- `local_sequence` es un contador monotónico por módulo persistido en NVS.
- `boot_id` es un UUID nuevo en cada arranque.
- La tupla `(module_id, boot_id, local_sequence)` es única; en base de datos se refuerza
  con una restricción, además del índice único sobre `event_id`.
- Coordinador y backend deduplican por `event_id`. Un duplicado se cuenta como métrica,
  no como error.
- `replay: true` marca lo que sale de la cola tras una desconexión. **No** implica duplicado.

## Motivo del `boot_id`

`local_sequence` por sí sola no distingue un reinicio de un reflasheo: tras borrar la NVS
el contador vuelve a empezar y colisionaría con eventos históricos del mismo módulo.

## Consecuencias

- El backend debe aceptar eventos desordenados y muy retrasados, y ordenarlos por T1.
- La deduplicación necesita ventana de retención; se fija por partida y se apoya en el
  índice único, no sólo en una caché en memoria.
