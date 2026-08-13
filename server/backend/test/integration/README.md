# Pruebas de integración de WP-02

Estas pruebas necesitan **PostgreSQL real** y, algunas, **Mosquitto real**. En el
entorno donde se desarrolló WP-02 no hay demonio Docker, ni `sudo`, ni un
PostgreSQL local, de modo que **no se han ejecutado**: se entregan preparadas
para que WP-08 / WP-11 las corran en la VM 109.

No se marcan como superadas por omisión: si falta `DATABASE_URL` se **saltan**
(`describe.skip`) y Jest lo indica explícitamente en la salida. Un salto no es
un aprobado.

## Cómo ejecutarlas

```bash
# 1. Base de datos disponible (compose de WP-01 o PostgreSQL local)
export DATABASE_URL="postgresql://diana:<clave>@localhost:5432/diana_test"

# 2. Esquema aplicado
cd server/backend
npm run prisma:migrate          # prisma migrate deploy

# 3. Pruebas
npm run test:integration
```

Para las que además tocan MQTT:

```bash
# TEST AISLADO (P0-2): broker efímero local, nunca el de producción.
export MQTT_URL="mqtt://localhost:1883"
export MQTT_USERNAME=... MQTT_PASSWORD=...
export DIANA_TEST_MQTT=1
```

## Qué cubren

| Fichero | Comprueba |
|---|---|
| `idempotency.integration.spec.ts` | Que la idempotencia la garantiza **la base de datos** (índice único sobre `event_id` y restricción `(module_slug, boot_id, local_sequence)`), incluso con inserciones concurrentes. Es lo que la prueba unitaria con repositorio en memoria **no** puede demostrar. |
| `temporal.integration.spec.ts` | Que `device_*`, `coordinator_*`, `received_at` y `persisted_at` sobreviven al viaje de ida y vuelta a PostgreSQL sin perder precisión (BigInt de microsegundos) ni ser reescritos. |

## Advertencia

La base de datos indicada en `DATABASE_URL` se **vacía parcialmente** durante
las pruebas (tabla `hit_events` y auxiliares). Use una base de datos de pruebas
dedicada, nunca la de producción.
