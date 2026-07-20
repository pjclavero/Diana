#!/usr/bin/env bash
#
# Runner de la suite de firmware en host. Una sola orden, sin ESP-IDF ni
# hardware: compila diana_core contra el HAL de simulacion, ejecuta todas las
# pruebas y valida los mensajes generados contra los JSON Schema congelados.
#
#   ./firmware/esp32/tools/run_host_tests.sh
#
# Equivalente a `make -C firmware test`. Salida 0 si todo pasa.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../../.." && pwd)"

echo "repositorio: ${REPO}"
echo "compilador:  $(gcc --version | head -1)"
echo

exec make -C "${REPO}/firmware" test
