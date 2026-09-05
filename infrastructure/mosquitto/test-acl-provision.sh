#!/usr/bin/env bash
# ==============================================================================
# Diana · test-acl-provision.sh — GATE del plano de provisioning (contrato v1.2,
# ADR-0008) contra un Mosquitto REAL y EFÍMERO, con TLS.
# ==============================================================================
# Qué hace, y por qué así:
#
#   Levanta un contenedor `eclipse-mosquitto:2` desechable (sin persistencia,
#   puerto publicado sólo en 127.0.0.1, CA y certificado generados al vuelo en
#   un directorio temporal que se borra al salir) montando LA ACL DEL REPO —
#   la generada por generate-identities.mjs, sin retoques. Después mide, contra
#   ese broker, la matriz de autoridad del plano de provisioning:
#
#     targets/v1/module/{id}/provision         backend publica · módulo {id} lee
#     targets/v1/module/{id}/provision/state   módulo {id} publica · backend lee
#
#   NO toca producción, ni VM109, ni el broker real.
#
# CÓMO SE VERIFICA CADA CASO — POR EFECTO, NUNCA POR rc:
#   Una denegación de ACL en PUBLICACIÓN devuelve rc=0 en mosquitto_pub, con un
#   `Warning: Publish ... Not authorized` en stderr; sólo el fallo de
#   AUTENTICACIÓN da 135. Medido en P0-2. Por eso aquí el rc del cliente no
#   decide nada: cada caso arranca un SUSCRIPTOR de una identidad DISTINTA a la
#   del publicador, espera a que la suscripción esté establecida, publica un
#   MARCADOR ÚNICO, y el veredicto es si ese marcador exacto llegó o no.
#
#   Distinguir AUTOR y CONTENIDO es obligatorio, no cosmético: la versión
#   anterior de test-acl.sh declaraba "F-02 SIGUE ABIERTO" con que hubiera algo
#   retenido en el tópico, sin mirar quién lo escribió, y como el propio módulo
#   podía publicar ahí legítimamente daba un falso rojo permanente. Aquí cada
#   payload lleva un marcador irrepetible (caso + PID + nanosegundos) y el
#   veredicto es `grep` de ESE marcador.
#
#   Tampoco se usan retenidos: el contrato v1.2 exige retain=FALSE en la orden
#   de aprovisionamiento (un retenido es un replay servido por el broker), así
#   que el arnés mide el camino en vivo, que es el que existe en producción.
#
#   Publicador y suscriptor son SIEMPRE usuarios distintos: con
#   `use_username_as_clientid true` el broker reescribe el client_id con el
#   usuario, y dos conexiones simultáneas del mismo usuario se desalojan entre
#   sí. Eso no es una carrera de timing, es colisión de client_id.
#
# CONTROL POSITIVO (imprescindible): si todos los casos fueran denegaciones, un
#   broker que lo denegase TODO —o un fallo de transporte, o una credencial
#   inexistente— pasaría el gate trivialmente. Por eso la matriz incluye cuatro
#   ALLOWED reales, y el paso 0 exige una publicación legítima antes de
#   interpretar ninguna denegación.
#
# CALIBRACIÓN (--calibrate): reejecuta la matriz sobre una COPIA de la ACL a la
#   que se le ha inyectado una regla permisiva (comodín que deja a module-01
#   escribir en el subárbol de module-02). Se comprueba con grep que la
#   mutación entró EN EL FICHERO QUE SE MONTA antes de medir. El gate DEBE
#   ponerse rojo. Si sigue verde, el gate no mide nada.
#   La mutación vive sólo en el directorio temporal: la ACL del repo no se toca.
#
# GAP conocido y no cerrado: mosquitto_pub/mosquitto_sub sólo aceptan la
#   contraseña en su propio argv (-P). Aquí las contraseñas son ALEATORIAS, de
#   un solo uso y de un broker que desaparece al terminar el script, así que no
#   hay secreto real que proteger; aun así, no ejecutar esto en un host
#   compartido con terceros.
#
# Uso:
#   ./test-acl-provision.sh              # matriz sobre la ACL del repo
#   ./test-acl-provision.sh --calibrate  # + demostración de que el gate enrojece
#   PLAINTEXT=1 ./test-acl-provision.sh  # 1883 en claro (si TLS no es viable)
# ==============================================================================
set -u
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="${SCRIPT_DIR}/generate-identities.mjs"
ACL_SRC="${SCRIPT_DIR}/acl"
IMAGE="${MOSQUITTO_IMAGE:-eclipse-mosquitto:2}"
CALIBRATE=0
[ "${1:-}" = "--calibrate" ] && CALIBRATE=1

MOD_A="${MOD_A:-module-01}"
MOD_B="${MOD_B:-module-02}"
ROOT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).topic_root)' "${SCRIPT_DIR}/identities.json")"

for bin in docker mosquitto_pub mosquitto_sub openssl node; do
    command -v "$bin" >/dev/null || { echo "ERROR: falta '$bin'." >&2; exit 2; }
done

WORK="$(mktemp -d)"
CID=""
cleanup() {
    [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1
    rm -rf "$WORK"
}
trap cleanup EXIT

# --- Material TLS efímero (CA propia + servidor con SAN localhost/127.0.0.1) --
mkdir -p "$WORK/certs" "$WORK/config"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -keyout "$WORK/certs/ca.key" -out "$WORK/certs/ca.crt" \
    -subj "/CN=diana-test-ca" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
    -keyout "$WORK/certs/server.key" -out "$WORK/certs/server.csr" \
    -subj "/CN=localhost" >/dev/null 2>&1
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > "$WORK/certs/ext.cnf"
openssl x509 -req -in "$WORK/certs/server.csr" -CA "$WORK/certs/ca.crt" \
    -CAkey "$WORK/certs/ca.key" -CAcreateserial -days 2 \
    -extfile "$WORK/certs/ext.cnf" -out "$WORK/certs/server.crt" >/dev/null 2>&1
chmod 644 "$WORK/certs/"*.crt "$WORK/certs/server.key"

USE_TLS=1
[ "${PLAINTEXT:-0}" = "1" ] && USE_TLS=0

if [ "$USE_TLS" = "1" ]; then
    PORT_IN=8883
    cat > "$WORK/config/mosquitto.conf" <<EOF
persistence false
log_dest stdout
log_type all
listener 8883
protocol mqtt
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
require_certificate false
tls_version tlsv1.2
socket_domain ipv4
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl
use_username_as_clientid true
EOF
else
    PORT_IN=1883
    cat > "$WORK/config/mosquitto.conf" <<EOF
persistence false
log_dest stdout
log_type all
listener 1883
protocol mqtt
socket_domain ipv4
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl
use_username_as_clientid true
EOF
fi

# --- Contraseñas aleatorias de un solo uso, para las 11 identidades ---------
declare -A PW
# mosquitto_passwd -c se NIEGA a escribir si el fichero ya existe, así que no se
# pre-crea. El directorio se abre en escritura mientras dura la creación porque
# la imagen oficial corre como uid 1883, no como el usuario del host.
rm -f "$WORK/config/passwd"
chmod 777 "$WORK/config"
FIRST=1
while read -r u; do
    [ -n "$u" ] || continue
    PW["$u"]="$(openssl rand -hex 16)"
    if [ "$FIRST" = "1" ]; then
        docker run --rm -v "$WORK/config:/c" "$IMAGE" \
            mosquitto_passwd -b -c /c/passwd "$u" "${PW[$u]}" >/dev/null 2>&1 || {
                echo "ERROR: no se pudo crear passwd (¿imagen $IMAGE accesible?)" >&2; exit 2; }
        FIRST=0
    else
        docker run --rm -v "$WORK/config:/c" "$IMAGE" \
            mosquitto_passwd -b /c/passwd "$u" "${PW[$u]}" >/dev/null 2>&1
    fi
done < <(node "$GEN" --list-users)
# El fichero sale 0600 y propiedad del usuario del host: el broker (uid 1883)
# no podría leerlo y arrancaría SIN autenticación utilizable.
chmod 644 "$WORK/config/passwd"
chmod 755 "$WORK/config"

TRANSPORT=()
[ "$USE_TLS" = "1" ] && TRANSPORT=(--cafile "$WORK/certs/ca.crt" --insecure)
# --insecure: el certificado se valida contra NUESTRA CA (--cafile); se relaja
# sólo la comprobación de nombre porque el puerto se publica en 127.0.0.1 con
# un puerto efímero. La propiedad bajo prueba aquí es la AUTORIZACIÓN, no el
# pinning de nombre (eso lo cubre P0-2 en el broker real).

start_broker() { # start_broker <ruta_acl>
    if [ -n "$CID" ]; then docker rm -f "$CID" >/dev/null 2>&1; CID=""; fi
    cp "$1" "$WORK/config/acl"
    chmod 644 "$WORK/config/acl"
    CID="$(docker run -d -p 127.0.0.1::${PORT_IN} \
        -v "$WORK/config:/mosquitto/config:ro" \
        -v "$WORK/certs:/mosquitto/certs:ro" \
        "$IMAGE" 2>/dev/null)" || { echo "ERROR: no arrancó el contenedor" >&2; exit 2; }
    HOST=127.0.0.1
    PORT="$(docker port "$CID" "${PORT_IN}/tcp" | head -1 | sed 's/.*://')"
    # Espera activa a que el listener acepte de verdad una conexión autenticada;
    # nada de `sleep` a ojo. Si nunca acepta, el paso 0 lo delatará.
    for _ in $(seq 1 60); do
        if timeout 2 mosquitto_pub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" \
             -u "$MOD_A" -P "${PW[$MOD_A]}" \
             -t "${ROOT}/module/${MOD_A}/presence" -m 'broker-up' -q 1 >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.2
    done
    echo "AVISO: el broker no aceptó una conexión de prueba tras 12s." >&2
    docker logs "$CID" 2>&1 | tail -20 >&2
}

PASS=0; FAIL=0; FAILED_CASES=()
log_pass() { echo "  [PASS] $1"; PASS=$((PASS+1)); }
log_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); FAILED_CASES+=("$1"); }

# effect <sub_user> <sub_topic> <pub_user> <pub_topic> <expect: ALLOWED|DENIED> <desc>
#
# Veredicto por EFECTO: ¿llegó al suscriptor el marcador único que publicó ESTE
# caso? Cualquier otro tráfico en el tópico es irrelevante.
effect() {
    local su="$1" st="$2" pu="$3" pt="$4" expect="$5" desc="$6"
    local marker="DIANA-$(date +%s%N)-$$-$RANDOM"
    local out="$WORK/sub.$$.txt"; : > "$out"
    timeout 6 mosquitto_sub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" \
        -u "$su" -P "${PW[$su]}" -t "$st" -q 1 -C 1 > "$out" 2>/dev/null &
    local subpid=$!
    sleep 1.2   # margen para el CONNECT+SUBACK del suscriptor
    timeout 4 mosquitto_pub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" \
        -u "$pu" -P "${PW[$pu]}" -t "$pt" -m "{\"marker\":\"$marker\"}" -q 1 \
        >/dev/null 2>&1
    local i
    for i in $(seq 1 30); do grep -q "$marker" "$out" 2>/dev/null && break; sleep 0.1; done
    kill "$subpid" >/dev/null 2>&1; wait "$subpid" 2>/dev/null
    local got=no
    grep -q "$marker" "$out" 2>/dev/null && got=si
    rm -f "$out"
    if [ "$expect" = "ALLOWED" ]; then
        if [ "$got" = "si" ]; then log_pass "$desc → ALLOWED (marcador $marker entregado)"
        else log_fail "$desc → se esperaba ALLOWED y el marcador $marker NO llegó"; fi
    else
        if [ "$got" = "no" ]; then log_pass "$desc → DENIED (marcador $marker ausente)"
        else log_fail "$desc → se esperaba DENIED y el marcador $marker SÍ llegó"; fi
    fi
}

run_matrix() {
    local label="$1"
    local transport_label; transport_label="$( [ "$USE_TLS" = 1 ] && echo TLS || echo claro )"
    echo "=== MATRIZ ($label) · broker $IMAGE, $transport_label en ${HOST}:${PORT} ==="

    echo "--- 0. Control positivo de autenticación/transporte"
    effect backend "$ROOT/module/$MOD_A/presence" "$MOD_A" "$ROOT/module/$MOD_A/presence" \
        ALLOWED "0. $MOD_A autentica y publica su presence (si esto falla, toda denegación posterior es un falso verde)"
    if [ "$FAIL" -gt 0 ]; then
        echo "ABORTA: sin control positivo no se puede interpretar ninguna denegación." >&2
        return 1
    fi

    effect backend "$ROOT/module/$MOD_A/provision" "$MOD_A" "$ROOT/module/$MOD_A/provision" \
        DENIED "1. $MOD_A publica el command de provisioning de $MOD_A"
    effect backend "$ROOT/module/$MOD_B/provision" "$MOD_A" "$ROOT/module/$MOD_B/provision" \
        DENIED "2. $MOD_A publica el command de provisioning de $MOD_B"
    effect "$MOD_A" "$ROOT/module/$MOD_A/provision" backend "$ROOT/module/$MOD_A/provision" \
        ALLOWED "3. $MOD_A suscribe el command de provisioning de $MOD_A"
    effect "$MOD_A" "$ROOT/module/$MOD_B/provision" backend "$ROOT/module/$MOD_B/provision" \
        DENIED "4. $MOD_A suscribe el command de provisioning de $MOD_B"
    effect backend "$ROOT/module/$MOD_A/provision/state" "$MOD_A" "$ROOT/module/$MOD_A/provision/state" \
        ALLOWED "5. $MOD_A publica el state de provisioning de $MOD_A"
    effect backend "$ROOT/module/$MOD_B/provision/state" "$MOD_A" "$ROOT/module/$MOD_B/provision/state" \
        DENIED "6. $MOD_A publica el state de provisioning de $MOD_B"
    effect "$MOD_A" "$ROOT/module/$MOD_A/provision" backend "$ROOT/module/$MOD_A/provision" \
        ALLOWED "7. backend publica el command de provisioning de $MOD_A"
    effect backend "$ROOT/module/$MOD_A/provision/state" "$MOD_A" "$ROOT/module/$MOD_A/provision/state" \
        ALLOWED "8. backend suscribe el state de provisioning de $MOD_A"

    echo "--- extra. El backend NO debe poder escribir el state reportado del módulo"
    effect "$MOD_A" "$ROOT/module/$MOD_A/provision/state" backend "$ROOT/module/$MOD_A/provision/state" \
        DENIED "9. backend publica el state de $MOD_A (module/+/provision no alcanza provision/state)"
    return 0
}

echo "##########################################################################"
echo "# FASE 1 · ACL DEL REPO (la generada desde identities.json)"
echo "##########################################################################"
node "$GEN" --check || { echo "ERROR: los artefactos no coinciden con la fuente única." >&2; exit 2; }
if grep -vE '^[[:space:]]*#' "$ACL_SRC" | grep -q '%c'; then
    echo "ERROR: F-02 — la ACL contiene %c." >&2; exit 2
fi
start_broker "$ACL_SRC"
run_matrix "ACL íntegra" || exit 1
BASE_PASS=$PASS; BASE_FAIL=$FAIL
echo ""
echo "=== Fase 1: ${BASE_PASS} PASS / ${BASE_FAIL} FAIL ==="

if [ "$CALIBRATE" = "1" ]; then
    echo ""
    echo "######################################################################"
    echo "# FASE 2 · CALIBRACIÓN — regla permisiva inyectada; el gate DEBE enrojecer"
    echo "######################################################################"
    MUT="$WORK/acl.mutado"
    # Comodín que da a MOD_A escritura sobre TODO el subárbol de MOD_B.
    awk -v u="$MOD_A" -v b="$ROOT/module/$MOD_B/#" '
        { print }
        $1=="user" && $2==u { print "topic write " b }
    ' "$ACL_SRC" > "$MUT"
    echo "--- Verificación de que la mutación ENTRÓ en el fichero que se va a montar:"
    if ! grep -n "^topic write ${ROOT}/module/${MOD_B}/#$" "$MUT"; then
        echo "ERROR: la mutación NO entró; medir ahora no demostraría nada." >&2; exit 2
    fi
    PASS=0; FAIL=0; FAILED_CASES=()
    start_broker "$MUT"
    grep -q "^topic write ${ROOT}/module/${MOD_B}/#$" "$WORK/config/acl" || {
        echo "ERROR: el fichero montado no lleva la mutación." >&2; exit 2; }
    run_matrix "ACL MUTADA (permisiva)"
    echo ""
    echo "=== Fase 2 (mutada): ${PASS} PASS / ${FAIL} FAIL ==="
    if [ "$FAIL" -gt 0 ]; then
        echo "CALIBRACIÓN OK: el gate se pone ROJO con la regla permisiva. Casos rotos:"
        printf '    - %s\n' "${FAILED_CASES[@]}"
    else
        echo "CALIBRACIÓN FALLIDA: el gate sigue VERDE con una ACL permisiva."
        echo "El gate no mide autorización. NO usar sus resultados como evidencia."
        exit 1
    fi
fi

echo ""
if [ "$BASE_FAIL" -gt 0 ]; then
    echo "RESULTADO: GATE ROJO (${BASE_FAIL} fallos sobre la ACL del repo)."
    exit 1
fi
echo "RESULTADO: GATE VERDE — ${BASE_PASS} casos correctos sobre la ACL del repo."
exit 0
