#!/usr/bin/env bash
# =============================================================================
# Diana · OBSERVADOR del primer modulo fisico
# =============================================================================
# Para el momento en que el carril firmware conecte el ESP32. Mira, y NO toca:
# no publica presencia, no publica impactos, no escribe en la base. Si este
# script pudiera hacer que un modulo apareciese ONLINE, no serviria para
# comprobar que ha aparecido ONLINE.
#
# La autoridad es PostgreSQL. Un mensaje MQTT en vuelo no es un efecto: lo que
# cuenta es la fila. Por eso se consulta la base y no se escucha el broker.
#
# Uso:
#   scripts/bench/observar-primer-modulo.sh [slug]      (por defecto module-01)
#   INTERVALO=2 scripts/bench/observar-primer-modulo.sh
#
# Sale con Ctrl-C. No tiene efectos secundarios que deshacer.
# =============================================================================
set -uo pipefail
export LC_ALL=C

SLUG="${1:-module-01}"
INTERVALO="${INTERVALO:-3}"
PG="${DIANA_PG_CONTAINER:-mp0-integration-postgres-1}"
DB="${POSTGRES_DB:-diana}"
USUARIO="${POSTGRES_USER:-diana}"

consulta() {
  docker exec "$PG" psql -qtAX -U "$USUARIO" -d "$DB" -c "$1" 2>/dev/null
}

if ! consulta 'select 1' >/dev/null; then
  echo "ERROR: no se puede consultar PostgreSQL en el contenedor '$PG'." >&2
  echo "  Ajusta DIANA_PG_CONTAINER / POSTGRES_USER / POSTGRES_DB." >&2
  exit 1
fi

estado() {
  consulta "select coalesce(online::text,'?')||'|'||coalesce(last_seen_at::text,'NULL')
            ||'|'||coalesce(firmware_version,'NULL')||'|'||coalesce(boot_id::text,'NULL')
            ||'|'||desired_config_version||'|'||coalesce(reported_config_version::text,'NULL')
            ||'|'||config_state||'|'||coalesce(ip,'NULL')
            from modules where slug='${SLUG}';"
}
impactos() { consulta "select count(*) from hit_events where module_slug='${SLUG}';"; }
ultimo_impacto() {
  consulta "select event_id||'|t'||target_index||'|seq='||local_sequence||'|'||received_at
            from hit_events where module_slug='${SLUG}' order by received_at desc limit 1;"
}
incidencias() {
  consulta "select count(*) from incidents i join modules m on m.id=i.module_id
            where m.slug='${SLUG}' and i.occurred_at > now() - interval '10 minutes';"
}

sello() { date -u '+%H:%M:%SZ'; }

if [ -z "$(estado)" ]; then
  echo "ERROR: no existe ningun modulo con slug '${SLUG}' en la base." >&2
  echo "  Dalo de alta primero: el backend DESCARTA la presencia de un modulo" >&2
  echo "  desconocido y registra una incidencia 'presence_unknown_module'." >&2
  exit 1
fi

echo "== observando '${SLUG}' cada ${INTERVALO}s · Ctrl-C para salir =="
echo "   columnas: online | ultima senal | firmware | boot | deseada | reportada | config | ip"
echo

previo=""; previo_hits="$(impactos)"
echo "[$(sello)] impactos ya registrados: ${previo_hits}"

while true; do
  actual="$(estado)"
  if [ "$actual" != "$previo" ]; then
    IFS='|' read -r on visto fw boot des rep cfg ip <<< "$actual"
    echo "[$(sello)] online=${on} · ultima=${visto} · fw=${fw} · boot=${boot} · deseada=${des} · reportada=${rep} · ${cfg} · ip=${ip}"
    # Los dos hitos que el encargo pide observar, nombrados en voz alta.
    if [ "$on" = "t" ] && [ "${previo%%|*}" != "t" ]; then
      echo "           *** EL MODULO HA PASADO A ONLINE. Es un mensaje real del dispositivo:"
      echo "               el backend no escribe online=true por ninguna otra via. ***"
    fi
    if [ "$rep" != "NULL" ] && [ "$rep" = "$des" ] && [ "$cfg" = "applied" ]; then
      echo "           *** CONFIGURACION APLICADA Y CONFIRMADA POR EL MODULO (v${rep}). ***"
    fi
    previo="$actual"
  fi

  hits="$(impactos)"
  if [ "$hits" != "$previo_hits" ]; then
    echo "[$(sello)] impactos: ${previo_hits} -> ${hits}"
    echo "           ultimo: $(ultimo_impacto)"
    if [ "$previo_hits" = "0" ] && [ "$hits" = "1" ]; then
      echo "           *** PRIMER IMPACTO E2E: fisico -> MQTT -> backend -> BD. ***"
      echo "               Comprueba que es EXACTAMENTE uno: un event_id repetido"
      echo "               no crea fila (indice unico), y eso es lo que se quiere."
    fi
    previo_hits="$hits"
  fi

  inc="$(incidencias)"
  [ "${inc:-0}" != "0" ] && echo "[$(sello)] AVISO: ${inc} incidencia(s) de este modulo en los ultimos 10 min"

  sleep "$INTERVALO"
done
