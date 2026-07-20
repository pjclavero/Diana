#!/usr/bin/env sh
# ==============================================================================
# Diana · backup.sh — copia comprimida de PostgreSQL con retención
# diaria/semanal/mensual
# ==============================================================================
# Se ejecuta dentro del contenedor `backup` (ver compose.yml), que sólo tiene
# acceso de red a `postgres` y al volumen `diana_backups`. Usa `pg_dump` vía
# variables de entorno estándar de libpq (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).
#
# Retención (configurable por .env):
#   BACKUP_RETENTION_DAILY   copias diarias a conservar (por defecto 7)
#   BACKUP_RETENTION_WEEKLY  copias semanales a conservar (por defecto 4)
#   BACKUP_RETENTION_MONTHLY copias mensuales a conservar (por defecto 6)
#
# Estructura de salida bajo /backups:
#   daily/diana_YYYYMMDD-HHMMSS.sql.gz
#   weekly/diana_YYYYMMDD-HHMMSS.sql.gz   (se copia cada domingo)
#   monthly/diana_YYYYMMDD-HHMMSS.sql.gz  (se copia el día 1 de cada mes)
#
# Este script NO borra la base de datos de origen ni hace nada destructivo:
# sólo lee (pg_dump) y escribe en /backups.
# ==============================================================================
set -eu

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"
RETENTION_MONTHLY="${BACKUP_RETENTION_MONTHLY:-6}"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
DAY_OF_WEEK="$(date -u +%u)"   # 1 = lunes ... 7 = domingo
DAY_OF_MONTH="$(date -u +%d)"

DAILY_DIR="${BACKUP_ROOT}/daily"
WEEKLY_DIR="${BACKUP_ROOT}/weekly"
MONTHLY_DIR="${BACKUP_ROOT}/monthly"
mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR"

FILENAME="diana_${TIMESTAMP}.sql.gz"
DAILY_PATH="${DAILY_DIR}/${FILENAME}"

echo "[backup] $(date -u -Iseconds) iniciando pg_dump -> ${DAILY_PATH}"

# --dbname acepta también una connection string completa (DATABASE_URL);
# se usan variables PG* estándar para no repetir credenciales en el comando.
pg_dump --format=plain --no-owner --no-privileges | gzip -9 > "${DAILY_PATH}.tmp"
mv "${DAILY_PATH}.tmp" "${DAILY_PATH}"

echo "[backup] copia diaria completada: ${DAILY_PATH} ($(du -h "${DAILY_PATH}" | cut -f1))"

if [ "$DAY_OF_WEEK" = "7" ]; then
    cp "${DAILY_PATH}" "${WEEKLY_DIR}/${FILENAME}"
    echo "[backup] copia semanal creada: ${WEEKLY_DIR}/${FILENAME}"
fi

if [ "$DAY_OF_MONTH" = "01" ]; then
    cp "${DAILY_PATH}" "${MONTHLY_DIR}/${FILENAME}"
    echo "[backup] copia mensual creada: ${MONTHLY_DIR}/${FILENAME}"
fi

prune() {
    dir="$1"
    keep="$2"
    # Lista por nombre (que incluye timestamp UTC ordenable), conserva las
    # $keep más recientes y borra el resto.
    count=$(find "$dir" -maxdepth 1 -name 'diana_*.sql.gz' | wc -l)
    if [ "$count" -gt "$keep" ]; then
        find "$dir" -maxdepth 1 -name 'diana_*.sql.gz' | sort | head -n "$((count - keep))" | while IFS= read -r old; do
            echo "[backup] purgando copia antigua: $old"
            rm -f "$old"
        done
    fi
}

prune "$DAILY_DIR" "$RETENTION_DAILY"
prune "$WEEKLY_DIR" "$RETENTION_WEEKLY"
prune "$MONTHLY_DIR" "$RETENTION_MONTHLY"

echo "[backup] $(date -u -Iseconds) finalizado correctamente"
