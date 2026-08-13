#!/usr/bin/env sh
# ==============================================================================
# Diana · restore.sh — restauración de una copia pg_dump comprimida
# ==============================================================================
# Uso:
#   restore.sh <ruta-al-fichero.sql.gz> [--target-db <nombre>]
#
# Por defecto restaura sobre PGDATABASE (la base configurada por entorno),
# lo cual es DESTRUCTIVO para su contenido actual. Para una restauración de
# prueba aislada (recomendado antes de restaurar en producción), usa
# --target-db con un nombre distinto: el script crea esa base si no existe
# y restaura ahí, sin tocar la base real. Ver infrastructure/backups/README.md
# sección "Restauración de prueba aislada" para el procedimiento completo.
#
# Este script NO borra el fichero de backup ni ninguna otra base de datos
# distinta de la indicada como destino.
# ==============================================================================
set -eu

BACKUP_FILE="${1:?Uso: restore.sh <ruta-al-fichero.sql.gz> [--target-db <nombre>]}"
shift || true

TARGET_DB="${PGDATABASE:-diana}"
if [ "${1:-}" = "--target-db" ]; then
    TARGET_DB="${2:?--target-db requiere un nombre}"
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "[restore] ERROR: no existe el fichero $BACKUP_FILE" >&2
    exit 1
fi

echo "[restore] destino: base de datos '${TARGET_DB}' en host ${PGHOST:-postgres}"
echo "[restore] fichero de origen: ${BACKUP_FILE}"
echo "[restore] ATENCIÓN: esta operación sobrescribe el contenido de '${TARGET_DB}'."

# Crea la base destino si no existe (útil para --target-db de prueba aislada).
psql -tc "SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}'" | grep -q 1 \
  || psql -c "CREATE DATABASE \"${TARGET_DB}\""

# MEDIDO (2026-08-09, VM109): sin estas comprobaciones, restaurar un .sql.gz
# truncado imprimía "gunzip: unexpected end of file", dejaba la base a medias y
# aun así devolvía rc=0 y "restauración completada" — porque /bin/sh no tiene
# `pipefail` y el estado del pipe era el de psql. Un backup corrupto se daba
# por bueno.
echo "[restore] verificando integridad del fichero..."
gzip -t "$BACKUP_FILE" 2>/dev/null || {
    echo "[restore] ERROR: $BACKUP_FILE está corrupto o truncado (gzip -t)" >&2; exit 1; }
gunzip -c "$BACKUP_FILE" | tail -5 | grep -q 'PostgreSQL database dump complete' || {
    echo "[restore] ERROR: $BACKUP_FILE no contiene el marcador de fin de pg_dump" >&2; exit 1; }

echo "[restore] restaurando..."
PSQL_STATUS_FILE="$(mktemp)"
gunzip -c "$BACKUP_FILE" \
  | { if psql --dbname "$TARGET_DB" --set ON_ERROR_STOP=1; then
          echo 0 > "$PSQL_STATUS_FILE"
      else
          echo $? > "$PSQL_STATUS_FILE"
      fi; }
PSQL_RC="$(cat "$PSQL_STATUS_FILE")"
rm -f "$PSQL_STATUS_FILE"
if [ "$PSQL_RC" != "0" ]; then
    echo "[restore] ERROR: psql devolvió ${PSQL_RC}; la restauración NO es válida" >&2
    exit 1
fi

echo "[restore] $(date -u -Iseconds) restauración completada sobre '${TARGET_DB}'"
