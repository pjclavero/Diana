#!/usr/bin/env bash
# ==============================================================================
# Diana · generación de usuarios/contraseñas de Mosquitto
# ==============================================================================
# Crea o actualiza una entrada en infrastructure/mosquitto/passwd usando
# mosquitto_passwd. NUNCA escribe contraseñas en claro en git: el fichero
# `passwd` está en .gitignore (ver /.gitignore, patrón `mosquitto/passwd`).
#
# Uso:
#   ./generate-users.sh backend                 # crea/rota el usuario del backend
#   ./generate-users.sh module-m1               # crea/rota un usuario de módulo
#   ./generate-users.sh module-m1 --print-only   # genera contraseña y la imprime
#                                                 # una sola vez, sin guardar eco
#
# Requisitos: el paquete `mosquitto-clients` (que trae mosquitto_passwd) debe
# estar disponible en el host o dentro del contenedor mosquitto:
#   docker compose run --rm mosquitto mosquitto_passwd ...
# Este script intenta usar el binario local si existe y, si no, delega en el
# contenedor mosquitto vía `docker compose exec`.
#
# Recuerda: el client_id MQTT que use el módulo en tiempo de ejecución debe
# ser EXACTAMENTE su module_id (sin el prefijo "module-"), porque la ACL
# (infrastructure/mosquitto/acl) usa el patrón %c para restringir el acceso
# al subárbol propio. El nombre de usuario mosquitto sí lleva el prefijo
# "module-{module_id}" tal como exige contracts/mqtt/README.md sección 8.
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

usage() {
  echo "Uso: $0 <usuario> [--print-only]" >&2
  echo "  usuario: 'backend', 'healthcheck' o 'module-{module_id}' (p.ej. module-m1)" >&2
  exit 1
}

[[ $# -ge 1 ]] || usage
USERNAME="$1"
PRINT_ONLY="${2:-}"

if [[ "$USERNAME" != "backend" && "$USERNAME" != "healthcheck" \
      && ! "$USERNAME" =~ ^module-[a-z0-9][a-z0-9-]{2,62}$ ]]; then
  echo "ERROR: el usuario debe ser 'backend', 'healthcheck' o 'module-{module_id}' con" \
       "module_id conforme a ^[a-z0-9][a-z0-9-]{2,62}\$ (contracts/mqtt/README.md sección 1)." >&2
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
chmod 600 "$PASSWD_FILE"

echo "Usuario '$USERNAME' creado/actualizado en $PASSWD_FILE" >&2
if [[ "$PRINT_ONLY" == "--print-only" ]]; then
  echo "Contraseña generada (guárdala ahora, no se repite): $GENERATED_PASSWORD"
else
  echo "Contraseña generada (guárdala en tu gestor de secretos, no se repite):" >&2
  echo "$GENERATED_PASSWORD"
fi

if [[ "$USERNAME" == "backend" ]]; then
  echo "Recuerda actualizar MQTT_BACKEND_PASSWORD en tu .env (no en .env.example)." >&2
else
  echo "Recuerda: el firmware/simulador debe conectar con client_id = '${USERNAME#module-}'" \
       "(module_id sin el prefijo 'module-') para que la ACL por patrón funcione." >&2
fi
