#!/usr/bin/env bash
# ==============================================================================
# Diana · generación de usuarios/contraseñas de Mosquitto
# ==============================================================================
# Crea o actualiza una entrada en infrastructure/mosquitto/passwd usando
# mosquitto_passwd. NUNCA escribe contraseñas en claro en git: el fichero
# `passwd` está en .gitignore (ver /.gitignore, patrón `mosquitto/passwd`).
#
# MP0-A · IDENTITY_GENERATOR = UNIQUE: este script YA NO decide qué identidades
# existen. La única autoridad es infrastructure/mosquitto/identities.json; aquí
# sólo se crea el SECRETO de una identidad ya declarada allí. Un usuario que no
# esté en la fuente única se rechaza: crearlo produciría credenciales válidas
# para el broker sin ninguna regla de ACL asociada (o, peor, alineadas con un
# module_id que ningún artefacto conoce).
#
# Uso:
#   ./generate-users.sh --all                  # crea/rota TODAS las identidades
#                                              #   declaradas en identities.json
#   ./generate-users.sh backend                # crea/rota el usuario del backend
#   ./generate-users.sh module-01              # crea/rota un usuario de módulo
#   ./generate-users.sh module-01 --print-only # genera contraseña y la imprime
#                                              #   una sola vez, sin guardar eco
#
# Requisitos: el paquete `mosquitto-clients` (que trae mosquitto_passwd) debe
# estar disponible en el host o dentro del contenedor mosquitto:
#   docker compose run --rm mosquitto mosquitto_passwd ...
# Este script intenta usar el binario local si existe y, si no, delega en el
# contenedor mosquitto vía `docker compose exec`.
#
# *** F-02 (crítico, cerrado): el usuario mosquitto de un módulo YA NO lleva
# el prefijo "module-"; se llama EXACTAMENTE igual que su module_id. Antes
# el usuario era "module-{module_id}" y el client_id (sin prefijo) era el
# que usaba la ACL vía %c — como el client_id lo elige libremente el
# cliente, unas credenciales de un módulo cualquiera con client_id ajeno
# suplantaban a otro módulo (confirmado en vivo el 2026-07-21). Con
# `use_username_as_clientid true` en mosquitto.conf el broker fuerza
# client_id = usuario autenticado, así que ahora usuario = client_id =
# module_id, los tres iguales y ninguno elegible por el cliente. Pendiente:
# contracts/mqtt/README.md sección 8 aún describe el usuario como
# "module-{module_id}" con prefijo; ese texto está desactualizado (fuera de
# mi territorio, no se toca contracts/** desde aquí). ***
# ==============================================================================
set -euo pipefail

# Fuerza colación ASCII estricta para las comparaciones de abajo (=~, [a-z0-9]).
# Bajo un locale distinto de C (p. ej. es_ES.UTF-8) el rango [a-z] deja de ser
# sólo a-z y una vocal acentuada u otro carácter no-ASCII puede colar como
# válido: la regex "parece validar" pero no lo hace. Fijarlo aquí, antes de
# cualquier comparación, es lo único que lo hace determinista con independencia
# del entorno de quien ejecute el script.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASSWD_FILE="${SCRIPT_DIR}/passwd"
GEN="${SCRIPT_DIR}/generate-identities.mjs"

# Fuente única de identidades. Si no se puede leer, no se genera nada: es
# preferible fallar a crear una credencial que ninguna ACL respalda.
mapfile -t SOURCE_USERS < <(node "$GEN" --list-users) || {
  echo "ERROR: no se pudo leer la fuente única (${GEN} --list-users)." >&2
  exit 1
}
[[ ${#SOURCE_USERS[@]} -gt 0 ]] || {
  echo "ERROR: la fuente única no declara ninguna identidad." >&2
  exit 1
}

is_declared() { printf '%s\n' "${SOURCE_USERS[@]}" | grep -qx "$1"; }

usage() {
  echo "Uso: $0 --all | <usuario> [--print-only]" >&2
  echo "  Identidades declaradas en la fuente única: ${SOURCE_USERS[*]}" >&2
  echo "  usuario: 'backend', 'healthcheck' o '{module_id}' (p.ej. m1) — el usuario de" >&2
  echo "  un módulo es EXACTAMENTE su module_id, sin prefijo (F-02)." >&2
  exit 1
}

[[ $# -ge 1 ]] || usage

if [[ "$1" == "--all" ]]; then
  for u in "${SOURCE_USERS[@]}"; do
    "$0" "$u"
  done
  echo "Creadas/rotadas ${#SOURCE_USERS[@]} identidades de la fuente única." >&2
  exit 0
fi

USERNAME="$1"
PRINT_ONLY="${2:-}"

if ! is_declared "$USERNAME"; then
  echo "ERROR: '$USERNAME' no está declarado en infrastructure/mosquitto/identities.json." >&2
  echo "       La fuente única es la ÚNICA autoridad de identidad (MP0-A). Añádelo allí y" >&2
  echo "       regenera con 'node ${GEN}' antes de crear su contraseña." >&2
  echo "       Identidades declaradas: ${SOURCE_USERS[*]}" >&2
  exit 1
fi

GENERATED_PASSWORD="$(openssl rand -base64 24)"

run_mosquitto_passwd() {
  # $1 = args extra para mosquitto_passwd (después del fichero y usuario)
  if command -v mosquitto_passwd >/dev/null 2>&1; then
    local create_flag="-b"
    [[ -f "$PASSWD_FILE" ]] || create_flag="-c -b"
    # shellcheck disable=SC2086
    mosquitto_passwd $create_flag "$PASSWD_FILE" "$USERNAME" "$GENERATED_PASSWORD"
  else
    echo "mosquitto_passwd no está instalado localmente." >&2
    echo "Ejecuta en su lugar (con el stack ya levantado):" >&2
    echo "  docker compose exec mosquitto mosquitto_passwd -b /mosquitto/config/passwd '$USERNAME' '<password>'" >&2
    exit 2
  fi
}

run_mosquitto_passwd

# --------------------------------------------------------------------------
# Permisos y PROPIETARIO adecuados al proceso (gemelo de D6, comprobado).
#
# `chmod 600` a secas dejaba el passwd legible solo por el operador. El broker
# abre `password_file` DESPUES de dejar los privilegios de root y pasar a uid
# 1883, y en compose.yml el fichero se monta `:ro`, asi que el `chown -R
# mosquitto /mosquitto/config` del entrypoint de la imagen FALLA en silencio
# («Read-only file system»). Resultado observado con eclipse-mosquitto:2.0.18:
#   Error: Unable to open pwfile "/mosquitto/config/passwd"  ->  Exited(13)
#
# La correccion NO es relajar a 0644 —ahi hay hashes de contrasena—, sino dar
# el fichero al uid del broker manteniendolo en 0600. Eso exige privilegios que
# este script no tiene por que tener: si no puede, lo dice con el comando
# exacto en vez de dejar un despliegue que muere al arrancar.
# --------------------------------------------------------------------------
BROKER_UID="${MOSQUITTO_UID:-1883}"
BROKER_GID="${MOSQUITTO_GID:-1883}"
chmod 600 "$PASSWD_FILE"
if chown "${BROKER_UID}:${BROKER_GID}" "$PASSWD_FILE" 2>/dev/null; then
  :
elif chgrp "$BROKER_GID" "$PASSWD_FILE" 2>/dev/null && chmod 640 "$PASSWD_FILE"; then
  :
fi
# Se comprueba el EFECTO, no que el chown haya devuelto 0.
PASSWD_UID="$(stat -c '%u' "$PASSWD_FILE")"
PASSWD_GID="$(stat -c '%g' "$PASSWD_FILE")"
PASSWD_MODE="$(stat -c '%a' "$PASSWD_FILE")"
if [[ "$PASSWD_UID" != "$BROKER_UID" ]] &&
   ! { [[ "$PASSWD_GID" == "$BROKER_GID" ]] && [[ "$(( 8#${PASSWD_MODE} & 8#0040 ))" -ne 0 ]]; }; then
  echo "AVISO: $PASSWD_FILE queda como uid=${PASSWD_UID} gid=${PASSWD_GID} modo=${PASSWD_MODE}." >&2
  echo "       El broker corre con uid ${BROKER_UID} y lo monta en solo lectura: NO podra abrirlo" >&2
  echo "       y arrancara con «Unable to open pwfile» / Exited(13). Ejecuta antes del despliegue:" >&2
  echo "         sudo chown ${BROKER_UID}:${BROKER_GID} '${PASSWD_FILE}' && sudo chmod 600 '${PASSWD_FILE}'" >&2
fi

echo "Usuario '$USERNAME' creado/actualizado en $PASSWD_FILE" >&2
if [[ "$PRINT_ONLY" == "--print-only" ]]; then
  echo "Contraseña generada (guárdala ahora, no se repite): $GENERATED_PASSWORD"
else
  echo "Contraseña generada (guárdala en tu gestor de secretos, no se repite):" >&2
  echo "$GENERATED_PASSWORD"
fi

if [[ "$USERNAME" == "backend" ]]; then
  echo "Recuerda actualizar MQTT_BACKEND_PASSWORD en tu .env (no en .env.example)." >&2
elif [[ "$USERNAME" == "healthcheck" ]]; then
  : # sin recordatorio adicional: healthcheck no tiene module_id ni client_id relevante
else
  echo "Recuerda (F-02): con use_username_as_clientid true el broker fuerza el" \
       "client_id al usuario autenticado ('${USERNAME}'), así que el firmware/simulador" \
       "puede conectar con cualquier client_id — el broker lo sobrescribirá con" \
       "'${USERNAME}' de todas formas. Da igual qué client_id declare el cliente." >&2
fi
