#!/bin/sh
# =============================================================================
# Diana · broker MQTT — recarga del fichero de credenciales
# =============================================================================
# POR QUÉ EXISTE ESTO
#
# Mosquitto lee `password_file` UNA vez, al arrancar, y vuelve a leerlo sólo
# cuando recibe SIGHUP. El backend es la autoridad de credenciales: cuando da
# de alta un módulo escribe su entrada en ese fichero desde OTRO contenedor.
# Sin nadie que avise al broker, la credencial existe en disco y no existe para
# quien tiene que aceptarla: el ESP32 se conecta con la contraseña correcta y
# recibe `Connection Refused: not authorised`. Un fallo particularmente caro de
# diagnosticar, porque todo lo demás está bien.
#
# No se puede señalar al broker desde el contenedor del backend: son espacios
# de PID distintos. Por eso el vigilante vive AQUÍ, junto al proceso al que
# tiene que mandar la señal.
#
# POR QUÉ UN SONDEO Y NO inotify
# `eclipse-mosquitto` es Alpine con busybox y no trae `inotifywait`. Añadir un
# paquete al broker para esto sería ampliar la superficie del componente más
# expuesto del sistema a cambio de ahorrar un `stat` cada dos segundos.
#
# LO QUE ESTE SCRIPT NO HACE
# No escribe en el fichero, no genera credenciales y no lo lee: sólo mira la
# fecha de modificación. El secreto no pasa por aquí.
# =============================================================================
set -eu

CONF="${MOSQUITTO_CONF:-/mosquitto/config/mosquitto.conf}"
PASSWD="${MOSQUITTO_PASSWD_FILE:-/mosquitto/credentials/passwd}"
INTERVALO="${MOSQUITTO_RELOAD_POLL_SECONDS:-2}"

# `huella` cambia si cambia la fecha de modificación O el tamaño. El tamaño se
# incluye porque en un sistema de ficheros con resolución de segundo dos
# escrituras dentro del mismo segundo comparten mtime, y dar de alta dos
# módulos seguidos es exactamente ese caso.
huella() {
  if [ -f "$PASSWD" ]; then
    stat -c '%Y:%s' "$PASSWD" 2>/dev/null || echo 'ilegible'
  else
    echo 'ausente'
  fi
}

mosquitto -c "$CONF" &
BROKER=$!

# Apagado limpio: sin esto, PID 1 es el shell y un `docker compose stop` esperaría
# los diez segundos completos antes de matar al broker a lo bruto.
trap 'kill -TERM "$BROKER" 2>/dev/null || true' TERM INT

(
  previa=$(huella)
  while kill -0 "$BROKER" 2>/dev/null; do
    sleep "$INTERVALO"
    actual=$(huella)
    if [ "$actual" != "$previa" ]; then
      # A stderr, que es donde van los registros del broker. Nunca el contenido.
      echo "[reload] $PASSWD ha cambiado ($previa -> $actual): SIGHUP al broker" >&2
      kill -HUP "$BROKER" 2>/dev/null || true
      previa="$actual"
    fi
  done
) &
VIGILANTE=$!

wait "$BROKER"
CODIGO=$?
kill "$VIGILANTE" 2>/dev/null || true
exit "$CODIGO"
