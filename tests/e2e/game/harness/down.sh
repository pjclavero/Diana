#!/usr/bin/env bash
# ==============================================================================
# Diana · E2E-1 GAME — derriba el escenario efímero.
# ==============================================================================
# Sólo borra lo que up.sh creó, por nombre exacto. Nunca `docker system prune`,
# nunca `git clean`, nunca `shred`.
# ==============================================================================
set -uo pipefail

for c in diana-e2egame-backend diana-e2egame-mosquitto diana-e2egame-postgres; do
  docker rm -f "$c" >/dev/null 2>&1
done
docker network rm diana-e2egame-net >/dev/null 2>&1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "${HERE}/../.tmp"
echo "[down] escenario retirado" >&2
