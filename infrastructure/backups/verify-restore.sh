#!/usr/bin/env bash
# ==============================================================================
# Diana · verify-restore.sh — ensayo de restauración REAL, aislado y desechable
# ==============================================================================
# Demuestra la cadena completa, no sólo que el script de backup «no peta»:
#
#   DATOS + MARCADORES → BACKUP REAL → RESTAURACIÓN AISLADA → DATOS VERIFICADOS
#
# Qué NO hace, a propósito:
#   - NO toca la pila de producción: no la para, no la reinicia y no escribe en
#     su base de datos ni en su volumen.
#   - NO restaura jamás sobre la base de origen: crea PostgreSQL desechables.
#
# Dos modos de semilla (VERIFY_SEED):
#   fixture  (por defecto) — siembra con tests/fixture-schema.sql. Se puede
#            ejecutar en CUALQUIER máquina con Docker, sin producción delante.
#   prod     — siembra un PostgreSQL desechable con la ÚLTIMA COPIA AUTOMÁTICA
#            real, leída en SÓLO LECTURA del volumen `diana_backups`. Es el
#            ensayo de mayor valor, pero exige estar en la VM de Diana.
#
# Opcional (VERIFY_USE_SCHEDULER=1): la copia la dispara el PLANIFICADOR REAL
# (infrastructure/docker/cron-loop-entrypoint.sh con RUN_ON_START=0 y una
# expresión cron unos minutos por delante), no el operador. Tarda varios
# minutos; por defecto se invoca backup.sh directamente.
#
# Uso:
#   ./verify-restore.sh                      # ensayo autocontenido
#   VERIFY_SEED=prod ./verify-restore.sh     # en la VM de Diana, semilla real
#   VERIFY_USE_SCHEDULER=1 ./verify-restore.sh
#
# Limpia todo lo que crea al terminar (contenedores, volumen y red efímeros).
# ==============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${VERIFY_REPO_DIR:-$(cd -- "${SCRIPT_DIR}/../.." && pwd)}"

IMAGE="${VERIFY_PG_IMAGE:-postgres:16.4-alpine}"
NET="${VERIFY_NET:-diana-verify-net}"
PROD_VOLUME="${VERIFY_PROD_VOLUME:-diana_backups}"
SEED_MODE="${VERIFY_SEED:-fixture}"
USE_SCHEDULER="${VERIFY_USE_SCHEDULER:-0}"

SRC=diana-verify-src DST=diana-verify-dst SCHED=diana-verify-sched
VOL=diana-verify-backups
MARK="verify-$(date -u +%s)"
PGUSER_T=diana_app

cleanup() {
    docker rm -f "$SRC" "$DST" "$SCHED" >/dev/null 2>&1 || true
    docker volume rm "$VOL" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_pg() {  # wait_pg <contenedor> <db>
    local i
    for i in $(seq 1 90); do
        docker exec "$1" psql -U "$PGUSER_T" -d "$2" -c 'select 1' >/dev/null 2>&1 && return 0
        sleep 2
    done
    echo "ERROR: $1 no llegó a aceptar conexiones" >&2
    return 1
}

q() { docker exec "$1" psql -U "$PGUSER_T" -d "$2" -At -c "$3" 2>/dev/null || echo ERR; }

echo "== verify-restore.sh =="
echo "   repo      : ${REPO_DIR}"
echo "   imagen    : ${IMAGE}"
echo "   semilla   : ${SEED_MODE}"
echo "   disparo   : $([ "$USE_SCHEDULER" = "1" ] && echo 'planificador real' || echo 'invocación directa de backup.sh')"

for f in infrastructure/backups/backup.sh infrastructure/backups/restore.sh; do
    [ -f "${REPO_DIR}/${f}" ] || { echo "ERROR: falta ${REPO_DIR}/${f}" >&2; exit 1; }
done

cleanup
docker network create "$NET" >/dev/null
docker volume create "$VOL" >/dev/null

# --- 1. origen desechable -----------------------------------------------------
docker run -d --name "$SRC" --network "$NET" --network-alias postgres \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=diana -e POSTGRES_USER="$PGUSER_T" \
    "$IMAGE" >/dev/null
wait_pg "$SRC" diana

if [ "$SEED_MODE" = "prod" ]; then
    # Sólo lectura sobre el volumen de producción. No se escribe nada en él.
    LATEST="$(docker run --rm -v "${PROD_VOLUME}":/backups:ro "$IMAGE" \
                sh -c 'ls -1 /backups/daily/diana_*.sql.gz | sort | tail -1')"
    echo "[verify] semilla = copia automática de producción: $LATEST"
    docker run --rm -v "${PROD_VOLUME}":/prod:ro -v "$VOL":/seed "$IMAGE" \
        cp "/prod/${LATEST#/backups/}" /seed/seed.sql.gz
    docker run --rm -v "$VOL":/seed --network "$NET" "$IMAGE" \
        sh -c "gunzip -c /seed/seed.sql.gz | psql -h postgres -U ${PGUSER_T} -d diana -q -v ON_ERROR_STOP=1" >/dev/null
    docker run --rm -v "$VOL":/seed "$IMAGE" rm -f /seed/seed.sql.gz
else
    echo "[verify] semilla = fixture autocontenido (tests/fixture-schema.sql)"
    docker cp "${SCRIPT_DIR}/tests/fixture-schema.sql" "$SRC:/tmp/fixture.sql"
    docker exec "$SRC" psql -U "$PGUSER_T" -d diana -q -v ON_ERROR_STOP=1 -f /tmp/fixture.sql >/dev/null
fi

# --- 2. marcadores identificables --------------------------------------------
# Si estos sobreviven al viaje completo, los datos han viajado de verdad.
docker exec -i "$SRC" psql -U "$PGUSER_T" -d diana -v ON_ERROR_STOP=1 <<SQL >/dev/null
BEGIN;
INSERT INTO target_systems (id,slug,name)
 VALUES ('11111111-0000-4000-8000-000000000001','${MARK}-sys','${MARK} SYS');
INSERT INTO games (id,target_system_id,name,status,config,join_code,created_by)
 VALUES ('11111111-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000001',
         '${MARK}-game','draft','{"marker":"${MARK}"}'::jsonb,'VRF0000000000001','verify');
INSERT INTO rounds (id,game_id,round_index,mode)
 VALUES ('11111111-0000-4000-8000-000000000003','11111111-0000-4000-8000-000000000002',1,'${MARK}-mode');
INSERT INTO participants (id,game_id,round_id,slot,guest_name)
 VALUES ('11111111-0000-4000-8000-000000000004','11111111-0000-4000-8000-000000000002',
         '11111111-0000-4000-8000-000000000003',1,'${MARK}-player');
INSERT INTO shot_counts (id,participant_id,initial_ammo,shots_fired,recorded_by)
 VALUES ('11111111-0000-4000-8000-000000000005','11111111-0000-4000-8000-000000000004',42,7,'${MARK}');
INSERT INTO hit_events (id,event_id,game_id,round_id,participant_id,local_sequence,
   amplitude,threshold,classification,counts_for_score,raw_payload)
 VALUES ('11111111-0000-4000-8000-000000000006','${MARK}-event',
   '11111111-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000003',
   '11111111-0000-4000-8000-000000000004',777777,4242,1000,'valid_hit',true,
   '{"marker":"${MARK}"}'::jsonb);
COMMIT;
SQL
echo "[verify] marcadores insertados en el origen desechable ($MARK)"

# --- 3. la copia la produce el backup.sh REAL --------------------------------
BACKUP_ENV=( -e PGHOST=postgres -e PGUSER="$PGUSER_T" -e PGDATABASE=diana
             -e BACKUP_ROOT=/backups -e TZ=UTC )
MOUNTS=( -v "$VOL":/backups
         -v "${REPO_DIR}/infrastructure/backups/backup.sh":/scripts/backup.sh:ro )

if [ "$USE_SCHEDULER" = "1" ]; then
    ENTRY="${REPO_DIR}/infrastructure/docker/cron-loop-entrypoint.sh"
    [ -f "$ENTRY" ] || { echo "ERROR: falta $ENTRY" >&2; exit 1; }
    NOW_M=$(date -u +%-M); NOW_H=$(date -u +%-H)
    TM=$(( (NOW_M + 3) % 60 )); TH=$NOW_H
    [ $((NOW_M + 3)) -ge 60 ] && TH=$(( (NOW_H + 1) % 24 ))
    echo "[verify] armando el planificador real para las ${TH}:${TM} UTC (RUN_ON_START=0)"
    docker run -d --name "$SCHED" --network "$NET" \
        -e CRON_SCHEDULE="$TM $TH * * *" -e CRON_COMMAND=/scripts/backup.sh -e RUN_ON_START=0 \
        "${BACKUP_ENV[@]}" "${MOUNTS[@]}" \
        -v "${ENTRY}":/entrypoints/cron-loop-entrypoint.sh:ro \
        --entrypoint /entrypoints/cron-loop-entrypoint.sh "$IMAGE" >/dev/null
    for _ in $(seq 1 40); do
        docker exec "$SCHED" sh -c 'ls /backups/daily/diana_*.sql.gz' >/dev/null 2>&1 && break
        sleep 10
    done
    docker logs "$SCHED" 2>&1 | sed 's/^/[sched] /'
else
    docker run --rm --name "$SCHED" --network "$NET" "${BACKUP_ENV[@]}" "${MOUNTS[@]}" \
        --entrypoint /scripts/backup.sh "$IMAGE" 2>&1 | sed 's/^/[backup] /'
fi

AUTO="$(docker run --rm -v "$VOL":/backups "$IMAGE" \
          sh -c 'ls -1 /backups/daily/diana_*.sql.gz 2>/dev/null | sort | tail -1')"
[ -n "$AUTO" ] || { echo "ERROR: no se generó ninguna copia" >&2; exit 1; }
echo "[verify] copia generada por backup.sh: $AUTO"

STATUS="$(docker run --rm -v "$VOL":/backups "$IMAGE" cat /backups/last-status)"
echo "[verify] last-status: $STATUS"
case "$STATUS" in OK\ *) ;; *) echo "ERROR: el estado publicado no es OK" >&2; exit 1;; esac

# --- 4. restauración real en un PostgreSQL aislado ---------------------------
docker run -d --name "$DST" --network "$NET" --network-alias pgdst \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=postgres -e POSTGRES_USER="$PGUSER_T" \
    "$IMAGE" >/dev/null
wait_pg "$DST" postgres

restore_into() {  # restore_into <fichero> <db-destino> ; devuelve el rc de restore.sh
    docker run --rm --network "$NET" -v "$VOL":/backups \
        -v "${REPO_DIR}/infrastructure/backups/restore.sh":/scripts/restore.sh:ro \
        -e PGHOST=pgdst -e PGUSER="$PGUSER_T" -e PGDATABASE=postgres \
        --entrypoint /scripts/restore.sh "$IMAGE" "$1" --target-db "$2" >/dev/null 2>&1
}

# --- 5. verificación ----------------------------------------------------------
verify() {  # verify <db> ; rc 0 = todo correcto
    local db="$1" fail=0 pair
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
        "autoridad.hashes:select count(*) from users where password_hash is not null and length(password_hash)>20" \
        "datos.hit_events:select count(*) from hit_events" \
        "datos.acentos:select count(*) from participants where guest_name like '%Ñ%'" \
        "tablas:select count(*) from information_schema.tables where table_schema='public'" \
        "indices:select count(*) from pg_indexes where schemaname='public'" \
        "constraints_pk:select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='p'" \
        "constraints_fk:select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='f'" \
        "constraints_check:select count(*) from pg_constraint where connamespace='public'::regnamespace and contype='c'" \
        "enums:select count(*) from pg_enum"
    do
        chk "${pair%%:*}" "$(q "$SRC" diana "${pair#*:}")" "$(q "$DST" "$db" "${pair#*:}")"
    done
    # Las constraints tienen que estar VIVAS, no sólo declaradas en el catálogo.
    chk FK_viva 1 "$(docker exec "$DST" psql -U "$PGUSER_T" -d "$db" -At -c \
        "insert into rounds (id,game_id,round_index,mode) values ('99999999-0000-4000-8000-000000000099','99999999-9999-4999-8999-999999999999',9,'orphan')" 2>&1 \
        | grep -c 'violates foreign key constraint' || true)"
    chk UNIQUE_vivo 1 "$(docker exec "$DST" psql -U "$PGUSER_T" -d "$db" -At -c \
        "insert into rounds (id,game_id,round_index,mode) select '99999999-0000-4000-8000-000000000098',game_id,round_index,'dup' from rounds where mode='${MARK}-mode'" 2>&1 \
        | grep -c 'duplicate key value violates unique constraint' || true)"
    chk CHECK_vivo 1 "$(docker exec "$DST" psql -U "$PGUSER_T" -d "$db" -At -c \
        "insert into games (id,target_system_id,name,status,join_code,created_by) select '99999999-0000-4000-8000-000000000097',target_system_id,'bad','ESTADO_INVALIDO','ZZZ0000000000001','x' from games where name='${MARK}-game'" 2>&1 \
        | grep -c 'violates check constraint' || true)"
    return $fail
}

echo "=== RESTAURACIÓN DE LA COPIA GENERADA ==="
restore_into "$AUTO" verificada || { echo "ERROR: restore.sh falló sobre la copia" >&2; exit 1; }
verify verificada || { echo "RESULTADO: FALLO — la copia NO restaura correctamente" >&2; exit 1; }

echo "=== HUELLA COMPLETA origen vs restaurado ==="
fp() { docker exec "$1" psql -U "$PGUSER_T" -d "$2" -At -F'|' \
        -c "select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public' order by 1,2" \
        -c "select conrelid::regclass::text,conname,contype::text,pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace order by 1,2" \
        -c "select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by 1,2"; }
if diff <(fp "$SRC" diana) <(fp "$DST" verificada) >/dev/null; then
    echo "PASS  huella de esquema/constraints/índices IDÉNTICA"
else
    echo "FAIL  la huella difiere:"; diff <(fp "$SRC" diana) <(fp "$DST" verificada); exit 1
fi

# --- 6. CONTROL POSITIVO ------------------------------------------------------
# Si estas NO fallan, la verificación de arriba no demuestra nada: el arnés
# estaría dando por buena cualquier cosa.
echo "=== CONTROL POSITIVO (copias truncada, vacía y alterada: DEBEN fallar) ==="
docker run --rm -v "$VOL":/backups "$IMAGE" sh -c "
    SZ=\$(stat -c%s '$AUTO')
    head -c \$((SZ/2)) '$AUTO' > /backups/ctrl-truncado.sql.gz
    : | gzip -9 > /backups/ctrl-vacio.sql.gz
    cp '$AUTO' /backups/ctrl-alterado.sql.gz
    cp '${AUTO}.sha256' /backups/ctrl-alterado.sql.gz.sha256
    printf 'basura' >> /backups/ctrl-alterado.sql.gz
"
for ctrl in ctrl-truncado ctrl-vacio ctrl-alterado; do
    db="${ctrl//-/_}"
    if restore_into "/backups/${ctrl}.sql.gz" "$db" && verify "$db" >/dev/null 2>&1; then
        echo "FAIL  el control positivo '${ctrl}' pasó la verificación: el ensayo NO es válido" >&2
        exit 1
    fi
    echo "PASS  control positivo '${ctrl}' rechazado como debía"
done

echo
echo "RESULTADO: BACKUP REAL → RESTAURACIÓN AISLADA → ESTRUCTURA Y DATOS VERIFICADOS"
