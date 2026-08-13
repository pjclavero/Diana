#!/usr/bin/env bash
# ==============================================================================
# Diana · verify-restore.sh — ensayo de restauración REAL, aislado y desechable
# ==============================================================================
# Demuestra la cadena completa, no sólo que el script de backup "no peta":
#
#   MARCADORES → DISPARO DEL PLANIFICADOR REAL → RESTAURACIÓN → DATOS VERIFICADOS
#
# Qué NO hace, a propósito:
#   - NO toca la pila de producción: no la para, no la reinicia, no escribe en
#     su base de datos. Sólo LEE una copia ya existente del volumen `diana_backups`.
#   - NO restaura jamás sobre la base de origen: crea un PostgreSQL desechable.
#
# Qué SÍ hace:
#   1. Levanta un PostgreSQL desechable y lo siembra con la ÚLTIMA COPIA
#      AUTOMÁTICA real de producción (así el ensayo corre sobre el esquema y los
#      datos de verdad, no sobre un fixture inventado).
#   2. Inserta filas marcadoras identificables en games/rounds/participants/
#      hit_events/shot_counts.
#   3. Levanta una instancia desechable del PLANIFICADOR REAL
#      (infrastructure/docker/cron-loop-entrypoint.sh + este backup.sh, los
#      mismos ficheros que usa producción) con RUN_ON_START=0 y una expresión
#      cron unos minutos por delante: la copia la tiene que disparar el
#      planificador, no el operador.
#   4. Restaura esa copia automática en un SEGUNDO PostgreSQL desechable con el
#      restore.sh real.
#   5. Verifica marcadores, autoridad (users/roles/hashes), módulos, partidas,
#      hits/shots, esquema, índices, constraints (comprobando que están VIVAS,
#      no sólo declaradas) y enums, y compara la huella completa origen/destino.
#   6. CONTROL POSITIVO: repite la verificación contra una copia truncada y
#      contra una copia vacía. Si esas NO fallan, el ensayo no vale nada y este
#      script termina en error.
#
# Uso (en la VM que tiene el Docker de Diana):
#   sudo ./verify-restore.sh
#
# Limpia todo lo que crea al terminar (contenedores, volúmenes y red `h6net`).
# ==============================================================================
set -euo pipefail

IMAGE="${VERIFY_PG_IMAGE:-postgres:16.4-alpine}"
NET="${VERIFY_NET:-diana-verify-net}"
PROD_VOLUME="${VERIFY_PROD_VOLUME:-diana_backups}"
REPO_DIR="${VERIFY_REPO_DIR:-/opt/diana}"
SRC=verify-src DST=verify-dst SCHED=verify-sched
VOL=verify-backups
MARK="verify-$(date -u +%s)"

cleanup() {
    docker rm -f "$SRC" "$DST" "$SCHED" >/dev/null 2>&1 || true
    docker volume rm "$VOL" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_pg() {  # wait_pg <contenedor> <db>
    for _ in $(seq 1 90); do
        docker exec "$1" psql -U diana_app -d "$2" -c 'select 1' >/dev/null 2>&1 && return 0
        sleep 2
    done
    echo "ERROR: $1 no llegó a aceptar conexiones" >&2; return 1
}

q() { docker exec "$1" psql -U diana_app -d "$2" -At -c "$3" 2>/dev/null || echo ERR; }

# --- 0. la copia automática más reciente de producción (sólo lectura) ---------
LATEST="$(docker run --rm -v "${PROD_VOLUME}":/backups:ro "$IMAGE" \
            sh -c 'ls -1 /backups/daily/diana_*.sql.gz | sort | tail -1')"
echo "[verify] semilla = copia automática de producción: $LATEST"

cleanup
docker network create "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

# --- 1. origen desechable, sembrado con datos reales -------------------------
docker run -d --name "$SRC" --network "$NET" --network-alias postgres \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=diana -e POSTGRES_USER=diana_app \
    "$IMAGE" >/dev/null
wait_pg "$SRC" diana
docker run --rm -v "${PROD_VOLUME}":/prod:ro -v "$VOL":/backups "$IMAGE" \
    cp "/prod/${LATEST#/backups/}" /backups/seed.sql.gz
docker cp "$(docker volume inspect "$VOL" -f '{{.Mountpoint}}')/seed.sql.gz" "$SRC:/tmp/seed.sql.gz"
docker exec "$SRC" sh -c 'gunzip -c /tmp/seed.sql.gz | psql -U diana_app -d diana -q -v ON_ERROR_STOP=1' >/dev/null
docker exec "$SRC" rm -f /tmp/seed.sql.gz

# --- 2. marcadores ------------------------------------------------------------
MODE_ID="$(q "$SRC" diana "select id from game_modes limit 1")"
docker exec -i "$SRC" psql -U diana_app -d diana -v ON_ERROR_STOP=1 <<SQL >/dev/null
BEGIN;
INSERT INTO target_systems (id,slug,name,updated_at)
 VALUES ('11111111-0000-4000-8000-000000000001','${MARK}-sys','${MARK} SYS',now());
INSERT INTO games (id,target_system_id,game_mode_id,name,status,config,created_by,updated_at,join_code)
 VALUES ('11111111-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000001',
         '${MODE_ID}','${MARK}-game','draft','{"marker":"${MARK}"}'::jsonb,'verify',now(),'VRF0000000000001');
INSERT INTO rounds (id,game_id,round_index,mode,updated_at)
 VALUES ('11111111-0000-4000-8000-000000000003','11111111-0000-4000-8000-000000000002',1,'${MARK}-mode',now());
INSERT INTO participants (id,game_id,round_id,slot,guest_name,updated_at)
 VALUES ('11111111-0000-4000-8000-000000000004','11111111-0000-4000-8000-000000000002',
         '11111111-0000-4000-8000-000000000003',1,'${MARK}-player',now());
INSERT INTO shot_counts (id,participant_id,initial_ammo,shots_fired,recorded_by)
 VALUES ('11111111-0000-4000-8000-000000000005','11111111-0000-4000-8000-000000000004',42,7,'${MARK}');
INSERT INTO hit_events (id,event_id,system_slug,module_slug,target_index,game_id,round_id,participant_id,
   local_sequence,device_boot_id,device_uptime_us,device_event_us,received_at,amplitude,threshold,
   target_state_before,classification,firmware_version,counts_for_score,raw_payload)
 VALUES ('11111111-0000-4000-8000-000000000006','${MARK}-event','${MARK}-sys','${MARK}-mod',3,
   '11111111-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000003',
   '11111111-0000-4000-8000-000000000004',777777,'11111111-0000-4000-8000-0000000000aa',
   123456789,123456789,now(),4242,1000,'active','valid_hit','${MARK}-fw',true,'{"marker":"${MARK}"}'::jsonb);
COMMIT;
SQL
echo "[verify] marcadores insertados en el origen desechable ($MARK)"

# --- 3. disparo por el PLANIFICADOR REAL (RUN_ON_START=0) --------------------
NOW_M=$(date -u +%-M); NOW_H=$(date -u +%-H)
TM=$(( (NOW_M + 3) % 60 )); TH=$NOW_H
[ $((NOW_M + 3)) -ge 60 ] && TH=$(( (NOW_H + 1) % 24 ))
echo "[verify] armando el planificador real para las ${TH}:${TM} UTC (RUN_ON_START=0)"
docker run -d --name "$SCHED" --network "$NET" \
    -e CRON_SCHEDULE="$TM $TH * * *" -e CRON_COMMAND=/scripts/backup.sh -e RUN_ON_START=0 \
    -e PGHOST=postgres -e PGUSER=diana_app -e PGDATABASE=diana -e BACKUP_ROOT=/backups -e TZ=UTC \
    -v "$VOL":/backups \
    -v "${REPO_DIR}/infrastructure/backups/backup.sh":/scripts/backup.sh:ro \
    -v "${REPO_DIR}/infrastructure/docker/cron-loop-entrypoint.sh":/entrypoints/cron-loop-entrypoint.sh:ro \
    --entrypoint /entrypoints/cron-loop-entrypoint.sh "$IMAGE" >/dev/null

for _ in $(seq 1 40); do
    docker exec "$SCHED" sh -c 'ls /backups/daily/diana_*.sql.gz' >/dev/null 2>&1 && break
    sleep 10
done
AUTO="$(docker exec "$SCHED" sh -c 'ls -1 /backups/daily/diana_*.sql.gz | tail -1')" \
    || { echo "ERROR: el planificador NO disparó" >&2; exit 1; }
echo "[verify] copia generada AUTOMÁTICAMENTE: $AUTO"
docker logs "$SCHED" 2>&1 | sed 's/^/[sched] /'

# --- 4. restauración real en PostgreSQL aislado ------------------------------
docker run -d --name "$DST" --network "$NET" --network-alias pgdst \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=postgres -e POSTGRES_USER=diana_app \
    "$IMAGE" >/dev/null
wait_pg "$DST" postgres

restore_into() {  # restore_into <fichero> <db-destino> ; devuelve el rc de restore.sh
    docker run --rm --network "$NET" -v "$VOL":/backups \
        -v "${REPO_DIR}/infrastructure/backups/restore.sh":/scripts/restore.sh:ro \
        -e PGHOST=pgdst -e PGUSER=diana_app -e PGDATABASE=postgres \
        --entrypoint /scripts/restore.sh "$IMAGE" "$1" --target-db "$2" >/dev/null 2>&1
}

# --- 5. verificación ----------------------------------------------------------
verify() {  # verify <db> ; rc 0 = todo correcto
    local db="$1" fail=0
    chk() { if [ "$2" = "$3" ]; then printf 'PASS  %-38s %s\n' "$1" "$3"
            else printf 'FAIL  %-38s esperado=%s obtenido=%s\n' "$1" "$2" "$3"; fail=1; fi; }
    chk marcador.game        1 "$(q "$DST" "$db" "select count(*) from games where name='${MARK}-game'")"
    chk marcador.round       1 "$(q "$DST" "$db" "select count(*) from rounds where mode='${MARK}-mode'")"
    chk marcador.participant 1 "$(q "$DST" "$db" "select count(*) from participants where guest_name='${MARK}-player'")"
    chk marcador.hit_event   1 "$(q "$DST" "$db" "select count(*) from hit_events where event_id='${MARK}-event'")"
    chk marcador.shot_count  1 "$(q "$DST" "$db" "select count(*) from shot_counts where recorded_by='${MARK}'")"
    chk marcador.amplitud    4242 "$(q "$DST" "$db" "select amplitude from hit_events where event_id='${MARK}-event'")"
    chk marcador.jsonb       "$MARK" "$(q "$DST" "$db" "select config->>'marker' from games where name='${MARK}-game'")"
    for pair in \
        "autoridad.users:select count(*) from users" \
        "autoridad.roles:select count(*) from roles" \
        "autoridad.hashes:select count(*) from users where password_hash is not null and length(password_hash)>20" \
        "modulos:select count(*) from modules" \
        "migraciones:select count(*) from _prisma_migrations" \
        "tablas:select count(*) from information_schema.tables where table_schema='public'" \
        "indices:select count(*) from pg_indexes where schemaname='public'" \
        "constraints_pk:select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='p'" \
        "constraints_fk:select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='f'" \
        "enums:select count(distinct typname) from pg_type t join pg_enum e on e.enumtypid=t.oid"
    do
        chk "${pair%%:*}" "$(q "$SRC" diana "${pair#*:}")" "$(q "$DST" "$db" "${pair#*:}")"
    done
    # Las constraints tienen que estar VIVAS, no sólo declaradas.
    chk FK_viva 1 "$(docker exec "$DST" psql -U diana_app -d "$db" -At -c \
        "insert into rounds (id,game_id,round_index,mode,updated_at) values ('99999999-0000-4000-8000-000000000099','99999999-9999-4999-8999-999999999999',9,'orphan',now())" 2>&1 \
        | grep -c 'violates foreign key constraint' || true)"
    chk UNIQUE_vivo 1 "$(docker exec "$DST" psql -U diana_app -d "$db" -At -c \
        "insert into rounds (id,game_id,round_index,mode,updated_at) select '99999999-0000-4000-8000-000000000098',game_id,round_index,'dup',now() from rounds where mode='${MARK}-mode'" 2>&1 \
        | grep -c 'duplicate key value violates unique constraint' || true)"
    return $fail
}

echo "=== RESTAURACIÓN DE LA COPIA AUTOMÁTICA ==="
restore_into "$AUTO" verificada || { echo "ERROR: restore.sh falló sobre la copia automática" >&2; exit 1; }
verify verificada || { echo "RESULTADO: FALLO — la copia automática NO restaura correctamente" >&2; exit 1; }

echo "=== HUELLA COMPLETA origen vs restaurado ==="
fp() { docker exec "$1" psql -U diana_app -d "$2" -At -F'|' \
        -c "select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public' order by 1,2" \
        -c "select conrelid::regclass::text,conname,contype::text,pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace order by 1,2" \
        -c "select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by 1,2"; }
if diff <(fp "$SRC" diana) <(fp "$DST" verificada) >/dev/null; then
    echo "PASS  huella de esquema/constraints/índices IDÉNTICA"
else
    echo "FAIL  la huella difiere:"; diff <(fp "$SRC" diana) <(fp "$DST" verificada); exit 1
fi

# --- 6. CONTROL POSITIVO ------------------------------------------------------
# Si estas dos NO fallan, la verificación de arriba no demuestra nada.
echo "=== CONTROL POSITIVO (copia truncada y copia vacía: DEBEN fallar) ==="
docker exec "$SCHED" sh -c "SZ=\$(stat -c%s '$AUTO'); head -c \$((SZ/2)) '$AUTO' > /backups/ctrl-truncado.sql.gz; : | gzip -9 > /backups/ctrl-vacio.sql.gz"
for ctrl in ctrl-truncado ctrl-vacio; do
    if restore_into "/backups/${ctrl}.sql.gz" "${ctrl//-/_}" && verify "${ctrl//-/_}" >/dev/null 2>&1; then
        echo "FAIL  el control positivo '${ctrl}' pasó la verificación: el ensayo NO es válido" >&2
        exit 1
    fi
    echo "PASS  control positivo '${ctrl}' rechazado como debía"
done

echo
echo "RESULTADO: COPIA PROGRAMADA → RESTAURACIÓN REAL → DATOS VERIFICADOS"
