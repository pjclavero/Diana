# Infraestructura Docker de Diana (WP-01)

Stack de servidor de Diana (sistema modular de dianas electrónicas 3×3,
ESP32-S3 + MQTT). Ver ADR `docs/adr/0001-stack-servidor.md` y el contrato
MQTT congelado en `contracts/mqtt/README.md`.

## Estado de las dependencias de otros paquetes

`compose.yml` referencia estos contextos de build, que hoy están **vacíos**
porque los rellenan otros paquetes en paralelo:

| Contexto | Paquete responsable |
|---|---|
| `server/backend` | WP-02 (Backend) |
| `server/frontend` | WP-03 (Frontend) |
| `server/worker` | WP-02 (Backend) |
| `simulators/target-module` | WP-05 (Simulador) |

`docker compose config` no necesita que existan (sólo valida sintaxis e
interpolación de variables). `docker compose build`/`up` sí los necesitará;
eso lo ejecuta WP-08 en la VM de destino una vez todos los paquetes
converjan. Los healthchecks de `backend`, `frontend` y `worker` **asumen**
un endpoint `/health` (convención habitual NestJS/Vite); si esos equipos
usan otra ruta o puerto, hay que ajustar el `healthcheck.test` del servicio
correspondiente en `compose.yml`.

## Servicios

| Servicio | Función | Red | Puerto en host |
|---|---|---|---|
| `proxy` | nginx, entrada HTTP/HTTPS | edge | `PROXY_HTTP_PORT` (8080) |
| `frontend` | Panel web (React+Vite) | edge | — (sólo vía proxy) |
| `backend` | API + WebSocket + ingesta MQTT | edge, internal | — (sólo vía proxy) |
| `worker` | Informes y tareas diferidas | internal | — |
| `migrate` | Job de migraciones Prisma (no persistente) | internal | — |
| `postgres` | Base de datos | internal | — (nunca publicado) |
| `mosquitto` | Broker MQTT | internal | `MQTT_PORT` (1883, obligatorio para módulos) |
| `backup` | pg_dump programado | internal | — |
| `device-simulator` (perfil `simulator`) | Simula módulos ESP32 | internal | — |
| `seed` (perfil `dev`) | Siembra datos de prueba | internal | — |
| `postgres-test` / `mosquitto-test` / `test-runner` (perfil `test`) | BD/broker efímeros + validación | internal | — |
| `cadvisor` (perfil `monitoring`) | Métricas de contenedores | internal | `MONITORING_HTTP_PORT` (9090) |

**Únicos puertos publicados al host en el stack base:** el proxy (8080) y
mosquitto (1883). PostgreSQL no se publica nunca. En desarrollo,
`compose.dev.yml` añade publicaciones adicionales explícitas y documentadas
(depuración Node, Vite, acceso directo a postgres/mosquitto).

## Perfiles

```bash
docker compose up -d                              # stack base (sin perfil)
docker compose --profile simulator up -d           # + device-simulator
docker compose -f compose.yml -f compose.dev.yml \
  --profile dev up --build                         # entorno de desarrollo
docker compose --profile test up --build \
  --abort-on-container-exit --exit-code-from test-runner   # pruebas efímeras
docker compose --profile monitoring up -d cadvisor  # monitorización opcional
```

Ver `Makefile` (`make help`) para los objetivos equivalentes.

## Volúmenes nombrados

| Volumen | Contenido |
|---|---|
| `diana_postgres_data` | Datos de PostgreSQL |
| `diana_mosquitto_data` | Persistencia de Mosquitto (retained, cola) |
| `diana_backups` | Copias de seguridad (`daily/`, `weekly/`, `monthly/`) |
| `diana_proxy_certs` | Certificados TLS del proxy (preparado, vacío por defecto) |
| `diana_exports` | Exportaciones CSV compartidas backend/worker |
| `diana_firmware` | Firmware publicado para OTA |

Ninguno se borra con `make down` / `docker compose down` (sin `-v`).
`make reset-dev` sólo afecta a volúmenes del entorno de desarrollo.

## Seguridad de red y MQTT

- Mosquitto sin acceso anónimo, ACL estricta por módulo — ver
  `infrastructure/mosquitto/README` (más abajo) y
  `contracts/mqtt/README.md` sección 8.
- El backend es el único cliente con escritura sobre `system/#` y
  `.../config/desired`.
- Ningún secreto vive en este repositorio: `.env`, `infrastructure/mosquitto/passwd`
  y `infrastructure/mosquitto/acl`-derivados de contraseñas están en
  `.gitignore`. Genera credenciales reales con
  `infrastructure/mosquitto/generate-users.sh` (ver `.env.example` para la
  lista completa de variables y cómo generarlas).

## Procedimiento de actualización (con backup previo y rollback)

1. **Backup previo obligatorio.**
   ```bash
   make backup
   # Verifica que el fichero aparece en diana_backups (daily/)
   docker compose exec backup ls -la /backups/daily
   ```
2. **Congela la versión actual** (anota el commit/tag desplegado, p.ej.
   `git rev-parse HEAD` en el momento del despliegue vigente).
3. **Despliega la nueva versión:**
   ```bash
   git pull   # o checkout del tag/rama a desplegar
   make deploy   # build + migrate + up
   ```
4. **Verifica salud:**
   ```bash
   make ps       # todos los servicios deben quedar "healthy"
   make logs     # revisa arranque sin errores, en especial migrate y backend
   ```
5. **Si algo falla — rollback:**
   ```bash
   git checkout <commit-o-tag-anterior>
   make build
   docker compose up -d
   # Si la migración de BD introdujo cambios incompatibles, restaura el
   # backup del paso 1 en una base de prueba primero (ver
   # infrastructure/backups/README.md, "Restauración de prueba aislada")
   # antes de restaurar sobre la base real.
   ```
6. **Nunca** se restaura directamente sobre producción sin validar antes en
   una base de prueba aislada, y nunca sin confirmación explícita del
   operador.

## Subcarpetas

- `infrastructure/mosquitto/` — configuración del broker, ACL, generación de
  usuarios. Ver comentarios en `mosquitto.conf` y `acl`.
- `infrastructure/proxy/` — configuración nginx (cabeceras de seguridad,
  rate limiting, WebSocket, TLS preparado).
- `infrastructure/postgres/` — tuning conservador para 4 GB de RAM e
  inicialización mínima (UTC, extensiones base). Las migraciones de esquema
  las aplica el servicio `migrate` (Prisma, WP-02), no este directorio.
- `infrastructure/backups/` — scripts de backup/restore y procedimiento de
  restauración de prueba aislada.
- `infrastructure/monitoring/` — monitorización ligera opcional
  (`cadvisor`), perfil `monitoring`.
- `infrastructure/docker/` — ficheros auxiliares compartidos (entrypoint de
  cron para el servicio `backup`, plantilla de `.dockerignore`).
- `infrastructure/vm/`, `infrastructure/provisioning/` — **NO pertenecen a
  WP-01**, son de WP-08 (VM Proxmox y despliegue).
