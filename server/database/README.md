# Base de datos de Diana

PostgreSQL, esquema gestionado con **Prisma** y migraciones versionadas.

## Dónde vive qué

| Artefacto | Ruta |
|---|---|
| Esquema (fuente de verdad) | `server/backend/prisma/schema.prisma` |
| Migraciones versionadas | `server/backend/prisma/migrations/` |
| Cliente generado | `server/backend/node_modules/.prisma/client` |
| Utilidades de operación | `server/database/sql/` |

El esquema vive junto al backend porque el CLI de Prisma exige tenerlo dentro
del proyecto que declara sus dependencias; moverlo fuera hacía que `prisma
generate` creara un `package.json` espurio en `server/`. La propiedad de ambas
rutas es de WP-02, así que la decisión no cruza fronteras de paquete.

## Aplicar el esquema

```bash
cd server/backend
export DATABASE_URL="postgresql://diana:<clave>@localhost:5432/diana"
npm run prisma:generate    # cliente TypeScript
npm run prisma:migrate     # prisma migrate deploy (producción)
npm run seed:reference     # roles y modos de juego. Sin credenciales.
```

`npm run seed:dev` añade datos de **desarrollo** (prefijo `DEV-`). Se niega a
ejecutarse con `NODE_ENV=production` salvo `--force`.

## Las 23 entidades del dosier 21.1

`users`, `roles`, `players`, `teams`, `target_systems`, `modules`,
`module_positions`, `targets`, `sensor_calibrations`, `game_modes`,
`game_presets`, `games`, `rounds`, `participants`, `hit_events`, `shot_counts`,
`penalties`, `results`, `statistics`, `firmware_versions`, `deployments`,
`incidents`, `audit_log`.

La migración inicial crea exactamente 23 tablas.

## Decisiones que conviene conocer antes de tocar nada

### Tiempos en microsegundos y separados (ADR-0002)

`hit_events` guarda **cuatro** marcas en columnas distintas:

| Marca | Columnas | Propietario |
|---|---|---|
| T1 captura | `device_boot_id`, `device_uptime_us`, `device_event_us`, `device_epoch_ms` | ESP32 |
| T2 consolidación | `coordinator_recv_us`, `coordinator_elapsed_us`, `clock_offset_us`, `offset_uncertainty_us` | módulo principal |
| T3 recepción | `received_at` | backend |
| T4 persistencia | `persisted_at` | backend |

Los microsegundos son `BIGINT`: un `double` de JavaScript perdería precisión a
partir de 2^53 µs. En la API se serializan como **cadena**.

El backend **no reescribe** T1 ni T2. Si un evento llega tarde se marca con
`out_of_window` + `out_of_window_reason`. No hay ningún `UPDATE` sobre las
columnas de T1/T2 en el código.

### Idempotencia (ADR-0003)

Dos restricciones, no una:

```sql
CREATE UNIQUE INDEX hit_events_event_id_key ON hit_events(event_id);
CREATE UNIQUE INDEX hit_events_module_slug_device_boot_id_local_sequence_key
  ON hit_events(module_slug, device_boot_id, local_sequence);
```

La segunda cubre el caso de un evento reetiquetado con otro `event_id`. La
deduplicación se apoya en la base de datos, no en una caché de proceso: con dos
instancias de backend o tras un reinicio, la caché no serviría.

### Precisión no calculable (ADR-0006)

`shot_counts` y `results` guardan por separado munición inicial, restante,
disparos realizados, impactos detectados, válidos e incorrectos.
`shots_fired`, `accuracy_total` y `accuracy_valid` son **anulables** y quedan a
`NULL` con `accuracy_status = 'not_computable'` cuando la munición restante es
desconocida. Rellenarlos con la munición inicial sería inventar disparos.

### Índices para las consultas del dosier 21.2

- Por jugador: `participants(player_id)`, `results(participant_id, computed_at)`,
  `statistics(player_id, metric)`.
- Por partida: `games(target_system_id, created_at)`, `rounds(game_id)`,
  `hit_events(game_id, classification)`, `hit_events(round_id, device_event_us)`.
- Por fecha: `games(created_at)`, `hit_events(received_at)`,
  `audit_log(created_at)`, `incidents(occurred_at)`.

`hit_events(round_id, device_event_us)` es el índice de la consulta más
frecuente: los impactos de una ronda ordenados por T1.

### Zonas horarias

Todas las columnas de fecha son `timestamptz` y se guardan en UTC. La
conversión a hora local es responsabilidad del panel.

### Retención y copias

La retención la aplica el **worker** (`server/worker/`), no la base de datos.
Salvaguarda deliberada: nunca se purgan impactos de una ronda que no tenga sus
resultados ya calculados, porque los derivados deben poder reproducirse desde
los eventos (dosier 21.2).

Las copias (diaria, previa a actualización, retención semanal y mensual,
cifrado) son responsabilidad de WP-01/WP-08; aquí sólo se deja constancia del
requisito del dosier 21.3.
