#!/usr/bin/env bash
# ==============================================================================
# Diana · gate-backup.sh — CALIBRACIÓN del gate de backup
# ==============================================================================
# Un gate que nunca se pone rojo no protege nada. Este arnés PROVOCA de verdad
# cada modo de fallo y comprueba que backup.sh lo rechaza, con efecto observable:
#
#   - rc distinto de 0
#   - NINGÚN artefacto publicado en daily/
#   - la copia buena ANTERIOR intacta (sha256 idéntico) y sin sobrescribir
#   - last-status en FAIL
#
# Los fallos se inyectan con un `pg_dump` postizo delante del PATH: no se toca
# ninguna base de datos real y no hace falta un PostgreSQL levantado para los
# negativos. El control positivo sí usa PostgreSQL — un contenedor efímero,
# nunca la base real — a través de verify-restore.sh.
#
# Uso:
#   ./gate-backup.sh                    # negativos + control positivo completo
#   GATE_SKIP_POSITIVE=1 ./gate-backup.sh   # sólo los negativos (más rápido)
#
# NO toca producción, ni el volumen `diana_backups`, ni VM109.
# ==============================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUPS_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
IMAGE="${GATE_PG_IMAGE:-postgres:16.4-alpine}"
WORK="$(mktemp -d)"
PASS=0; FAIL=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

ok()   { printf '  PASS  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL+1)); }

# ------------------------------------------------------------------------------
# Cada caso corre en su propio directorio de backups, montado como /backups.
# Se siembra con una copia buena ANTERIOR para poder demostrar que un backup
# fallido no la pisa ni la sustituye.
# ------------------------------------------------------------------------------
PREV_NAME="diana_20200101-000000.sql.gz"

make_case_dir() {  # make_case_dir -> imprime la ruta
    local d="${WORK}/case-$RANDOM$RANDOM"
    mkdir -p "$d/daily" "$d/weekly" "$d/monthly"
    # copia buena previa: un dump plausible de verdad
    gen_valid_dump | gzip -9 > "${d}/daily/${PREV_NAME}"
    sha256sum "${d}/daily/${PREV_NAME}" | cut -d' ' -f1 > "${d}/prev.sha"
    echo "$d"
}

gen_valid_dump() {
    echo "--"
    echo "-- PostgreSQL database dump"
    echo "--"
    echo "SET statement_timeout = 0;"
    echo "SET client_encoding = 'UTF8';"
    echo "CREATE TABLE public.games (id uuid NOT NULL, name text NOT NULL);"
    echo "ALTER TABLE ONLY public.games ADD CONSTRAINT games_pkey PRIMARY KEY (id);"
    echo "COPY public.games (id, name) FROM stdin;"
    local i
    for i in $(seq 1 400); do
        printf '00000000-0000-4000-8000-%012d\tpartida %d de relleno para dar tamaño realista\n' "$i" "$i"
    done
    echo '\.'
    echo "--"
    echo "-- PostgreSQL database dump complete"
    echo "--"
}

# `pg_dump` postizo: $GATE_MODE decide cómo falla.
write_shim() {  # write_shim <dir-caso> <modo>
    local d="$1" mode="$2"
    mkdir -p "${d}/shims"
    cat > "${d}/shims/pg_dump" <<'SHIM'
#!/bin/sh
# pg_dump postizo del arnés de calibración. NO se conecta a nada.
case "$GATE_MODE" in
  rc_inmediato)
      echo "pg_dump: error: connection to server failed" >&2
      exit 1 ;;
  vacio_rc0)
      # Éste es el fallo MEDIDO en producción: sin salida y rc=0 aparente para
      # la tubería -> gzip del vacío -> .sql.gz «válido» de ~20 bytes.
      exit 0 ;;
  truncado_rc0)
      # Sale contenido creible pero SIN el marcador de cierre.
      #
      # CUIDADO CON EL NUMERO DE SENTENCIAS. Este fixture emitia solo 3
      # (SET, CREATE TABLE, COPY): las 400 lineas de datos de COPY no son
      # sentencias. Asi que moria en el contador BACKUP_MIN_STATEMENTS y NO en
      # la comprobacion de marcador, que es lo que dice medir. Una supervision
      # independiente lo demostro: al eliminar las dos comprobaciones de
      # marcadores, el gate seguia en verde -- y un dump truncado REALISTA (201
      # sentencias) se publicaba con rc=0 y last-status OK.
      #
      # Ahora emite MUY POR ENCIMA del minimo de sentencias, de modo que lo
      # unico que puede atraparlo es la ausencia del marcador de fin.
      printf -- '--\n-- PostgreSQL database dump\n--\n'
      printf 'SET statement_timeout = 0;\n'
      printf 'SET lock_timeout = 0;\n'
      printf 'SET client_encoding = %s;\n' "'UTF8'"
      i=1; while [ $i -le 60 ]; do
        printf 'CREATE TABLE public.tabla_%02d (id uuid NOT NULL, name text NOT NULL);\n' "$i"
        printf 'CREATE INDEX idx_%02d ON public.tabla_%02d (name);\n' "$i" "$i"
        printf 'INSERT INTO public.tabla_%02d VALUES (gen_random_uuid(), %s);\n' "$i" "'fila'"
        i=$((i+1)); done
      printf 'COPY public.games (id, name) FROM stdin;\n'
      i=1; while [ $i -le 400 ]; do
        printf '00000000-0000-4000-8000-%012d\tfila %d\n' "$i" "$i"; i=$((i+1)); done
      exit 0 ;;
  falla_a_mitad)
      # Escribe la mitad y MUERE: el caso que la tubería enmascaraba.
      printf -- '--\n-- PostgreSQL database dump\n--\n'
      printf 'CREATE TABLE public.games (id uuid NOT NULL, name text NOT NULL);\n'
      printf 'COPY public.games (id, name) FROM stdin;\n'
      i=1; while [ $i -le 300 ]; do
        printf '00000000-0000-4000-8000-%012d\tfila %d\n' "$i" "$i"; i=$((i+1)); done
      echo "pg_dump: error: query failed: server closed the connection unexpectedly" >&2
      exit 2 ;;
  cascaron)
      # Las dos cabeceras y relleno de comentarios: pasa gzip -t, pasa los
      # marcadores, pasa el tamaño... y no tiene una sola sentencia útil.
      printf -- '--\n-- PostgreSQL database dump\n--\n'
      i=1; while [ $i -le 400 ]; do
        printf -- '-- comentario de relleno numero %d, sin ninguna sentencia SQL\n' "$i"; i=$((i+1)); done
      printf -- '--\n-- PostgreSQL database dump complete\n--\n'
      exit 0 ;;
  minusculo)
      # Dump formalmente completo pero absurdamente pequeño.
      printf -- '--\n-- PostgreSQL database dump\n--\nSET x = 1;\n--\n-- PostgreSQL database dump complete\n--\n'
      exit 0 ;;
  valido)
      cat /shims/valid-dump.sql ;;
  *)
      echo "GATE_MODE no reconocido: '$GATE_MODE'" >&2; exit 99 ;;
esac
SHIM
    chmod +x "${d}/shims/pg_dump"
    if [ "$mode" = "valido" ]; then
        gen_valid_dump > "${d}/shims/valid-dump.sql"
    fi
}

run_backup() {  # run_backup <dir-caso> <modo> -> rc de backup.sh
    docker run --rm \
        -v "$1":/backups \
        -v "$1/shims":/shims:ro \
        -v "${BACKUPS_DIR}/backup.sh":/scripts/backup.sh:ro \
        -e GATE_MODE="$2" \
        -e PATH=/shims:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        -e BACKUP_ROOT=/backups -e TZ=UTC \
        -e BACKUP_RETENTION_DAILY="${GATE_RETENTION_DAILY:-7}" \
        --entrypoint /scripts/backup.sh "$IMAGE" > "$1/out.log" 2>&1
}

published_new() {  # published_new <dir-caso> -> nº de .sql.gz distintos del previo
    find "$1/daily" -maxdepth 1 -name 'diana_*.sql.gz' ! -name "$PREV_NAME" | wc -l | tr -d ' '
}

# ------------------------------------------------------------------------------
# NEGATIVOS: cada uno DEBE poner el gate en rojo.
# ------------------------------------------------------------------------------
negativo() {  # negativo <modo> <descripción>
    local mode="$1" desc="$2" d rc new status prev_now
    d="$(make_case_dir)"; write_shim "$d" "$mode"
    set +e; run_backup "$d" "$mode"; rc=$?; set -e

    echo "- NEGATIVO [${mode}] ${desc}"
    [ "$rc" -ne 0 ] && ok "rc=${rc} (distinto de 0)" || bad "rc=0: el gate NO se puso rojo"

    new="$(published_new "$d")"
    [ "$new" = "0" ] && ok "no se publicó ningún artefacto nuevo" \
                     || bad "se publicaron ${new} artefactos pese al fallo"

    prev_now="$(sha256sum "${d}/daily/${PREV_NAME}" | cut -d' ' -f1)"
    [ "$prev_now" = "$(cat "${d}/prev.sha")" ] && ok "la copia buena anterior sigue intacta" \
                     || bad "la copia buena anterior fue alterada"

    status="$(cat "${d}/last-status" 2>/dev/null || echo AUSENTE)"
    case "$status" in FAIL\ *) ok "last-status en FAIL";; *) bad "last-status='${status}'";; esac

    # Nada a medias en staging con nombre de copia buena.
    if [ -z "$(find "$d/.staging" -maxdepth 1 -name 'diana_*' 2>/dev/null)" ]; then
        ok "staging limpio, sin restos publicables"
    else
        bad "quedaron restos en staging: $(find "$d/.staging" -maxdepth 1 -name 'diana_*')"
    fi
    echo "        motivo registrado: $(grep -m1 'ERROR:' "$d/out.log" || echo '(ninguno)')"
}

echo "=============================================================="
echo " CALIBRACIÓN DEL GATE — cada negativo debe ponerse ROJO"
echo "=============================================================="
negativo rc_inmediato  "pg_dump falla al arrancar (rc=1)"
negativo vacio_rc0     "dump vacío -> gzip válido de ~20 bytes (el fallo MEDIDO en producción)"
negativo truncado_rc0  "dump truncado: sin marcador de cierre, rc=0"
negativo falla_a_mitad "pg_dump muere a mitad (rc=2): la tubería NO puede enmascararlo"
negativo cascaron      "gzip válido, marcadores presentes, cero sentencias SQL"
negativo minusculo     "dump completo pero inverosímilmente pequeño"

# ------------------------------------------------------------------------------
# NEGATIVO especial: colisión de nombre. Un volcado PERFECTAMENTE VÁLIDO no
# puede sobrescribir una copia ya publicada con el mismo nombre (doble disparo
# del planificador, salto de reloj). Se ocupan de antemano los nombres de los
# próximos segundos con contenido reconocible y se comprueba que ninguno cambia.
# ------------------------------------------------------------------------------
echo
echo "- NEGATIVO [colision_nombre] un volcado válido NO puede pisar una copia existente"
d="$(make_case_dir)"; write_shim "$d" valido
# Ventana amplia (180 s): el nombre lo fija el reloj UTC del contenedor, así
# que se ocupan todos los nombres posibles del arranque de docker. Y se sube la
# retención para que la purga no borre lo que se está midiendo.
: > "${d}/ocupados.txt"
for off in $(seq 0 180); do
    n="diana_$(date -u -d "+${off} seconds" +%Y%m%d-%H%M%S).sql.gz"
    printf 'COPIA-BUENA-ANTERIOR-INTOCABLE' > "${d}/daily/${n}"
    echo "${d}/daily/${n}" >> "${d}/ocupados.txt"
done
OCUPADOS="$(wc -l < "${d}/ocupados.txt" | tr -d ' ')"
set +e; GATE_RETENTION_DAILY=10000 run_backup "$d" valido; rc=$?; set -e
[ "$rc" -ne 0 ] && ok "rc=${rc} (rechazó publicar sobre un nombre ocupado)" \
                || bad "rc=0: sobrescribió o publicó pese a la colisión"
ALTERADOS="$(grep -L 'COPIA-BUENA-ANTERIOR-INTOCABLE' $(cat "${d}/ocupados.txt") 2>/dev/null | wc -l | tr -d ' ')"
[ "$ALTERADOS" = "0" ] && ok "las ${OCUPADOS} copias existentes conservan su contenido" \
                       || bad "${ALTERADOS} copias existentes fueron sobrescritas"
case "$(cat "${d}/last-status" 2>/dev/null)" in FAIL\ *) ok "last-status en FAIL";; *) bad "last-status no es FAIL";; esac
echo "        motivo registrado: $(grep -m1 'ERROR:' "$d/out.log" || echo '(ninguno)')"

# ------------------------------------------------------------------------------
# CONTROL POSITIVO del propio arnés: con un pg_dump que funciona, backup.sh
# TIENE que publicar. Sin esto, los negativos de arriba pasarían trivialmente
# aunque el script no hiciera nada nunca.
# ------------------------------------------------------------------------------
echo
echo "=============================================================="
echo " CONTROL POSITIVO — con un volcado válido, DEBE publicar"
echo "=============================================================="
d="$(make_case_dir)"; write_shim "$d" valido
set +e; run_backup "$d" valido; rc=$?; set -e
[ "$rc" -eq 0 ] && ok "rc=0" || { bad "rc=${rc} con un volcado válido"; cat "$d/out.log"; }
new="$(published_new "$d")"
[ "$new" = "1" ] && ok "se publicó exactamente 1 artefacto nuevo" || bad "artefactos nuevos=${new}"
NEWF="$(find "$d/daily" -maxdepth 1 -name 'diana_*.sql.gz' ! -name "$PREV_NAME" | head -1)"
if [ -n "$NEWF" ]; then
    gzip -t "$NEWF" 2>/dev/null && ok "gzip íntegro" || bad "gzip corrupto"
    gunzip -c "$NEWF" | grep -q 'PostgreSQL database dump complete' \
        && ok "contiene el marcador de fin" || bad "sin marcador de fin"
    [ -f "${NEWF}.sha256" ] \
        && { [ "$(cut -d' ' -f1 < "${NEWF}.sha256")" = "$(sha256sum "$NEWF" | cut -d' ' -f1)" ] \
             && ok "sha256 acompañante correcto" || bad "sha256 acompañante no coincide"; } \
        || bad "falta el fichero .sha256"
    [ "$(stat -c%a "$NEWF")" = "600" ] && ok "permisos 600" || bad "permisos $(stat -c%a "$NEWF")"
fi
[ "$(sha256sum "${d}/daily/${PREV_NAME}" | cut -d' ' -f1)" = "$(cat "${d}/prev.sha")" ] \
    && ok "la copia anterior sigue intacta junto a la nueva" || bad "la copia anterior fue alterada"
case "$(cat "${d}/last-status" 2>/dev/null)" in OK\ *) ok "last-status en OK";; *) bad "last-status no es OK";; esac

# ------------------------------------------------------------------------------
# CONTROL POSITIVO COMPLETO: PostgreSQL de verdad, backup real, restauración
# aislada y datos verificados. Es el otro extremo del contrato.
# ------------------------------------------------------------------------------
if [ "${GATE_SKIP_POSITIVE:-0}" != "1" ]; then
    echo
    echo "=============================================================="
    echo " CONTROL POSITIVO COMPLETO — backup -> restore aislado -> datos"
    echo "=============================================================="
    if "${BACKUPS_DIR}/verify-restore.sh"; then
        ok "verify-restore.sh completo en verde"
    else
        bad "verify-restore.sh falló"
    fi
fi

echo
echo "=============================================================="
printf ' RESULTADO: %d comprobaciones en verde, %d en rojo\n' "$PASS" "$FAIL"
echo "=============================================================="
[ "$FAIL" -eq 0 ] || exit 1
