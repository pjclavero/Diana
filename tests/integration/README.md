# Integración

Este directorio documenta el andamiaje de integración que orquesta
`.github/workflows/integration.yml`. Las **pruebas** de integración de verdad
viven junto al código que ejercitan (no se duplican aquí):

- **Backend + PostgreSQL + Mosquitto:** `server/backend/test/integration/`
  (idempotencia por constraint — ADR-0003 — y autoridad temporal T1/T2). Se
  ejecutan con `npm run test:integration` y **se saltan solas** si no hay
  `DATABASE_URL`; un salto no es un aprobado. `integration.yml` sí define
  `DATABASE_URL`, así que allí se ejecutan de verdad.
- **ACL de Mosquitto (I-04/I-05):** `infrastructure/mosquitto/test-acl.sh`
  (propiedad de WP-01/WP-08).
- **Propiedad de tópicos (H-01):** `simulators/test/h01-topic-ownership.test.ts`.

## Qué hace `integration.yml`

1. Levanta `postgres:16.4-alpine` como servicio con healthcheck `pg_isready`.
2. Arranca `eclipse-mosquitto:2.0.18` con `mosquitto.test.conf` del repositorio.
3. `npx prisma generate` + `prisma migrate deploy` sobre la base real.
4. `npm run test:integration` en `server/backend`.

## Estado (verificado el 2026-07-21)

- Sin `DATABASE_URL`, en el entorno de desarrollo, `npm test` del backend da
  **157 pasados y 5 saltados** (los 5 saltados son las 2 suites de integración).
  Comprobado ejecutándolo de verdad.
- La ejecución CON base de datos **no se ha podido correr aquí**: el entorno de
  desarrollo no tiene demonio Docker ni PostgreSQL local. Sólo se ejecutará por
  primera vez cuando corra `integration.yml` (o en la VM 109, WP-08/WP-11).
