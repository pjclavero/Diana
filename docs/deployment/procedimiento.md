# Despliegue de Diana en la VM 109 (procedimiento reproducible)

> Paquete WP-08. Máquina destino: `diana-server`, 192.168.1.209, VMID 109
> (Proxmox 192.168.1.10). Todo el stack corre en Docker Compose sobre
> `/opt/diana`.

Este documento describe el procedimiento **reproducible** de despliegue. Para
la operación cotidiana (copias, recuperación, reinicios) ver
[`../operations/operacion.md`](../operations/operacion.md).

## 0. Requisitos de la VM

- Docker Engine + plugin Compose (ver `infrastructure/provisioning/01-docker.sh`).
- Usuario `diana-admin` con `sudo NOPASSWD` y pertenencia al grupo `docker`.
- Repositorio clonado en `/opt/diana` (rama integrada: `develop`).
- Recursos: el dosier asume 4 vCPU / 4 GB. **La VM debe tener al menos 4 GB de
  RAM**; con menos, el `npm ci` de los builds y el stack completo no caben. Se
  añadió un swapfile de 2 GB como margen (ver operación).

## 1. Contrato de entorno (`.env`)

El `.env` NO se versiona (contiene secretos, permisos `0600`). Se genera a
partir de `.env.example` y se rellenan secretos reales:

```bash
cd /opt/diana
cp .env.example .env && chmod 600 .env
# Generar secretos fuertes:
#   POSTGRES_PASSWORD, BACKEND_JWT_SECRET  -> openssl rand -base64 32
#   Actualizar DATABASE_URL con la misma POSTGRES_PASSWORD
#   BACKEND_CORS_ORIGIN=http://192.168.1.209:8080  (origen real que sirve nginx)
```

Variables críticas verificadas contra el código del backend
(`server/backend/src/config/configuration.ts`):

| Variable en `.env` | Se mapea en compose a | La lee el backend como | Consecuencia si falta/mal |
|---|---|---|---|
| `BACKEND_JWT_SECRET` | `JWT_SECRET` | `JWT_SECRET` | El backend **aborta** el arranque en producción. |
| `BACKEND_CORS_ORIGIN` | `CORS_ORIGINS` | `CORS_ORIGINS` (plural) | El panel se queda sin CORS (`origin:false`). |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | idem | Prisma | Sin base de datos no arranca nada. |

> `SESSION_SECRET` NO lo lee el backend: era una variable muerta y se retiró
> del compose.

## 2. Credenciales de Mosquitto

Los usuarios MQTT (contraseñas) viven en `infrastructure/mosquitto/passwd`
(fichero binario de `mosquitto_passwd`, `0600`, ignorado por git). Se generan
una sola vez:

```bash
cd /opt/diana/infrastructure/mosquitto
./generate-users.sh backend        # actualizar MQTT_BACKEND_PASSWORD en .env
./generate-users.sh healthcheck    # actualizar MQTT_HEALTHCHECK_PASSWORD en .env
./generate-users.sh module-01 ... module-09   # un usuario por módulo físico
# Para las pruebas de ACL además: module-m1, module-m2
```

El `client_id` MQTT de cada módulo debe ser su `module_id` **sin** el prefijo
`module-` (la ACL usa el patrón `%c`).

## 3. Imágenes (multi-stage, usuario no root)

Cuatro imágenes de aplicación. `backend` y `worker` los aporta WP-08
(hallazgo F-13: antes faltaban sus Dockerfile y sólo se construían 2 de 4).

```bash
cd /opt/diana
docker compose build backend worker frontend
docker compose --profile simulator build device-simulator
```

Puntos clave de los Dockerfile (requisitos del encargo §20):

- **Multi-stage** (build + runtime), base `node:20.19-bookworm-slim` (versión
  fijada, nunca `latest`).
- Corren como usuario **no root** `diana` (verificable: `docker run --rm
  diana/backend:local id`).
- **Contexto de build = raíz del repo** para backend, worker y simulador:
  - el backend LEE `contracts/` en ejecución (`ContractValidator`),
  - el worker comparte `server/backend/prisma/schema.prisma`,
  - el simulador se autovalida contra `contracts/`.
  Un `.dockerignore` en la raíz evita meter `node_modules`, `.env` ni secretos.
- El runtime del backend incluye cliente Prisma + engines + CLI, de modo que
  `prisma migrate deploy` se ejecuta desde la propia imagen (servicio
  `migrate`).
- Healthchecks reales (ver §5).

## 4. Migración de base de datos (riesgo nº 1)

El SQL de `prisma/migrations` nunca se había aplicado contra una base viva. Se
levanta **sólo** postgres, se espera a que esté sano y se aplica la migración:

```bash
docker compose up -d postgres
# Esperar a healthy:
until [ "$(docker inspect -f '{{.State.Health.Status}}' $(docker compose ps -q postgres))" = healthy ]; do sleep 2; done
docker compose run --rm migrate          # npx prisma migrate deploy
```

Verificación de las restricciones (sólo lectura):

```bash
docker compose exec -T postgres psql "$DATABASE_URL" \
  -f - < server/database/sql/verify-constraints.sql
```
Deben existir los índices únicos `hit_events_event_id_key` y
`hit_events_module_slug_device_boot_id_local_sequence_key` (ADR-0003), las
cuatro marcas temporales en columnas `BIGINT`/`timestamptz` distintas
(ADR-0002) y 23 tablas de dominio.

## 5. Stack completo y healthchecks

```bash
docker compose up -d
docker compose ps        # todo debe figurar (healthy)
```

Healthchecks verificados contra el código real:

- **backend**: `GET /api/health` (prefijo global `/api`, no `/health`).
- **worker**: NO expone HTTP (es un bucle); healthcheck de proceso `pgrep`.
- **frontend**: nginx no privilegiado en el puerto **8080** (no 8081).
- **postgres**: `pg_isready`. **mosquitto**: `mosquitto_sub` con el usuario
  `healthcheck`. **proxy**: `/healthz`. **backup**: proceso del cron-loop vivo.

## 6. Verificación funcional

1. Pruebas de integración contra PostgreSQL real (idempotencia + modelo
   temporal). Ver operación.
2. `infrastructure/mosquitto/test-acl.sh` contra el Mosquitto real.
3. Simulador (`--profile simulator`) publicando eventos que llegan a
   PostgreSQL.

## 7. Orden resumido

```
.env + passwd  ->  build (4 imágenes)  ->  postgres up  ->  migrate  ->
verify-constraints  ->  up -d  ->  ps (healthy)  ->  tests integración  ->
test-acl  ->  simulador  ->  backup/restore aislado  ->  reboot
```
