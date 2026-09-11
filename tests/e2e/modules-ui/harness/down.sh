#!/usr/bin/env bash
# ==============================================================================
# Diana · E2E MODULES-UI — derriba el escenario efímero.
# ==============================================================================
# Sólo borra lo que up.sh creó, por nombre exacto. Nunca `docker system prune`,
# nunca `git clean`, nunca `shred`.
# ==============================================================================
set -uo pipefail

for c in diana-e2emodui-frontend diana-e2emodui-backend \
         diana-e2emodui-mosquitto diana-e2emodui-postgres; do
  docker rm -f "$c" >/dev/null 2>&1
done
docker network rm diana-e2emodui-net >/dev/null 2>&1
# El volumen de credenciales, por nombre exacto. Es efimero de este carril.
docker volume rm -f diana-e2emodui-credentials >/dev/null 2>&1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "${HERE}/../.tmp"
echo "[down] escenario retirado" >&2
