#!/usr/bin/env bash
# ==============================================================================
# Diana · set-coordinator.sh — activa/reasigna/desactiva el rol de coordinador
# (módulo PRINCIPAL, dosier §6.3) en infrastructure/mosquitto/acl.
# ==============================================================================
# El coordinador es UNO DE LOS MÓDULOS (elegido por selector físico, no
# hardware aparte — dosier requisitos 11/12). El módulo con ese rol necesita
# permiso de escritura sobre module/+/command, system/+/game/state y
# system/+/game/event, que el patrón %c genérico no puede expresar porque el
# rol es una asignación de despliegue, no una propiedad del module_id.
#
# Este script es el ÚNICO mecanismo soportado para tocar ese permiso: reescribe
# de forma idempotente el contenido entre los marcadores
#   # >>> COORDINATOR-BLOCK (generado por set-coordinator.sh; no editar a mano)
#   # <<< COORDINATOR-BLOCK
# de infrastructure/mosquitto/acl, y dentro de esos marcadores no hay que
# recordar nada a mano: pasar un module_id nuevo REEMPLAZA el bloque entero
# (nunca añade uno segundo), así que reasignar el rol es una sola invocación,
# no "quitar el bloque viejo y añadir el nuevo". Nunca deja el bloque
# comentado-pero-editable: o está activo con un module_id concreto, o está en
# el estado inactivo explícito (mismo texto que trae el repo en git).
#
# Uso:
#   ./set-coordinator.sh <module_id>   # activa/reasigna el coordinador
#   ./set-coordinator.sh --none        # desactiva (estado seguro, el de git)
#   ./set-coordinator.sh --show        # imprime el module_id activo, o "ninguno"
#
# Tras cualquier cambio hace falta recargar mosquitto para que la ACL se
# releea: `docker compose kill -s HUP mosquitto` (soporta reload en caliente,
# sin desconectar clientes) o `docker compose restart mosquitto`.
#
# module_id debe cumplir ^[a-z0-9][a-z0-9-]{2,62}$ (contracts/mqtt/README.md
# sección 1), igual que exige generate-users.sh para el nombre de usuario.
#
# F-02 (crítico, cerrado): el usuario del bloque de coordinador ya NO lleva
# el prefijo "module-" — es EXACTAMENTE el module_id, igual que cualquier
# otro usuario de módulo (ver generate-users.sh y mosquitto.conf,
# use_username_as_clientid). Antes de este cambio ya autorizaba por usuario
# (no por %c), así que este bloque nunca fue vulnerable a F-02; el ajuste es
# sólo de nomenclatura, para que el usuario de coordinador siga existiendo
# de verdad en el passwd generado por generate-users.sh.
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
ACL_FILE="${SCRIPT_DIR}/acl"
START_MARKER="# >>> COORDINATOR-BLOCK (generado por set-coordinator.sh; no editar a mano)"
END_MARKER="# <<< COORDINATOR-BLOCK"
INACTIVE_LINE="# (inactivo: ejecuta ./set-coordinator.sh <module_id> para activarlo)"

usage() {
  echo "Uso: $0 <module_id> | --none | --show" >&2
  exit 1
}

[[ $# -eq 1 ]] || usage
ARG="$1"

[[ -f "$ACL_FILE" ]] || { echo "ERROR: no existe $ACL_FILE" >&2; exit 1; }
grep -qF "$START_MARKER" "$ACL_FILE" || {
  echo "ERROR: no se encuentra el marcador COORDINATOR-BLOCK en $ACL_FILE." \
       "¿Se ha movido o reescrito el fichero a mano?" >&2
  exit 1
}

current_block() {
  awk -v start="$START_MARKER" -v end="$END_MARKER" \
    '$0==start{f=1;next} $0==end{f=0} f' "$ACL_FILE"
}

if [[ "$ARG" == "--show" ]]; then
  CUR="$(current_block | grep -E '^user ' | sed -E 's/^user //' || true)"
  if [[ -z "$CUR" ]]; then
    echo "ninguno (coordinador inactivo)"
  else
    echo "$CUR"
  fi
  exit 0
fi

if [[ "$ARG" == "--none" ]]; then
  NEW_BODY="$INACTIVE_LINE"
  DESC="desactivado (estado seguro)"
else
  MODULE_ID="$ARG"
  if [[ ! "$MODULE_ID" =~ ^[a-z0-9][a-z0-9-]{2,62}$ ]]; then
    echo "ERROR: module_id '$MODULE_ID' no cumple ^[a-z0-9][a-z0-9-]{2,62}\$" \
         "(contracts/mqtt/README.md sección 1)." >&2
    exit 1
  fi
  if [[ "$MODULE_ID" == "backend" || "$MODULE_ID" == "system" || "$MODULE_ID" == "healthcheck" ]]; then
    echo "ERROR: '$MODULE_ID' es un module_id reservado, no puede ser coordinador." >&2
    exit 1
  fi
  NEW_BODY="user ${MODULE_ID}
topic write targets/v1/module/+/command
topic write targets/v1/system/+/game/state
topic write targets/v1/system/+/game/event"
  DESC="activado para module_id='${MODULE_ID}' (usuario ${MODULE_ID})"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

awk -v start="$START_MARKER" -v end="$END_MARKER" -v body="$NEW_BODY" '
  $0 == start { print; print body; skip=1; next }
  $0 == end   { print; skip=0; next }
  skip { next }
  { print }
' "$ACL_FILE" > "$TMP"

# Verificación: el nuevo fichero debe seguir teniendo exactamente un bloque.
[[ "$(grep -cF "$START_MARKER" "$TMP")" -eq 1 ]] || {
  echo "ERROR interno: la reescritura no dejó exactamente un marcador de inicio." >&2
  exit 1
}

mv "$TMP" "$ACL_FILE"
trap - EXIT

echo "Coordinador ${DESC} en $ACL_FILE." >&2
echo "Recarga mosquitto para aplicar: docker compose kill -s HUP mosquitto" \
     "(o 'docker compose restart mosquitto')." >&2
