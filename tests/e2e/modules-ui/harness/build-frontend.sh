#!/usr/bin/env bash
# ==============================================================================
# Diana · E2E MODULES-UI — construye la imagen del PANEL en modo REAL
# ==============================================================================
# Vite hornea `import.meta.env.VITE_*` en el bundle: la URL del backend NO es
# configurable en tiempo de ejecución y por eso hay que pasarla aquí, con el
# mismo puerto que usará `up.sh`.
#
# El GUARDIÁN de `vite.config.ts` (que aborta una build de producción en modo
# `mock`) se deja INTACTO. Aquí se construye en `real`.
# ==============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../../.." && pwd)"

BE_PORT="${DIANA_E2E_API_PORT:-13087}"
FE_IMAGE="${DIANA_E2E_FRONTEND_IMAGE:-diana/frontend:e2emodules}"
API_ORIGIN="http://127.0.0.1:${BE_PORT}"

# `/api` al final a propósito: `typedRequest.baseOrigin()` se lo quita porque
# las rutas del contrato generado ya lo traen, y `authApi` lo concatena tal
# cual (`${VITE_AUTH_BASE_URL}/auth/login`).
docker build \
  -f "${HERE}/Dockerfile.frontend.e2e" \
  -t "${FE_IMAGE}" \
  --build-arg VITE_API_MODE=real \
  --build-arg "VITE_API_BASE_URL=${API_ORIGIN}/api" \
  --build-arg "VITE_AUTH_BASE_URL=${API_ORIGIN}/api" \
  --build-arg "VITE_WS_URL=ws://127.0.0.1:${BE_PORT}/ws" \
  "${REPO_ROOT}/server/frontend"

# Comprobación POR EFECTO sobre el artefacto EFECTIVAMENTE DESPLEGADO: el
# `dist` que hay dentro de la imagen, no el fuente ni el `dist` local.
if ! docker run --rm --entrypoint sh "${FE_IMAGE}" -c \
     "grep -Rql -- '${API_ORIGIN}' /usr/share/nginx/html/assets"; then
  echo "ERROR: el bundle desplegado no contiene ${API_ORIGIN}." >&2
  exit 1
fi
echo "[build-frontend] ${FE_IMAGE} lista y apuntando a ${API_ORIGIN}" >&2
