# Operación de Diana en la VM 109

> Paquete WP-08. Complementa el
> [procedimiento de despliegue](../deployment/procedimiento.md). Cubre
> arranque/parada, copias de seguridad, recuperación, pruebas de verificación
> y reinicio de la máquina.

## Arranque / parada

```bash
cd /opt/diana
docker compose up -d          # levanta todo el stack (perfil por defecto)
docker compose ps             # estado + salud
docker compose logs -f backend
docker compose down           # para y elimina contenedores (CONSERVA volúmenes)
```

`restart: unless-stopped` en todos los servicios persistentes: tras un
`reboot` de la VM, el stack vuelve solo (verificado en la sección "Reinicio").

## Datos que persisten (volúmenes nombrados)

| Volumen | Contenido |
|---|---|
| `diana_postgres_data` | Base de datos PostgreSQL. |
| `diana_mosquitto_data` | Persistencia del broker (retained + colas QoS). |
| `diana_backups` | Copias `pg_dump` (daily/weekly/monthly). |
| `diana_exports`, `diana_firmware`, `diana_proxy_certs` | Exportaciones, firmware, certificados. |

`docker compose down` NO borra estos volúmenes. Sólo `down -v` los elimina
(destructivo: no usar en producción sin confirmación del operador).

## Copias de seguridad

El servicio `backup` ejecuta `backup.sh` según `BACKUP_CRON` (02:30 UTC por
defecto): `pg_dump` comprimido a `diana_backups:/backups/daily/`, con rotación
semanal/mensual y purga por retención. Es de sólo lectura sobre la base.

Copia manual inmediata:

```bash
docker compose exec backup /scripts/backup.sh
docker compose exec backup ls -lh /backups/daily
```

## Recuperación (restauración de prueba aislada)

Antes de restaurar sobre la base real, validar el dump en una base separada
(`--target-db`), sin tocar `diana`:

```bash
FILE=$(docker compose exec -T backup sh -c 'ls -1 /backups/daily/*.sql.gz | tail -1')
docker compose exec backup /scripts/restore.sh "$FILE" --target-db diana_restore_test
# Verificar y luego limpiar:
docker compose exec backup psql -c 'DROP DATABASE diana_restore_test'
```

## Pruebas de verificación en la VM

### Integración contra PostgreSQL real (idempotencia + modelo temporal)

Las 5 pruebas de `server/backend/test/integration/` necesitan base viva y
dependencias de desarrollo (jest/ts-jest), que NO están en la imagen de
producción. Se ejecutan en un contenedor efímero de Node en la red interna,
contra una base de datos de pruebas dedicada (`diana_it`):

```bash
cd /opt/diana
set -a; . ./.env; set +a
NET=$(docker network ls --format '{{.Name}}' | grep -E 'internal$' | head -1)
# Base de pruebas dedicada + migración:
docker compose exec -T postgres psql "$DATABASE_URL" -c "CREATE DATABASE diana_it;"
IT_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/diana_it?schema=public"
docker run --rm --network "$NET" -v /opt/diana:/repo -w /repo/server/backend \
  -e DATABASE_URL="$IT_URL" node:20.19-bookworm-slim \
  bash -c "npm ci && npx prisma migrate deploy && npm run test:integration"
```

> La base `diana_it` se vacía parcialmente durante las pruebas (README de
> integración): nunca apuntarlas a la base de producción.

### ACL de Mosquitto

```bash
cd /opt/diana/infrastructure/mosquitto
./test-acl.sh 127.0.0.1 1883 "$MQTT_BACKEND_PW" "$M1_PW" "$M2_PW"
```
Requiere los usuarios `backend`, `module-m1`, `module-m2` en `passwd`. Todas
las rutas negativas (suplantación, escritura en `config/desired`, `command`,
`ota`) deben quedar bloqueadas.

### Simulador -> Mosquitto -> PostgreSQL

```bash
docker compose --profile simulator up -d device-simulator
# El backend ingesta desde MQTT; comprobar filas en hit_events:
docker compose exec -T postgres psql "$DATABASE_URL" -c "SELECT count(*) FROM hit_events;"
```

## Reinicio de la VM

```bash
sudo reboot
# Tras volver:
docker compose ps    # todo debe recuperarse solo (restart: unless-stopped)
```

## Notas de seguridad de esta instalación (pendientes)

- **TLS desactivado**: nginx y mosquitto sirven en claro dentro de la LAN. El
  bloque HTTPS/8443 y el listener MQTT 8883 están preparados y comentados.
- El único puerto MQTT publicado al host es `1883` (lo necesitan los módulos
  ESP32 físicos). PostgreSQL NO se publica. El proxy publica `8080`.
- No exponer nada a Internet sin revisar antes CORS, TLS y contraseñas.
