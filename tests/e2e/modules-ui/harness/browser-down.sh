#!/usr/bin/env bash
# Diana · E2E MODULES-UI — retira el contenedor del navegador. Nombre exacto.
set -uo pipefail
docker rm -f diana-e2emodui-browser >/dev/null 2>&1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -f "${HERE}/../.tmp/browser-ws"
echo "[browser] retirado" >&2
