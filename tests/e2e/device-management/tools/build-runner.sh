#!/usr/bin/env bash
# ==============================================================================
# Compila el DISPOSITIVO del carril E2E-3: el firmware D1b en HOST.
# ==============================================================================
# Compila `diana_core` entero (la logica de negocio real del firmware) contra la
# HAL de host y el runner de larga vida `test_host/e2e/prov_runner.c`.
#
# Se excluye `test_host/main.c` (tiene su propio main() y arrastraria la suite
# entera) y `test_host/tests/*.c`. Las banderas son LAS MISMAS que las de
# `firmware/Makefile` —incluido `-Werror`— a proposito: compilar el dispositivo
# del E2E con menos rigor que el firmware seria medir otra cosa.
#
# Sale con rc!=0 y sin binario si algo falla. El arnes comprueba el EFECTO (que
# el binario existe y responde), no el rc a secas.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../../../.." && pwd)"
FW="${ROOT}/firmware/esp32"
CORE="${FW}/components/diana_core"
HALDIR="${FW}/components/diana_hal"
HOST="${FW}/test_host"
OUT="${1:-${HERE}/../.build/prov_runner}"

CC="${CC:-gcc}"
CFLAGS=(-std=c11 -Wall -Wextra -Werror -Wshadow -Wconversion -Wno-sign-conversion -O1 -g
        -I"${CORE}/include" -I"${HALDIR}/include" -I"${HOST}" -I"${FW}/boards")

mkdir -p "$(dirname "${OUT}")"

# shellcheck disable=SC2046  # la expansion en palabras es lo que se quiere aqui
"${CC}" "${CFLAGS[@]}" \
  $(ls "${CORE}"/src/*.c) \
  "${HOST}/hal_host.c" \
  "${HOST}/e2e/prov_runner.c" \
  -o "${OUT}" -lm

test -x "${OUT}" || { echo "build-runner: no se produjo ${OUT}" >&2; exit 1; }
echo "${OUT}"
