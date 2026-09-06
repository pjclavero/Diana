# E2E-2 · OFFLINE / RECOVERY

`módulo online → desconecta → estado offline/stale → reconecta → recuperación`

Escenario ejecutable contra **PostgreSQL real, Mosquitto real y el backend
real** (la misma imagen que construye `server/backend/Dockerfile` para
producción). Lo único simulado es el firmware: los módulos son clientes MQTT
del arnés, que es exactamente lo que el contrato permite simular.

Este directorio es autónomo: su propio `compose`, su propio broker, su propio
alta de módulos y su propio arnés. No toca ni depende de
`tests/e2e/scenarios.spec.ts`.

## Orden exacto reproducible

```bash
# Desde la raíz del repositorio.
./tests/e2e/offline/run.sh              # escenario normal → debe quedar VERDE
./tests/e2e/offline/run.sh --calibrate  # idempotencia rota → EXIGE que se ponga ROJO
./tests/e2e/offline/run.sh --keep       # deja el stack en pie para inspeccionar
```

`run.sh` levanta el stack, espera a que `/api/health/ready` declare **de verdad**
`database:true` y `mqtt:true` (efecto, no `rc`), aplica `seed.sql` y lanza
`offline-recovery.test.mjs`. Al terminar derriba todo con `down -v`.

Puertos del anfitrión (altos a propósito, para no chocar con nada):
Postgres `15433`, Mosquitto `11883`, backend `13000`.

## Qué se mide, y por qué efecto

| Obs. | Qué se afirma | Efecto observable que lo demuestra |
|---|---|---|
| **O-0** | La idempotencia vive donde ADR-0003 dice | `pg_indexes`: existen `hit_events_event_id_key` y `hit_events_module_slug_device_boot_id_local_sequence_key` |
| **O-1** | **Control positivo**: el camino feliz produce efecto | `modules.online=true` + `boot_id` persistido, **una** fila en `hit_events`, `IngestService.accepted` sube |
| **O-2** | El Last Will es real y llega a los dos lados | (a) un observador MQTT recibe el LWT con `online=false`, `reason=lwt`, QoS 1 tras matar el socket **sin DISCONNECT**; (b) `modules.online=false`, `offline_since` fijado, `last_seen_at` **sin avanzar** (D6), incidencia `module_offline` |
| **O-3** | La presencia retenida es la última fotografía | un suscriptor **nuevo**, conectado después, recibe el mensaje con `retain=true` y `reason=lwt` |
| **O-4** | Caída por **silencio**, sin ningún LWT | con un testigo vivo mandando telemetría, el barrido declara caído al callado: `online=false`, `offline_since`, incidencia `module_stale`, y el **testigo sigue en línea** (si cayera, lo medido sería un apagón) |
| **O-5** | **La recuperación no duplica efecto** | ver abajo |

### La no-duplicación (O-5), en detalle

Es la propiedad central del escenario y se demuestra con **contadores y filas**,
nunca con el retorno de `publish`:

- El mismo `event_id` se reenvía **tres veces** marcado `replay:true` → sigue
  habiendo **1 fila**, y `IngestService.duplicates` sube exactamente en 3.
- Un `event_id` **nuevo** con el mismo `(module_slug, boot_id, local_sequence)`
  → **0 filas**: se ejerce el segundo camino de deduplicación del contrato §5,
  el que cubre a un firmware que regenera identificadores al reconectar.
- Un impacto **realmente nuevo** de la ventana de caída → **1 fila**. Sin esta
  aserción, un backend que descartara todo pasaría la prueba.
- Balance: la recuperación entera añade **una sola** fila.

## Calibración

`--calibrate` retira los dos índices únicos de `hit_events` — que es donde
`PrismaHitRepository` deposita la idempotencia (interpreta la violación `P2002`
como duplicado, ADR-0003) — y **verifica la mutación con un `grep` sobre el
esquema vivo antes de medir nada**. Después ejecuta el escenario **sin decirle
que algo ha cambiado** y exige que se ponga **ROJO por el motivo correcto**: la
aserción «El reenvío duplicó el impacto». Un rojo por otro motivo se declara
`CALIBRACIÓN DUDOSA`, no éxito.

## Frontera declarada

- **NO atraviesa `infrastructure/mosquitto/set-coordinator.sh`** ni la ACL de
  producción. El broker de este directorio (`mosquitto.offline.conf`) es
  anónimo y sin ACL a propósito: aquí se mide el ciclo de caída y recuperación,
  no la autorización (eso es `infrastructure/mosquitto/test-acl*.sh`). Por
  tanto este escenario **no puede reproducir la decisión D6** (ACL a 0600 →
  broker `Exited (13)`).
- Tampoco toca hardware físico, producción ni la VM109. Todo es efímero:
  `tmpfs` en Postgres, `persistence false` en el broker, `down -v` al salir.
