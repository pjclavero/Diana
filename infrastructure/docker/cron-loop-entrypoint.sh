#!/usr/bin/env sh
# ==============================================================================
# Diana · cron-loop-entrypoint.sh — entrypoint compartido para tareas
# programadas dentro de contenedores minimalistas (alpine) sin crond.
# ==============================================================================
# Evita depender de un paquete de cron adicional en imágenes ya fijadas
# (p.ej. la imagen oficial de postgres, reutilizada por el servicio `backup`
# para tener pg_dump/psql disponibles). Comprueba cada minuto si el momento
# actual (UTC) casa con una expresión cron de 5 campos y, si es así, ejecuta
# el comando indicado.
#
# Variables de entorno:
#   CRON_SCHEDULE   expresión cron de 5 campos: minuto hora dia-mes mes dia-semana
#                    soporta: "*", número exacto, listas "a,b,c", pasos "*/N"
#   CRON_COMMAND    comando a ejecutar (se pasa a `sh -c`)
#   RUN_ON_START    si es "1", ejecuta el comando una vez al arrancar además
#                    de respetar el cron (útil para no esperar hasta el primer
#                    disparo en un entorno de desarrollo/test)
#
# Uso típico (ver compose.yml, servicio `backup`):
#   entrypoint: ["/entrypoints/cron-loop-entrypoint.sh"]
#   environment:
#     CRON_SCHEDULE: ${BACKUP_CRON}
#     CRON_COMMAND: "/scripts/backup.sh"
# ==============================================================================
set -eu

CRON_SCHEDULE="${CRON_SCHEDULE:?CRON_SCHEDULE es obligatorio, p.ej. '30 2 * * *'}"
CRON_COMMAND="${CRON_COMMAND:?CRON_COMMAND es obligatorio}"
RUN_ON_START="${RUN_ON_START:-0}"

field_matches() {
    # $1 = valor actual (numérico, sin ceros a la izquierda)
    # $2 = campo cron (puede ser "*", "N", "a,b,c" o "*/N")
    value="$1"
    field="$2"

    [ "$field" = "*" ] && return 0

    case "$field" in
        */*)
            step="${field#*/}"
            [ $((value % step)) -eq 0 ] && return 0
            return 1
            ;;
        *,*)
            old_ifs="$IFS"
            IFS=','
            for part in $field; do
                if [ "$part" = "$value" ]; then
                    IFS="$old_ifs"
                    return 0
                fi
            done
            IFS="$old_ifs"
            return 1
            ;;
        *)
            [ "$field" = "$value" ] && return 0
            return 1
            ;;
    esac
}

echo "[cron-loop] iniciando con CRON_SCHEDULE='${CRON_SCHEDULE}' (UTC)"

if [ "$RUN_ON_START" = "1" ]; then
    echo "[cron-loop] RUN_ON_START=1: ejecutando una vez al arrancar"
    sh -c "$CRON_COMMAND" || echo "[cron-loop] aviso: la ejecución inicial devolvió error" >&2
fi

MIN_F=$(echo "$CRON_SCHEDULE" | awk '{print $1}')
HOUR_F=$(echo "$CRON_SCHEDULE" | awk '{print $2}')
DOM_F=$(echo "$CRON_SCHEDULE" | awk '{print $3}')
MON_F=$(echo "$CRON_SCHEDULE" | awk '{print $4}')
DOW_F=$(echo "$CRON_SCHEDULE" | awk '{print $5}')

LAST_RUN_MINUTE=""

while true; do
    NOW_MIN=$(date -u +%-M)
    NOW_HOUR=$(date -u +%-H)
    NOW_DOM=$(date -u +%-d)
    NOW_MON=$(date -u +%-m)
    NOW_DOW=$(date -u +%u)
    NOW_KEY=$(date -u +%Y%m%d%H%M)

    if [ "$NOW_KEY" != "$LAST_RUN_MINUTE" ] \
        && field_matches "$NOW_MIN" "$MIN_F" \
        && field_matches "$NOW_HOUR" "$HOUR_F" \
        && field_matches "$NOW_DOM" "$DOM_F" \
        && field_matches "$NOW_MON" "$MON_F" \
        && field_matches "$NOW_DOW" "$DOW_F"; then
        echo "[cron-loop] $(date -u -Iseconds) disparo: ejecutando CRON_COMMAND"
        sh -c "$CRON_COMMAND" || echo "[cron-loop] aviso: la ejecución devolvió error" >&2
        LAST_RUN_MINUTE="$NOW_KEY"
    fi

    sleep 30
done
