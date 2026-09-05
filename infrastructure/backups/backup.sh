#!/usr/bin/env bash
# ==============================================================================
# Diana · backup.sh — copia comprimida de PostgreSQL, VERIFICADA y ATÓMICA
# ==============================================================================
# Se ejecuta dentro del contenedor `backup` (ver compose.yml), que sólo tiene
# acceso de red a `postgres` y al volumen `diana_backups`. Usa `pg_dump` vía
# variables de entorno estándar de libpq (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).
#
# CONTRATO (exigido por el operador; ver docs/coordination/D5-BACKUP-EVIDENCIA.md)
#
#   BACKUP_SUCCESS = el proceso terminó correctamente
#                  + el artefacto existe
#                  + tamaño/plausibilidad mínima
#                  + contenido verificable (estructura de dump real)
#                  + publicación atómica: sólo entonces recibe su nombre final
#
#   NUNCA `rc=0` -> «backup correcto».
#
# MEDIDO (2026-08-09, VM109): sin `pipefail`, un `pg_dump` fallido dejaba un
# `.sql.gz` VÁLIDO de ~20 bytes (gzip del vacío), el script lo copiaba a
# weekly/ y terminaba con «finalizado correctamente» y rc=0. Un backup que
# miente es peor que no tener backup.
#
# Requiere bash: la imagen `postgres:16.4-alpine` que usa el servicio `backup`
# lo incluye (verificado: /bin/bash presente). Hace falta para `pipefail` y
# `PIPESTATUS`, que son lo que impide que la tubería enmascare el fallo.
#
# Retención (configurable por .env):
#   BACKUP_RETENTION_DAILY   copias diarias a conservar (por defecto 7)
#   BACKUP_RETENTION_WEEKLY  copias semanales a conservar (por defecto 4)
#   BACKUP_RETENTION_MONTHLY copias mensuales a conservar (por defecto 6)
#
# Umbrales de plausibilidad (configurables, por si el dump real crece o encoge;
# los valores por defecto son deliberadamente bajos — sirven para descartar
# basura, no para adivinar el tamaño «correcto»):
#   BACKUP_MIN_BYTES        tamaño mínimo del .gz publicado     (por defecto 512)
#   BACKUP_MIN_PLAIN_BYTES  tamaño mínimo del SQL sin comprimir (por defecto 2048)
#   BACKUP_MIN_STATEMENTS   sentencias SQL mínimas              (por defecto 5)
#
# Estructura de salida bajo /backups:
#   .staging/                          zona de trabajo; NADA sale de aquí sin verificar
#   daily/diana_YYYYMMDD-HHMMSS.sql.gz
#   weekly/…                           (se copia cada domingo)
#   monthly/…                          (se copia el día 1 de cada mes)
#   <cada copia publicada lleva su fichero .sha256 al lado>
#   last-status                        OK|FAIL <timestamp> <detalle>, para el healthcheck
#
# Este script NO borra la base de datos de origen ni hace nada destructivo:
# sólo lee (pg_dump) y escribe en /backups.
# ==============================================================================
set -Eeuo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-4}"
RETENTION_MONTHLY="${BACKUP_RETENTION_MONTHLY:-6}"
MIN_BYTES="${BACKUP_MIN_BYTES:-512}"
MIN_PLAIN_BYTES="${BACKUP_MIN_PLAIN_BYTES:-2048}"
MIN_STATEMENTS="${BACKUP_MIN_STATEMENTS:-5}"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
DAY_OF_WEEK="$(date -u +%u)"   # 1 = lunes ... 7 = domingo
DAY_OF_MONTH="$(date -u +%d)"

DAILY_DIR="${BACKUP_ROOT}/daily"
WEEKLY_DIR="${BACKUP_ROOT}/weekly"
MONTHLY_DIR="${BACKUP_ROOT}/monthly"
STAGING_DIR="${BACKUP_ROOT}/.staging"
STATUS_FILE="${BACKUP_ROOT}/last-status"
mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR" "$STAGING_DIR"

FILENAME="diana_${TIMESTAMP}.sql.gz"
STAGED="${STAGING_DIR}/${FILENAME}"      # nombre NO definitivo: fuera de daily/
DAILY_PATH="${DAILY_DIR}/${FILENAME}"

# ------------------------------------------------------------------------------
# Estado y salida
# ------------------------------------------------------------------------------
# El estado arranca en FAIL y sólo pasa a OK al final. Si el proceso muere de
# cualquier forma (señal, error no previsto, OOM), lo que queda escrito es FAIL:
# el healthcheck no puede confundir «no terminó» con «fue bien».
printf 'FAIL %s en curso, sin publicar\n' "$(date -u -Iseconds)" > "$STATUS_FILE"

fail() {
    echo "[backup] ERROR: $1" >&2
    printf 'FAIL %s %s\n' "$(date -u -Iseconds)" "$1" > "$STATUS_FILE"
    rm -f "$STAGED" "${STAGED}.plain" 2>/dev/null || true
    exit 1
}
# Cualquier orden que falle sin estar contemplada acaba también en FAIL, no en
# un rc=0 silencioso. `set -E` es lo que hace que el trap se herede en
# funciones y subshells.
trap 'fail "orden fallida en la línea ${LINENO}"' ERR

echo "[backup] $(date -u -Iseconds) iniciando pg_dump -> ${STAGED} (staging)"

# ------------------------------------------------------------------------------
# 1. Volcado. `pipefail` + PIPESTATUS: el fallo de pg_dump NO puede quedar
#    enmascarado por el rc=0 de gzip. Se lee PIPESTATUS y NUNCA un `$?`
#    implícito, que aquí sería el de la propia asignación.
# ------------------------------------------------------------------------------
#    El trap ERR se desarma sólo aquí: en bash salta aunque `errexit` esté
#    apagado, y taparía el motivo concreto con un genérico «línea N». El fallo
#    se sigue detectando —abajo— pero con su causa exacta escrita en el estado.
trap - ERR
set +e
pg_dump --format=plain --no-owner --no-privileges | gzip -9 > "$STAGED"
PIPE_STATUS=( "${PIPESTATUS[@]}" )
set -e
trap 'fail "orden fallida en la línea ${LINENO}"' ERR
[ "${PIPE_STATUS[0]:-1}" = "0" ] \
    || fail "pg_dump devolvió ${PIPE_STATUS[0]:-desconocido}; no se publica la copia"
[ "${PIPE_STATUS[1]:-1}" = "0" ] \
    || fail "gzip devolvió ${PIPE_STATUS[1]:-desconocido}; no se publica la copia"

# ------------------------------------------------------------------------------
# 2. Verificación del artefacto ANTES de darle su nombre definitivo.
#    Cada comprobación responde a un modo de fallo observado o plausible.
# ------------------------------------------------------------------------------
[ -f "$STAGED" ] || fail "el artefacto no existe tras el volcado"

SIZE="$(wc -c < "$STAGED" | tr -d ' ')"
# El gzip de la cadena vacía ocupa ~20 bytes y es perfectamente «válido».
[ "$SIZE" -ge "$MIN_BYTES" ] \
    || fail "artefacto inverosímil: ${SIZE} bytes < ${MIN_BYTES} mínimos (dump vacío o truncado)"

gzip -t "$STAGED" 2>/dev/null || fail "gzip corrupto o truncado"

# Que descomprima no basta: tiene que TENER ESTRUCTURA de dump de verdad.
PLAIN="${STAGED}.plain"
gunzip -c "$STAGED" > "$PLAIN" || fail "no se pudo descomprimir el artefacto"
PLAIN_SIZE="$(wc -c < "$PLAIN" | tr -d ' ')"
[ "$PLAIN_SIZE" -ge "$MIN_PLAIN_BYTES" ] \
    || fail "SQL inverosímil: ${PLAIN_SIZE} bytes sin comprimir < ${MIN_PLAIN_BYTES} mínimos"

# Se usa sustitución de proceso, no una tubería: con `pipefail`, un `grep -q`
# que corta la lectura mataría a `head`/`tail` con SIGPIPE y daría un falso
# fallo. Aquí el rc es sólo el de grep.
grep -q 'PostgreSQL database dump' <(head -20 "$PLAIN") \
    || fail "el volcado no empieza con la cabecera de pg_dump"
# pg_dump en formato plain SIEMPRE cierra con esta línea: su ausencia significa
# volcado truncado (proceso muerto a mitad, disco lleno, red cortada).
grep -q 'PostgreSQL database dump complete' <(tail -5 "$PLAIN") \
    || fail "el volcado no contiene el marcador de fin de pg_dump (truncado)"
# Un fichero con sólo las dos cabeceras y nada en medio pasaría lo anterior y
# seguiría siendo inútil: se exigen sentencias reales.
DDL_COUNT="$(grep -c -E '^(CREATE |ALTER |COPY |INSERT |SET )' "$PLAIN" || true)"
[ "${DDL_COUNT:-0}" -ge "$MIN_STATEMENTS" ] \
    || fail "el volcado sólo tiene ${DDL_COUNT} sentencias SQL: no es un dump utilizable"
rm -f "$PLAIN"

SHA="$(sha256sum "$STAGED" | cut -d' ' -f1)"
echo "[backup] verificado en staging: ${SIZE} bytes, ${DDL_COUNT} sentencias, sha256=${SHA}"

# ------------------------------------------------------------------------------
# 3. Publicación atómica. Sólo aquí el artefacto recibe su nombre definitivo.
#    Nunca se pisa una copia existente: si el nombre ya estuviera ocupado
#    (relojes, doble disparo del planificador) se aborta en vez de sobrescribir
#    la copia buena anterior.
# ------------------------------------------------------------------------------
[ ! -e "$DAILY_PATH" ] || fail "ya existe ${DAILY_PATH}; no se sobrescribe una copia previa"
mv "$STAGED" "$DAILY_PATH"          # mismo sistema de ficheros -> rename(2) atómico
chmod 600 "$DAILY_PATH"             # el volcado contiene hashes de contraseña
printf '%s  %s\n' "$SHA" "$FILENAME" > "${DAILY_PATH}.sha256"

echo "[backup] copia diaria publicada: ${DAILY_PATH} (${SIZE} bytes)"

# Las copias semanal/mensual se publican igual de atómicamente: cp a un nombre
# temporal dentro del directorio destino y mv. Un cp interrumpido no puede
# dejar un fichero a medias con nombre de copia buena.
publish_copy() {  # publish_copy <dir-destino> <etiqueta>
    local dir="$1" label="$2" tmp
    tmp="${dir}/.${FILENAME}.partial"
    rm -f "$tmp"
    cp "$DAILY_PATH" "$tmp" || fail "no se pudo copiar la copia ${label}"
    [ "$(sha256sum "$tmp" | cut -d' ' -f1)" = "$SHA" ] \
        || fail "la copia ${label} no coincide con el original (sha256)"
    [ ! -e "${dir}/${FILENAME}" ] || fail "ya existe ${dir}/${FILENAME}; no se sobrescribe"
    mv "$tmp" "${dir}/${FILENAME}"
    printf '%s  %s\n' "$SHA" "$FILENAME" > "${dir}/${FILENAME}.sha256"
    echo "[backup] copia ${label} creada: ${dir}/${FILENAME}"
}

if [ "$DAY_OF_WEEK" = "7" ]; then
    publish_copy "$WEEKLY_DIR" semanal
fi
if [ "$DAY_OF_MONTH" = "01" ]; then
    publish_copy "$MONTHLY_DIR" mensual
fi

# ------------------------------------------------------------------------------
# 4. Retención. Sólo se ejecuta con una copia nueva YA publicada y verificada:
#    si el volcado falla, arriba se ha salido y NO se purga nada — nunca se
#    tira la copia buena anterior a cambio de una mala.
# ------------------------------------------------------------------------------
prune() {
    local dir="$1" keep="$2" count old
    [ "$keep" -ge 1 ] || { echo "[backup] retención <1 en ${dir}: no se purga nada"; return 0; }
    count=$(find "$dir" -maxdepth 1 -name 'diana_*.sql.gz' | wc -l)
    if [ "$count" -gt "$keep" ]; then
        # El nombre lleva el timestamp UTC, así que orden lexicográfico = cronológico.
        while IFS= read -r old; do
            [ "$old" = "$DAILY_PATH" ] && continue   # jamás la recién publicada
            echo "[backup] purgando copia antigua: $old"
            rm -f "$old" "${old}.sha256"
        done < <(find "$dir" -maxdepth 1 -name 'diana_*.sql.gz' | sort | head -n "$((count - keep))")
    fi
}

prune "$DAILY_DIR"   "$RETENTION_DAILY"
prune "$WEEKLY_DIR"  "$RETENTION_WEEKLY"
prune "$MONTHLY_DIR" "$RETENTION_MONTHLY"

# Restos de ejecuciones muertas: staging es zona de trabajo, nunca de archivo.
find "$STAGING_DIR" -maxdepth 1 -type f -mmin +720 -delete 2>/dev/null || true

printf 'OK %s %s sha256=%s bytes=%s\n' "$(date -u -Iseconds)" "$DAILY_PATH" "$SHA" "$SIZE" > "$STATUS_FILE"
echo "[backup] $(date -u -Iseconds) finalizado correctamente y VERIFICADO"
