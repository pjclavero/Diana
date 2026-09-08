#!/usr/bin/env bash
# ==============================================================================
# Diana · test-coordinator-broker.sh — prueba de regresión de D6 (P1)
# ==============================================================================
# QUÉ DEMUESTRA (con un broker REAL, eclipse-mosquitto, en contenedor efímero):
#
#   1. Tras ejecutar `set-coordinator.sh <module_id>`, la ACL queda con un modo
#      que el proceso del broker (uid 1883, usuario `mosquitto`) PUEDE ABRIR.
#   2. El broker ARRANCA con esa ACL (no Exited(13) / «Unable to open acl_file»).
#   3. El broker AUTENTICA: credencial buena conecta, credencial mala se rechaza.
#   4. El broker APLICA LA ACL: el coordinador puede escribir en
#      targets/v1/module/+/command y un módulo no coordinador NO puede.
#
# EL DEFECTO ORIGINAL (D6): `set-coordinator.sh` escribía con
# `mktemp` + `mv`; el temporal nace en 0600 y `mv` arrastraba ese modo al
# destino, dejando la ACL -rw------- y el broker en Exited(13). Reproducido por
# dos agentes independientes y de nuevo aquí antes del arreglo.
#
# POR QUÉ NO BASTA CON MIRAR EL MODO: comprobar `stat -c %a` sólo mide una
# proxy. Esta prueba mide el EFECTO: levanta el broker y observa mensajes que
# llegan o no llegan. Ningún paso se cree un `exit 0`: se captura rc y se
# contrasta con el resultado observable.
#
# SOBRE EL rc DE mosquitto_pub: una DENEGACIÓN DE ACL al publicar devuelve rc=0
# (el broker acepta el PUBLISH y lo descarta en silencio). Sólo la autenticación
# da 135. Por eso la comprobación de ACL de este script NO usa el rc: usa un
# suscriptor con `topic read #` (usuario backend) y decide por si el mensaje
# llegó o no.
#
# AISLAMIENTO: no toca el repositorio ni el broker real. Copia los ficheros a un
# directorio temporal propio, genera allí un `passwd` de usar y tirar y levanta
# un contenedor SIN publicar puertos al host. Nada de esto llega a producción.
#
# Uso:
#   ./test-coordinator-broker.sh
#   MUTATE_ACL_0600=1 ./test-coordinator-broker.sh   # calibración: debe FALLAR
#
# Requisitos: docker y node en el host.
# ==============================================================================
set -uo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${MOSQUITTO_IMAGE:-eclipse-mosquitto:2.0.18}"
CID_NAME="diana-d6-test-$$"
# LABROOT lo crea y lo posee ESTE usuario; LAB cuelga de él. Con userns-remap
# los ficheros que escribe el contenedor quedan con un uid ajeno: sólo se
# pueden borrar si su directorio PADRE es nuestro (el sticky bit de /tmp lo
# impediría si LAB colgase directamente de /tmp).
LABROOT="$(mktemp -d)"
LAB="$LABROOT/w"
mkdir -p "$LAB"
FAILURES=0

log()  { echo "[d6] $*"; }
pass() { echo "  OK   · $*"; }
fail() { echo "  FALLO· $*"; FAILURES=$((FAILURES + 1)); }

cleanup() {
  docker rm -f "$CID_NAME" >/dev/null 2>&1 || true
  # El passwd efímero se crea DENTRO del contenedor y pertenece al uid del
  # broker; devuélvelo a este usuario antes de borrar, o `rm -rf` falla.
  [[ -n "${LAB:-}" ]] && docker run --rm -v "$LAB:/lab" --entrypoint chmod \
    "$IMAGE" -R 0777 /lab >/dev/null 2>&1
  rm -rf "$LABROOT"
}
trap cleanup EXIT

command -v docker >/dev/null || { echo "[d6] docker no disponible: SKIP" >&2; exit 0; }
command -v node   >/dev/null || { echo "[d6] node no disponible: SKIP" >&2; exit 0; }

# ---------------------------------------------------------------------------
# 1. Copia aislada del material que set-coordinator.sh necesita.
# ---------------------------------------------------------------------------
mkdir -p "$LAB/tree" "$LAB/config" "$LAB/gen"
cp "$SCRIPT_DIR/set-coordinator.sh"      "$LAB/tree/"
cp "$SCRIPT_DIR/generate-identities.mjs" "$LAB/tree/"
cp "$SCRIPT_DIR/identities.json"         "$LAB/tree/"
cp "$SCRIPT_DIR/acl"                     "$LAB/tree/acl"
chmod 0644 "$LAB/tree/acl"

# ---------------------------------------------------------------------------
# 2. Ejecuta set-coordinator.sh de verdad (es lo que se está probando).
# ---------------------------------------------------------------------------
log "ejecutando set-coordinator.sh module-01 sobre la copia aislada"
"$LAB/tree/set-coordinator.sh" module-01 >/dev/null 2>&1
rc=$?
if [[ $rc -ne 0 ]]; then
  fail "set-coordinator.sh devolvió rc=$rc"
  exit 1
fi
# Efecto observable, no el rc: el bloque tiene que estar realmente en el fichero.
if grep -qE '^user module-01$' "$LAB/tree/acl" &&
   grep -qF 'topic write targets/v1/module/+/command' "$LAB/tree/acl"; then
  pass "el bloque de coordinador está escrito en la ACL"
else
  fail "set-coordinator.sh dijo rc=0 pero el bloque NO está en la ACL"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2-bis. CALIBRACIÓN: reintroduce a mano el defecto D6 (ACL en 0600).
#        Con MUTATE_ACL_0600=1 esta prueba TIENE que ponerse roja.
# ---------------------------------------------------------------------------
if [[ "${MUTATE_ACL_0600:-0}" == "1" ]]; then
  chmod 0600 "$LAB/tree/acl"
  log "CALIBRACIÓN activa: ACL forzada a $(stat -c '%a' "$LAB/tree/acl") (se espera FALLO)"
fi

ACL_MODE="$(stat -c '%a' "$LAB/tree/acl")"
if [[ "$(( 8#${ACL_MODE} & 8#0044 ))" -eq $(( 8#0044 )) ]]; then
  pass "la ACL queda en modo ${ACL_MODE}: legible por un uid distinto del que edita"
else
  fail "la ACL queda en modo ${ACL_MODE}: el broker (uid 1883) no podrá abrirla"
fi
if [[ "$(( 8#${ACL_MODE} & 8#0022 ))" -ne 0 ]]; then
  fail "la ACL queda ESCRIBIBLE por grupo/otros (modo ${ACL_MODE})"
fi

# F-02: la ACL no autoriza jamás por client_id.
if [[ "$(grep -vE '^\s*#' "$LAB/tree/acl" | grep -c '%c')" -eq 0 ]]; then
  pass "F-02 intacta: cero '%c' en la ACL resultante"
else
  fail "F-02 ROTA: la ACL resultante contiene '%c'"
fi

# ---------------------------------------------------------------------------
# 3. Broker real efímero con esa ACL.
# ---------------------------------------------------------------------------
cat > "$LAB/config/mosquitto.conf" <<'CONF'
persistence false
log_dest stdout
log_type error
log_type warning
log_type notice
log_type information
connection_messages true
listener 1883
protocol mqtt
socket_domain ipv4
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl
use_username_as_clientid true
CONF

# Contraseñas de usar y tirar, creadas DENTRO del contenedor efímero y nunca en
# argv del host ni en el repositorio.
cat > "$LAB/mkpasswd.sh" <<'MK'
#!/bin/sh
set -e
mosquitto_passwd -c -b /mosquitto/config/passwd backend   "$EPH_PW"
mosquitto_passwd    -b /mosquitto/config/passwd module-01 "$EPH_PW"
mosquitto_passwd    -b /mosquitto/config/passwd module-02 "$EPH_PW"
# El passwd SÍ contiene material sensible (hashes): 0600, pero propiedad del
# uid con el que corre el broker (1883). Permisos y PROPIETARIO adecuados al
# proceso; no se relaja a 0644.
chown 1883:1883 /mosquitto/config/passwd
chmod 0600 /mosquitto/config/passwd
MK
chmod +x "$LAB/mkpasswd.sh"

EPH_PW="$(head -c 18 /dev/urandom | base64 | tr -d '=+/')"
printf 'EPH_PW=%s\n' "$EPH_PW" > "$LAB/eph.env"
chmod 0600 "$LAB/eph.env"

docker run --rm --env-file "$LAB/eph.env" \
  -v "$LAB/gen:/mosquitto/config" \
  -v "$LAB/mkpasswd.sh:/mk.sh:ro" \
  "$IMAGE" /mk.sh >/dev/null 2>&1
rc=$?
[[ $rc -eq 0 && -s "$LAB/gen/passwd" ]] || { fail "no se pudo generar el passwd efímero (rc=$rc)"; exit 1; }

docker rm -f "$CID_NAME" >/dev/null 2>&1 || true
# Montajes de FICHERO y :ro, igual que compose.yml. Es deliberado: montar el
# directorio entero en rw deja que el entrypoint de la imagen haga
# `chown -R mosquitto /mosquitto/config` y le REGALE la ACL al broker, con lo
# que un modo 0600 dejaría de doler y la calibración de D6 daría un falso verde.
# Con montajes :ro ese chown falla —como falla en el despliegue real— y la ACL
# conserva el propietario y el modo con que la dejó set-coordinator.sh.
docker run -d --name "$CID_NAME" \
  -v "$LAB/config/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
  -v "$LAB/tree/acl:/mosquitto/config/acl:ro" \
  -v "$LAB/gen/passwd:/mosquitto/config/passwd:ro" \
  "$IMAGE" >/dev/null 2>&1

# Espera a que el broker esté escuchando, o a que muera.
STATE=""
for _ in $(seq 1 30); do
  STATE="$(docker inspect -f '{{.State.Status}}' "$CID_NAME" 2>/dev/null || echo missing)"
  [[ "$STATE" != "running" ]] && break
  if docker logs "$CID_NAME" 2>&1 | grep -q 'mosquitto version .* running'; then break; fi
  sleep 0.5
done
STATE="$(docker inspect -f '{{.State.Status}}' "$CID_NAME" 2>/dev/null || echo missing)"
EXITCODE="$(docker inspect -f '{{.State.ExitCode}}' "$CID_NAME" 2>/dev/null || echo '?')"

if [[ "$STATE" == "running" ]]; then
  pass "el broker ARRANCA con la ACL dejada por set-coordinator.sh"
else
  fail "el broker NO arranca: estado=$STATE exit=$EXITCODE"
  docker logs "$CID_NAME" 2>&1 | tail -5 | sed 's/^/        | /'
  echo
  echo "[d6] RESULTADO: $FAILURES comprobación(es) fallida(s)."
  exit 1
fi

if docker logs "$CID_NAME" 2>&1 | grep -q 'Unable to open acl_file'; then
  fail "el broker registró «Unable to open acl_file»"
else
  pass "sin «Unable to open acl_file» en el log del broker"
fi

# ---------------------------------------------------------------------------
# 4. AUTENTICACIÓN (aquí el rc SÍ discrimina: 135 = no autorizado).
# ---------------------------------------------------------------------------
cat > "$LAB/authok.sh" <<'A1'
#!/bin/sh
mosquitto_pub -h broker -p 1883 -u module-01 -P "$EPH_PW" \
  -t targets/v1/module/module-01/telemetry -m probe
A1
cat > "$LAB/authbad.sh" <<'A2'
#!/bin/sh
mosquitto_pub -h broker -p 1883 -u module-01 -P "definitivamente-no-es-la-buena" \
  -t targets/v1/module/module-01/telemetry -m probe
A2
chmod +x "$LAB/authok.sh" "$LAB/authbad.sh"

docker run --rm --env-file "$LAB/eph.env" --link "$CID_NAME:broker" \
  -v "$LAB/authok.sh:/t.sh:ro" "$IMAGE" /t.sh >/dev/null 2>&1
rc_ok=$?
docker run --rm --env-file "$LAB/eph.env" --link "$CID_NAME:broker" \
  -v "$LAB/authbad.sh:/t.sh:ro" "$IMAGE" /t.sh >/dev/null 2>&1
rc_bad=$?

if [[ $rc_ok -eq 0 ]]; then
  pass "AUTENTICA: credencial válida de module-01 conecta y publica (rc=0)"
else
  fail "credencial válida rechazada (rc=$rc_ok)"
fi
if [[ $rc_bad -ne 0 ]]; then
  pass "AUTENTICA: credencial inválida rechazada (rc=$rc_bad)"
else
  fail "credencial inválida ACEPTADA (rc=0): el broker no está autenticando"
fi

# ---------------------------------------------------------------------------
# 5. ACL APLICADA — por EFECTO OBSERVABLE, nunca por el rc del publicador.
#    module-01 es el coordinador: puede escribir en module/+/command.
#    module-02 no lo es: su PUBLISH debe caer en el vacío (y aun así rc=0).
# ---------------------------------------------------------------------------
cat > "$LAB/aclprobe.sh" <<'A3'
#!/bin/sh
# Suscriptor 'backend' (topic read #) escuchando el tópico de mando de module-09.
mosquitto_sub -h broker -p 1883 -u backend -P "$EPH_PW" \
  -t targets/v1/module/module-09/command -C 1 -W 5 > /out/received.txt 2>/dev/null &
SUB=$!
sleep 1
mosquitto_pub -h broker -p 1883 -u "$PUBUSER" -P "$EPH_PW" \
  -t targets/v1/module/module-09/command -m "$PAYLOAD"
echo "pub_rc=$?" > /out/pub_rc.txt
wait $SUB 2>/dev/null
exit 0
A3
chmod +x "$LAB/aclprobe.sh"

run_acl_probe() {  # $1 = usuario publicador, $2 = payload
  local out="$LAB/out-$1"
  rm -rf "$out"; mkdir -p "$out"
  docker run --rm --env-file "$LAB/eph.env" --link "$CID_NAME:broker" \
    -e "PUBUSER=$1" -e "PAYLOAD=$2" \
    -v "$LAB/aclprobe.sh:/t.sh:ro" -v "$out:/out" \
    "$IMAGE" /t.sh >/dev/null 2>&1
  cat "$out/received.txt" 2>/dev/null || true
}

GOT_COORD="$(run_acl_probe module-01 coordinador-ok)"
GOT_PLAIN="$(run_acl_probe module-02 intruso)"

if [[ "$GOT_COORD" == "coordinador-ok" ]]; then
  pass "ACL APLICADA: el coordinador (module-01) escribe en module/+/command y el mensaje LLEGA"
else
  fail "el coordinador no consigue escribir en module/+/command (recibido: '${GOT_COORD}')"
fi
if [[ -z "$GOT_PLAIN" ]]; then
  pass "ACL APLICADA: module-02 (no coordinador) publica y el mensaje NO llega (denegación silenciosa, rc=0)"
else
  fail "module-02 SÍ escribió en module/+/command: la ACL no se está aplicando (recibido: '${GOT_PLAIN}')"
fi

echo
if [[ $FAILURES -eq 0 ]]; then
  echo "[d6] RESULTADO: PASS — broker real arranca, autentica y aplica ACL después de set-coordinator.sh."
  exit 0
fi
echo "[d6] RESULTADO: FAIL — $FAILURES comprobación(es) fallida(s)."
exit 1
