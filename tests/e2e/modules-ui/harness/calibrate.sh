#!/usr/bin/env bash
# ==============================================================================
# Diana · E2E MODULES-UI — CALIBRACIÓN: ¿puede esta prueba ponerse roja?
# ==============================================================================
# Una afirmación de seguridad no cuenta hasta que hay una prueba capaz de
# ponerse roja. Aquí se rompe el producto A PROPÓSITO, se comprueba que la
# rotura está EN EL ARTEFACTO EFECTIVAMENTE DESPLEGADO (con `grep` dentro de la
# imagen: el `dist` compilado, no el fuente), se mide, y se revierte.
#
# LA MUTACIÓN NO TOCA EL ÁRBOL DE TRABAJO. Se exporta una copia limpia con
# `git archive` a `.tmp/mut/`, se muta ALLÍ y se construye desde allí. Motivo:
# hay otro agente trabajando en `server/frontend/src/**` ahora mismo, y una
# medición sobre un árbol que otro proceso escribe no vale nada. Además, así la
# reversión es `rm -rf`, no un `git checkout` que podría llevarse trabajo ajeno.
#
# Uso:  ./calibrate.sh mut1     → la UI cuenta como ONLINE lo que nunca conectó
#       ./calibrate.sh mut2     → el backend sube config_version de dos en dos
#       ./calibrate.sh restore  → devuelve el escenario a las imágenes sanas
# ==============================================================================
set -euo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LANE_DIR="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${LANE_DIR}/../../.." && pwd)"
MUT_DIR="${LANE_DIR}/.tmp/mut"

BE_PORT="${DIANA_E2E_API_PORT:-13087}"
FE_PORT="${DIANA_E2E_WEB_PORT:-18087}"
NET=diana-e2emodui-net
BE=diana-e2emodui-backend
FE=diana-e2emodui-frontend

log() { printf '[calib] %s\n' "$*" >&2; }

# --- exporta una copia LIMPIA del árbol versionado (sin contaminación ajena)
exportar() { # $1 = subruta, $2 = destino
  rm -rf "$2"; mkdir -p "$2"
  git -C "${REPO_ROOT}" archive HEAD "$1" | tar -x -C "$2"
}

# --- grep DENTRO de la imagen: el artefacto que se sirve, no el fuente
grep_en_imagen() { # $1 imagen, $2 ruta dentro, $3 patrón
  docker run --rm --entrypoint grep "$1" -Rq -- "$3" "$2"
}

case "${1:-}" in
# ---------------------------------------------------------------------- mut1
mut1)
  # OBLIGATORIA por encargo: que la UI cuente como ONLINE un módulo que NUNCA
  # ha conectado. Se ataca `diagnosticarModulo`, la función que decide el
  # veredicto cuando no hay ninguna señal (`silencioMs === null`, `online`
  # falso): en vez de `pendiente`, devuelve `online`.
  D="${MUT_DIR}/fe"
  exportar server/frontend "${D}"
  F="${D}/server/frontend/src/utils/estadoModulo.ts"
  perl -0pi -e 's/      estado: "pendiente",\n      etiqueta: "pendiente",\n      motivo: "Registrado y todavía sin primera señal\. No ha llegado a conectarse nunca\.",/      estado: "online",\n      etiqueta: "en línea",\n      motivo: "MUT1-CUENTA-ONLINE-SIN-SENAL",/' "$F"
  grep -q 'MUT1-CUENTA-ONLINE-SIN-SENAL' "$F" || { echo "ERROR: la mutación 1 no se aplicó al fuente." >&2; exit 1; }
  log "mut1 aplicada al fuente exportado"

  docker build -q -f "${HERE}/Dockerfile.frontend.e2e" -t diana/frontend:e2emodules-mut1 \
    --build-arg VITE_API_MODE=real \
    --build-arg "VITE_API_BASE_URL=http://127.0.0.1:${BE_PORT}/api" \
    --build-arg "VITE_AUTH_BASE_URL=http://127.0.0.1:${BE_PORT}/api" \
    --build-arg "VITE_WS_URL=ws://127.0.0.1:${BE_PORT}/ws" \
    "${D}/server/frontend" >/dev/null

  # LA COMPROBACIÓN QUE EXIGE EL ENCARGO: la mutación está en el `dist` que
  # sirve nginx dentro de la imagen, no sólo en el fuente.
  grep_en_imagen diana/frontend:e2emodules-mut1 /usr/share/nginx/html/assets 'MUT1-CUENTA-ONLINE-SIN-SENAL' \
    || { echo "ERROR: la mutación 1 NO está en el dist desplegado." >&2; exit 1; }
  log "mut1 VERIFICADA dentro de la imagen (dist/assets)"

  docker rm -f "${FE}" >/dev/null 2>&1 || true
  docker run -d --name "${FE}" --network "${NET}" --network-alias frontend \
    -p "127.0.0.1:${FE_PORT}:8080" diana/frontend:e2emodules-mut1 >/dev/null
  for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:${FE_PORT}/" >/dev/null 2>&1 && break; sleep 1; done
  log "panel MUTADO servido en 127.0.0.1:${FE_PORT}"
  ;;

# ---------------------------------------------------------------------- mut2
mut2)
  # Segunda mutación, en la OTRA capa de evidencia: el backend sube la versión
  # deseada de dos en dos. La prueba mide ese número EN POSTGRESQL, así que si
  # no se pone roja es que no estaba midiendo nada.
  D="${MUT_DIR}/be"
  exportar . "${D}"
  F="${D}/server/backend/src/modules/modules/module-config.service.ts"
  perl -0pi -e 's/desiredConfigVersion: \{ increment: 1 \}/desiredConfigVersion: { increment: 2 }/' "$F"
  grep -q 'increment: 2' "$F" || { echo "ERROR: la mutación 2 no se aplicó al fuente." >&2; exit 1; }
  log "mut2 aplicada al fuente exportado"

  docker build -q -f "${D}/tests/e2e/game/harness/Dockerfile.e2e" \
    -t diana/backend:e2emodules-mut2 "${D}" >/dev/null

  grep_en_imagen diana/backend:e2emodules-mut2 /app/dist/modules/modules/module-config.service.js 'increment: 2' \
    || { echo "ERROR: la mutación 2 NO está en el dist desplegado." >&2; exit 1; }
  log "mut2 VERIFICADA dentro de la imagen (/app/dist)"

  # Se reemplaza SÓLO el backend, reutilizando su fichero de entorno (mismos
  # secretos, misma base de datos: el estado no se pierde).
  docker rm -f "${BE}" >/dev/null 2>&1 || true
  docker run -d --name "${BE}" --network "${NET}" --network-alias backend \
    --env-file "${LANE_DIR}/.tmp/backend.env" \
    -p "127.0.0.1:${BE_PORT}:3000" \
    -v "${LANE_DIR}/.tmp/certs/ca.crt:/app/certs/mqtt-ca.crt:ro" \
    diana/backend:e2emodules-mut2 >/dev/null
  for i in $(seq 1 90); do curl -fsS "http://127.0.0.1:${BE_PORT}/api/health" >/dev/null 2>&1 && break; sleep 1; done
  log "backend MUTADO en 127.0.0.1:${BE_PORT}"
  ;;

# ------------------------------------------------------------------- restore
restore)
  docker rm -f "${FE}" >/dev/null 2>&1 || true
  docker run -d --name "${FE}" --network "${NET}" --network-alias frontend \
    -p "127.0.0.1:${FE_PORT}:8080" diana/frontend:e2emodules >/dev/null
  docker rm -f "${BE}" >/dev/null 2>&1 || true
  docker run -d --name "${BE}" --network "${NET}" --network-alias backend \
    --env-file "${LANE_DIR}/.tmp/backend.env" \
    -p "127.0.0.1:${BE_PORT}:3000" \
    -v "${LANE_DIR}/.tmp/certs/ca.crt:/app/certs/mqtt-ca.crt:ro" \
    diana/backend:e2emodules >/dev/null
  for i in $(seq 1 90); do curl -fsS "http://127.0.0.1:${BE_PORT}/api/health" >/dev/null 2>&1 && break; sleep 1; done
  for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:${FE_PORT}/" >/dev/null 2>&1 && break; sleep 1; done
  rm -rf "${MUT_DIR}"
  log "imágenes SANAS restauradas y copias mutadas borradas"
  ;;

*)
  echo "Uso: $0 {mut1|mut2|restore}" >&2
  exit 2
  ;;
esac
