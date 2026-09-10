#!/usr/bin/env bash
# ==============================================================================
# Diana · E2E MODULES-UI — el NAVEGADOR, en un contenedor efímero
# ==============================================================================
# POR QUÉ NO SE USA EL CHROMIUM DEL HOST, y esto no es un rodeo: esta máquina no
# tiene las bibliotecas del sistema que Chromium necesita (libnss3, libatk,
# libcups, libasound…) y NO hay `sudo` para instalarlas. MEDIDO:
#
#   ldd ~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome | grep 'not found'
#     → libnss3.so, libnspr4.so, libatk-1.0.so.0, libatk-bridge-2.0.so.0,
#       libatspi.so.0, libcups.so.2, libcairo.so.2, libpango-1.0.so.0,
#       libasound.so.2, libXdamage.so.1, libxkbcommon.so.0, libnssutil3.so,
#       libsmime3.so   (13 bibliotecas)
#
# El propio Playwright lo dice: «Host system is missing dependencies to run
# browsers». Así que el navegador se ejecuta donde SÍ tiene sus dependencias:
# la imagen oficial `mcr.microsoft.com/playwright:v1.48.2-jammy`, que trae
# EXACTAMENTE la versión de Playwright que este repositorio fija en
# `tests/e2e/package.json` (1.48.2) y su Chromium correspondiente.
#
# SIGUE SIENDO UN NAVEGADOR REAL. No es un simulador ni un DOM emulado: es el
# mismo Chromium que usaría cualquiera, hablando el mismo protocolo, cargando
# el mismo bundle servido por el mismo nginx.
#
# `--network host` es lo que hace que las URL HORNEADAS en el bundle
# (http://127.0.0.1:13087 y el panel en 127.0.0.1:18087) sigan siendo válidas
# dentro del contenedor: con docker rootless, ese modo comparte el espacio de
# red donde viven los puertos publicados. COMPROBADO por efecto antes de
# adoptarlo:
#     docker run --rm --network host alpine wget -qO- http://127.0.0.1:13087/api/health
#     → {"status":"ok"}
# Sin eso habría que reescribir las URL del bundle, y entonces el artefacto
# probado dejaría de ser el que se despliega.
#
# Uso:   ./browser-up.sh     → deja el servidor escuchando y escribe la URL ws
#        ./browser-down.sh   → lo retira
# ==============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(cd "${HERE}/.." && pwd)/.tmp"
NAME=diana-e2emodui-browser
IMAGE="${DIANA_E2E_BROWSER_IMAGE:-mcr.microsoft.com/playwright:v1.48.2-jammy}"
PORT="${DIANA_E2E_BROWSER_PORT:-13399}"

[[ -d "${TMP}" ]] || { echo "ERROR: falta ${TMP}. Ejecuta antes ./up.sh" >&2; exit 1; }

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "ERROR: no existe la imagen ${IMAGE}." >&2
  echo "  Descárgala primero:  docker pull ${IMAGE}" >&2
  exit 1
fi

docker rm -f "${NAME}" >/dev/null 2>&1 || true

# El servidor se arranca con el Playwright DEL REPOSITORIO (1.48.2, el que fija
# `tests/e2e/package.json`), montado en solo lectura, y con los navegadores que
# trae la imagen (`/ms-playwright`). NO se usa `npx playwright`: eso se
# descargaría la última versión de la red (medido: arrancó un servidor 1.63 y
# el cliente 1.48 lo rechazó con «Playwright version mismatch»), y entonces el
# navegador no sería el que esta suite declara.
E2E_DIR="$(cd "${HERE}/../.." && pwd)"
[[ -d "${E2E_DIR}/node_modules/playwright" ]] || {
  echo "ERROR: falta ${E2E_DIR}/node_modules/playwright." >&2
  echo "  Instala las dependencias primero: (cd ${E2E_DIR} && npm install --no-save --no-package-lock)" >&2
  exit 1
}

docker run -d --name "${NAME}" --network host --ipc=host --user pwuser \
  -v "${E2E_DIR}/node_modules:/pw/node_modules:ro" \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  "${IMAGE}" \
  node /pw/node_modules/playwright/cli.js run-server --port "${PORT}" --host 127.0.0.1 >/dev/null

# Espera POR EFECTO: que el 13399 acepte conexiones. No un `sleep`.
for i in $(seq 1 60); do
  state="$(docker inspect -f '{{.State.Status}}' "${NAME}")"
  if [[ "${state}" != "running" ]]; then
    echo "ERROR: el servidor de navegador salió (${state}):" >&2
    docker logs "${NAME}" 2>&1 | tail -30 >&2
    exit 1
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then break; fi
  [[ $i -eq 60 ]] && {
    echo "ERROR: el servidor de navegador no abrió el ${PORT}." >&2
    docker logs "${NAME}" 2>&1 | tail -30 >&2
    exit 1
  }
  sleep 1
done

printf 'ws://127.0.0.1:%s/\n' "${PORT}" > "${TMP}/browser-ws"
chmod 600 "${TMP}/browser-ws"
echo "[browser] servidor en ws://127.0.0.1:${PORT}/ (imagen ${IMAGE})" >&2
