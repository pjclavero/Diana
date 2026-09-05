#!/usr/bin/env bash
# ==============================================================================
# Diana · restore.sh — restauración de una copia pg_dump comprimida, verificada
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
# CONTRATO: una restauración NO se da por buena porque el comando no falle.
# Se verifica el fichero ANTES (integridad, tamaño, estructura de dump real y,
# si existe, su .sha256) y el resultado DESPUÉS (psql devolvió 0 y la base
# destino tiene tablas). Nunca `rc=0` -> «restaurado».
#
# MEDIDO (2026-08-09, VM109): sin estas comprobaciones, restaurar un .sql.gz
# truncado imprimía "gunzip: unexpected end of file", dejaba la base a medias y
# aun así devolvía rc=0 y "restauración completada" — porque /bin/sh no tiene
# `pipefail` y el estado del pipe era el de psql. Un backup corrupto se daba
# por bueno.
#
# Este script NO borra el fichero de backup ni ninguna otra base de datos
# distinta de la indicada como destino.
# ==============================================================================
set -Eeuo pipefail

MIN_BYTES="${BACKUP_MIN_BYTES:-512}"
MIN_PLAIN_BYTES="${BACKUP_MIN_PLAIN_BYTES:-2048}"

die() { echo "[restore] ERROR: $1" >&2; exit 1; }
trap 'die "orden fallida en la línea ${LINENO}"' ERR

BACKUP_FILE="${1:?Uso: restore.sh <ruta-al-fichero.sql.gz> [--target-db <nombre>]}"
shift || true

TARGET_DB="${PGDATABASE:-diana}"
if [ "${1:-}" = "--target-db" ]; then
    TARGET_DB="${2:?--target-db requiere un nombre}"
fi
# El nombre de la base se interpola en SQL: se restringe para que no pueda
# llevar comillas ni punto y coma.
case "$TARGET_DB" in
    *[!A-Za-z0-9_]*) die "nombre de base destino no admitido: '${TARGET_DB}'" ;;
esac

[ -f "$BACKUP_FILE" ] || die "no existe el fichero $BACKUP_FILE"

echo "[restore] destino: base de datos '${TARGET_DB}' en host ${PGHOST:-postgres}"
echo "[restore] fichero de origen: ${BACKUP_FILE}"
echo "[restore] ATENCIÓN: esta operación sobrescribe el contenido de '${TARGET_DB}'."

# ------------------------------------------------------------------------------
# 1. Verificación del fichero ANTES de tocar ninguna base de datos.
# ------------------------------------------------------------------------------
echo "[restore] verificando el artefacto..."
SIZE="$(wc -c < "$BACKUP_FILE" | tr -d ' ')"
[ "$SIZE" -ge "$MIN_BYTES" ] \
    || die "artefacto inverosímil: ${SIZE} bytes < ${MIN_BYTES} mínimos (vacío o truncado)"

gzip -t "$BACKUP_FILE" 2>/dev/null || die "$BACKUP_FILE está corrupto o truncado (gzip -t)"

# Si el backup trae su .sha256 al lado (los que publica backup.sh lo traen),
# se comprueba: detecta corrupción silenciosa del almacenamiento.
if [ -f "${BACKUP_FILE}.sha256" ]; then
    EXPECTED="$(cut -d' ' -f1 < "${BACKUP_FILE}.sha256")"
    ACTUAL="$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)"
    [ "$EXPECTED" = "$ACTUAL" ] || die "sha256 no coincide con ${BACKUP_FILE}.sha256: fichero alterado"
    echo "[restore] sha256 verificado contra el fichero acompañante"
fi

PLAIN_TMP="$(mktemp)"
cleanup_plain() { rm -f "$PLAIN_TMP"; }
trap 'cleanup_plain' EXIT
gunzip -c "$BACKUP_FILE" > "$PLAIN_TMP" || die "no se pudo descomprimir $BACKUP_FILE"
PLAIN_SIZE="$(wc -c < "$PLAIN_TMP" | tr -d ' ')"
[ "$PLAIN_SIZE" -ge "$MIN_PLAIN_BYTES" ] \
    || die "SQL inverosímil: ${PLAIN_SIZE} bytes sin comprimir < ${MIN_PLAIN_BYTES} mínimos"
grep -q 'PostgreSQL database dump' <(head -20 "$PLAIN_TMP") \
    || die "$BACKUP_FILE no empieza con la cabecera de pg_dump"
grep -q 'PostgreSQL database dump complete' <(tail -5 "$PLAIN_TMP") \
    || die "$BACKUP_FILE no contiene el marcador de fin de pg_dump (truncado)"

# ------------------------------------------------------------------------------
# 2. Base destino (se crea si no existe; útil para --target-db de prueba).
# ------------------------------------------------------------------------------
if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${TARGET_DB}'" | grep -q '^1$'; then
    psql -c "CREATE DATABASE \"${TARGET_DB}\"" >/dev/null
    echo "[restore] base '${TARGET_DB}' creada"
fi

# ------------------------------------------------------------------------------
# 3. Restauración. ON_ERROR_STOP=1 + pipefail: cualquier error de psql aborta.
# ------------------------------------------------------------------------------
echo "[restore] restaurando..."
# El trap ERR se desarma sólo aquí: en bash salta aunque `errexit` esté
# apagado, y taparía el motivo concreto. El rc se captura explícitamente en la
# línea siguiente a psql — nunca un `$?` heredado de otra orden.
trap - ERR
set +e
psql --dbname "$TARGET_DB" --set ON_ERROR_STOP=1 --quiet -f "$PLAIN_TMP" >/dev/null
PSQL_RC=$?
set -e
trap 'die "orden fallida en la línea ${LINENO}"' ERR
[ "$PSQL_RC" = "0" ] || die "psql devolvió ${PSQL_RC}; la restauración NO es válida"

# ------------------------------------------------------------------------------
# 4. Efecto observable: la base restaurada tiene que tener estructura.
#    Que psql devuelva 0 sobre una base vacía no es una restauración.
# ------------------------------------------------------------------------------
TABLES="$(psql --dbname "$TARGET_DB" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
[ "${TABLES:-0}" -ge 1 ] \
    || die "la base '${TARGET_DB}' no tiene ninguna tabla tras restaurar: restauración vacía"

echo "[restore] $(date -u -Iseconds) restauración completada y verificada sobre '${TARGET_DB}' (${TABLES} tablas)"
