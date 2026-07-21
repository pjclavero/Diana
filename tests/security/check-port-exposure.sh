#!/usr/bin/env bash
# S-03 · Exposición de puertos del stack.
#
# Comprueba, sobre el `docker compose config` YA RESUELTO, que sólo el proxy
# publica puertos al host y que PostgreSQL NO es accesible desde fuera del stack
# (I-06). NO levanta el stack: es un análisis estático de la configuración, apto
# para correr en cualquier sitio con `docker compose` (aunque no haya demonio).
#
# Uso:  tests/security/check-port-exposure.sh
# Sale con código != 0 si encuentra una exposición no permitida.

set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  cp .env.example .env
fi

# Servicios a los que SÍ se les permite publicar puertos al host:
#   - proxy: panel HTTP.
#   - mosquitto: los módulos son dispositivos físicos externos y se conectan al
#     broker por red, así que su puerto MQTT debe estar publicado (por diseño).
#   - cadvisor: monitorización opcional (perfil monitoring).
# La invariante DURA es que PostgreSQL nunca se publica (I-06), comprobada aparte.
ALLOWED_PUBLISHERS="proxy mosquitto cadvisor"

config="$(docker compose --profile monitoring config)"

# Extrae, del config resuelto, las líneas 'published:' con su servicio.
# `docker compose config` normaliza los puertos a formato largo.
violations=0
current_service=""
while IFS= read -r line; do
  if [[ "$line" =~ ^\ \ ([a-z0-9_-]+):$ ]]; then
    current_service="${BASH_REMATCH[1]}"
  fi
  if [[ "$line" =~ published:\ *\"?([0-9]+) ]]; then
    port="${BASH_REMATCH[1]}"
    if ! grep -qw "$current_service" <<<"$ALLOWED_PUBLISHERS"; then
      echo "VIOLACIÓN: el servicio '$current_service' publica el puerto $port al host."
      violations=$((violations + 1))
    fi
  fi
done <<<"$config"

# PostgreSQL nunca debe publicar puertos.
if grep -A30 '^  postgres:' <<<"$config" | grep -q 'published:'; then
  echo "VIOLACIÓN: 'postgres' publica puertos al host (debe ser sólo interno)."
  violations=$((violations + 1))
fi

if [ "$violations" -ne 0 ]; then
  echo "Exposición de puertos: $violations problema(s)."
  exit 1
fi
echo "OK: sólo los servicios permitidos ($ALLOWED_PUBLISHERS) publican puertos."
