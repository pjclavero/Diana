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

## 8. Incidencias reales del primer despliegue (2026-07-21) y su corrección

El stack **nunca había arrancado** antes de este despliegue. Se encontraron y
corrigieron cinco defectos reales que lo impedían; ninguno era de utillaje. Cada
uno está corregido en el repositorio (no a mano en la VM) y verificado ejecutando.

| # | Síntoma | Causa raíz | Corrección | Commit |
|---|---|---|---|---|
| 1 | `migrate`/backend: `P1001 Can't reach database server at postgres:5432` pese a postgres `healthy` | El `postgresql.conf` propio no declaraba `listen_addresses`; PostgreSQL usa el defecto `localhost` → sólo escuchaba en 127.0.0.1. El healthcheck local pasaba, pero ningún contenedor conectaba | `listen_addresses = '*'` en `infrastructure/postgres/postgresql.conf` | `c2f66e7` |
| 2 | mosquitto: `Unable to open pwfile` y bucle de reinicio | El fichero `passwd` estaba `0600` propiedad de `diana-admin` (uid 1000); mosquitto corre como uid 1883 y no podía leerlo | `passwd`/`acl`/`mosquitto.conf` a `644` (son hashes bcrypt en VM de sólo-admin; ver riesgo aceptado) | operación en VM |
| 3 | mosquitto: `Error: Address in use` en 1883, un solo proceso lo abría dos veces | `allow_anonymous`/`password_file`/`acl_file` antes del primer `listener` → mosquitto 2.0 crea un «listener por defecto» en 1883 que choca con `listener 1883` | Mover las opciones globales tras el primer `listener`; `socket_domain ipv4` | `df26569` |
| 4 | mosquitto `unhealthy` pese a estar operativo → backend/worker no arrancaban (`depend_on: healthy`) | El healthcheck hacía `mosquitto_sub -C 1 -W 3` esperando un mensaje que nadie publica: `Timed out` siempre | Cambiar a `mosquitto_pub` (prueba broker + auth + ACL de escritura) | `dcb2f54` |
| 5 | Toda la API por el proxy daba `404 Cannot GET /health` | nginx `proxy_pass http://backend:3000/;` (barra final) descartaba el prefijo global `api`; el backend recibía `/health` en vez de `/api/health` | `proxy_pass http://backend:3000;` (URI completo) en `/api/` y `/api/auth/` | `2779b2c` |

**Estado tras las correcciones (evidencia ejecutada, 2026-07-21):**

```
$ docker compose ps --format '{{.Service}}: {{.Status}}'
backend: Up (healthy)      mosquitto: Up (healthy)    proxy: Up (healthy)
worker: Up (healthy)       postgres: Up (healthy)     frontend: Up (healthy)
backup: Up (healthy)

$ curl -s http://127.0.0.1:8080/api/health          -> {"status":"ok"} [200]
$ curl -s -X POST http://127.0.0.1:8080/api/auth/login -d '{}' -> [400]  (valida, no 404)
$ docker compose run --rm migrate                    -> "All migrations have been successfully applied" (20260720120000_init)
$ verify-constraints.sql                             -> 24 tablas; 4 marcas en BIGINT; timestamptz; precisión anulable
```

**Incidencia de redespliegue (F2, 2026-07-21):** tras reconstruir una imagen,
`docker compose up -d <svc>` puede **no recrear** el contenedor y dejar el código
viejo corriendo (se observó con `backend`: `/modules/mine` daba 500 por caer en el
`/:id` del CRUD, síntoma de imagen antigua). Solución fiable: `docker compose up -d
--force-recreate <svc>` tras `docker compose build`. Verificar siempre con un endpoint
NUEVO de la entrega, no sólo con el healthcheck.

**El one-shot `migrate` bloquea el arranque en `up -d` (recurrente, 2026-07-22):**
`docker compose up -d` reintenta el job `migrate` (ya ejecutado) y a veces sale exit 1,
abortando el arranque del `backend` (depende de `migrate: service_completed_successfully`)
→ 502. La migración SÍ se aplica aparte. **Remedio:** `docker compose run --rm --no-deps
-T backend npx prisma migrate deploy` y luego `docker compose up -d --no-deps backend
frontend mosquitto worker backup postgres-test` (salta la dependencia de migrate).

**Datos de referencia sin sembrar (G-F, 2026-07-22):** el despliegue no ejecutaba
`seed:reference`, así que la tabla `game_modes` estaba **vacía** — lo que rompe la
creación de partidas y de presets (el modo se resuelve por clave contra BD). En la
imagen de producción **no hay `ts-node`** (devDependency), así que `npm run
seed:reference` falla; hay que ejecutar el **seed compilado**:
`docker compose run --rm --no-deps -T backend node dist/scripts/seed-reference.js`
(asegura roles + los 4 modos random/sequence/all_against_clock/reaction). Debe correr
tras `migrate deploy` en cada entorno nuevo.

**Builds que dejan `dist` viejo = BuildKit se queda SIN MEMORIA (G-C/G-F, 2026-07-22):**
se observó repetidamente que `docker compose build backend` "terminaba" pero el `dist/`
seguía sin el cambio (rutas/campos nuevos → 500), y `--no-cache` fallaba con
`frontend grpc server closed unexpectedly` / `no such job`. **Causa raíz real:** la VM
tiene ~1 GB de RAM efectiva (balloon), y con los 8 contenedores en marcha + el build,
**BuildKit muere por OOM a mitad de compilar y deja la imagen anterior** — NO es un
problema de caché. **Procedimiento fiable para reconstruir el backend en esta VM:**
1. Liberar RAM parando lo no esencial: `docker compose stop worker backup postgres-test mosquitto frontend backend` (deja `postgres` + `proxy`).
2. `docker compose build backend` (build normal; con RAM libre compila entero).
3. Verificar el artefacto: `docker compose run --rm --no-deps -T backend sh -c "grep -c <símbolo-nuevo> dist/<ruta>.js"` (>0).
4. `docker compose up -d` (levanta todo y recrea backend con la imagen nueva).
5. Verificar con un endpoint NUEVO, no sólo el healthcheck.

**Queda pendiente (no bloqueante del arranque):** el enrutado WebSocket
(`location /ws/` vs el namespace socket.io `/live` del backend) no está resuelto
porque el contrato WS panel↔backend no está negociado (X-06); la vista en directo
por WS aún no es alcanzable por el proxy. El REST completo sí lo es.

**Incidencia de DNS de la VM (2026-07-26, PREEXISTENTE, no causada por el despliegue):**
la VM tenía como ÚNICO resolver el MagicDNS de Tailscale (`100.100.100.100`), que
respondía `server misbehaving`. Consecuencia: `git`, `docker pull` y `npm ci` fallaban
todos con «Could not resolve host» / «lookup registry-1.docker.io … server misbehaving»,
y **cualquier build o actualización estaba bloqueada**. El resolver del router
(192.168.1.1) sí funciona; `1.1.1.1` está bloqueado desde la VM.
Procedimiento usado para desplegar sin tocar la red de forma permanente:
1. Llevar el código con un **bundle de git por SSH** (no `git pull`):
   `git bundle create x.bundle <base>..develop` → `scp` → en la VM
   `git fetch /tmp/x.bundle develop:refs/remotes/bundle/develop && git merge --ff-only`.
2. Para el build (necesita npm), override **temporal** de `/etc/resolv.conf` apuntando al
   router, con copia previa en `/etc/resolv.conf.prediana-deploy`, y **restaurarlo al
   terminar** (comprobado: vuelve a `100.100.100.100` + `search …ts.net`).
**Causa de fondo SIN resolver:** MagicDNS de la tailnet. Se arregla con
`tailscale set --accept-dns=false` (la VM usaría el DNS del router) o revisando los
nameservers de la tailnet. Es un cambio persistente: requiere decisión del operador.

**Nota sobre `pgrep -f` en esperas por SSH:** un `until ! pgrep -f 'docker compose build'`
lanzado por SSH **se detecta a sí mismo** (el patrón aparece en su propia línea de
comando) y no termina nunca. Usar un patrón que no coincida con el propio comando.

## 9. Verificación funcional ejecutada (2026-07-21)

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Migración contra base viva | ✅ | `prisma migrate deploy` → «All migrations have been successfully applied» (`20260720120000_init`) |
| Restricciones de la BD | ✅ | `verify-constraints.sql`: 24 tablas, 4 marcas en `BIGINT`, `timestamptz`, precisión anulable |
| **Tests de integración contra PostgreSQL real** | ✅ **5/5** | idempotencia garantizada por la BASE (índice único + tupla, incluso concurrente) y microsegundos en `BigInt`. Reproducido dos veces |
| Stack completo healthy | ✅ **7/7** | backend, worker, mosquitto, postgres, frontend, proxy, backup |
| API REST por el proxy | ✅ | `/api/health`→`{"status":"ok"}`, `/api/auth/login`→400 (valida) |
| ACL de Mosquitto (`test-acl.sh`) | 🟡 5/7 | Las 4 denegaciones críticas (aislamiento entre módulos, no auto-escribir `config`/`command`/`ota`) **pasan**. Los 2 «FAIL» son falsos negativos del arnés (carrera sub/pub), verificado a mano |
| **F-02 (suplantación por client_id)** | 🔴 **CONFIRMADO EN VIVO** | credenciales de m1 + `client_id=m2` publican en el tópico de m2 y el backend lo recibe. Mitigación = decisión de contrato (ver `docs/security/findings.md`) |
| Simulador → broker real | ✅ conecta y completa escenario | escenario 02 «partida completa» ejecutado; una credencial de módulo vale por la ACL-por-`client_id` |
| Simulador → backend → **PostgreSQL** (ingesta e2e) | 🔴 **NO verificado** | tras el escenario, `hit_events = 0` y sin logs de ingesta en el backend (conectado a MQTT). El backend se suscribe (`BACKEND_SUBSCRIPTIONS`) pero no persistió: probablemente el escenario aislado no dispara la orquestación de partida que genera impactos persistibles. **Requiere investigación de WP-02/WP-05** (X-18) |

**Pendiente de despliegue, no ejecutado aún:** copia de seguridad + restauración en
base aislada, y `reboot` de la VM verificando que el stack vuelve solo (`onboot` +
`restart`).
