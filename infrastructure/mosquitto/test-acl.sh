#!/usr/bin/env bash
# ==============================================================================
# Diana · test-acl.sh — verificación de la ACL de Mosquitto contra un broker
# real, sobre TLS.
# ==============================================================================
# QUÉ DEMUESTRA, y por qué está escrito así.
#
# Una prueba de autorización sólo vale si cada control llega REALMENTE a la
# frontera que dice probar. La versión anterior de este script no lo hacía: se
# autenticaba como `module-m1`/`module-m2`, usuarios que NO EXISTEN en el
# broker, así que sus cuatro casos negativos salían en verde porque el cliente
# ni siquiera conseguía conectarse. Cuatro «la ACL bloquea» que en realidad
# eran «la contraseña no existe». Un falso positivo estructural.
#
# De ahí las dos reglas que gobiernan este fichero:
#
#   1. Un rechazo de AUTENTICACIÓN nunca cuenta como demostración de que la
#      AUTORIZACIÓN funciona. Se distinguen, y un AUTH_DENIED donde se esperaba
#      ACL_DENIED es un ERROR del arnés, no un acierto.
#   2. Antes de evaluar nada, las tres identidades tienen que autenticarse
#      (preflight). Si una falla, el script ABORTA: sin identidad válida no hay
#      nada que medir.
#
# CÓMO SE DISTINGUEN (medido contra el broker real de VM109, MQTT 5):
#
#   fallo de autenticación → stderr «Connection error: Not authorized», rc=135
#   denegación de ACL      → stderr «Warning: Publish 1 failed: Not authorized.»
#                            y OJO: rc=0 — el código de salida NO sirve
#   permitido              → sin avisos, rc=0
#
# Los dos textos contienen «Not authorized»: lo que los separa es
# «Connection error» frente a «Publish … failed». Un script que mirase sólo el
# código de salida daría por buena cualquier denegación de ACL.
#
# IDENTIDADES. Dedicadas y desechables, nunca las reales:
#
#   module-acltest-a   módulo de prueba
#   module-acltest-b   segunda identidad, para el intento de suplantación
#   acl-observer       sólo lectura sobre el espacio de nombres de prueba
#
# Ninguna comparte usuario con `backend`. Esto no es estética: con
# `use_username_as_clientid true` el broker reescribe el client_id con el
# usuario autenticado, así que un observador conectado como `backend` tendría
# el MISMO client_id que el backend de producción y ambos se expulsarían en
# bucle — flapping de la ingesta real y resultados envenenados.
#
# Las dos identidades de módulo NO tienen ninguna regla propia en la ACL:
# atraviesan exactamente los mismos `pattern … %c` que `module-01`. Una cuenta
# de prueba con excepciones propias demostraría la política de la prueba, no la
# de producción.
#
# Crear (una vez) y BORRAR al cerrar P0-2:
#   ./generate-users.sh module-acltest-a
#   ./generate-users.sh module-acltest-b
#   ./generate-users.sh acl-observer
#
# USO, desde el HOST de la VM (el 8883 es el único puerto publicado):
#
#   cd /opt/diana/infrastructure/mosquitto
#   ACL_A_PW=… ACL_B_PW=… ACL_OBS_PW=… ./test-acl.sh
#
# Sin argumentos: localhost:8883 validando ./certs/ca.crt. `localhost` está en
# el SAN del certificado, así que la verificación de nombre es real.
# Forma completa: ./test-acl.sh [host] [puerto] [cafile]
#
# HISTORIA DE TRES INSTRUCCIONES FALSAS, para que no haya una cuarta:
#   (1) «ejecútalo desde el host contra 1883» — el 1883 ya no se publicaba.
#   (2) «docker compose exec mosquitto sh -c ./test-acl.sh» — el script no está
#       montado en ese contenedor y la imagen no lleva bash (comprobado).
#   (3) los usuarios module-m1/module-m2 no existían en el broker.
# Las tres se escribieron sin ejecutar lo que se escribía. No corrijas este
# encabezado sin ejecutar antes lo que vayas a poner en él.
#
# CONTRASEÑAS por entorno (ACL_A_PW, ACL_B_PW, ACL_OBS_PW), no por argumento,
# para no dejarlas en el historial ni en `ps`. Mitigación parcial y hay que
# decirlo: mosquitto_pub/sub sólo aceptan la contraseña con `-P`, así que
# aparece en el argv de los procesos hijos igualmente. Lo que se elimina es la
# exposición de la línea que un operador copia y pega.
# ==============================================================================
set -u

HOST="${1:-localhost}"
PORT="${2:-8883}"
CAFILE="${3:-$(cd "$(dirname "$0")" && pwd)/certs/ca.crt}"

U_A="module-acltest-a"
U_B="module-acltest-b"
U_OBS="acl-observer"

# --- Transporte: TLS obligatorio, y falla cerrado -----------------------------
# Verificar la ACL por un canal sin cifrar mediría un broker que P0-2 dice no
# existir, y dejaría el resultado en verde mientras el camino en claro sigue
# vivo. Sin CA se ABORTA, igual que hace el backend. La excepción es un broker
# de pruebas efímero y aislado, y hay que pedirla a gritos.
TLS_ARGS=""
if [ "${ACL_TEST_ALLOW_PLAINTEXT:-0}" = "1" ]; then
    echo "AVISO: ACL_TEST_ALLOW_PLAINTEXT=1 — sin TLS. Sólo para un broker aislado." >&2
elif [ -r "$CAFILE" ]; then
    TLS_ARGS="--cafile $CAFILE"
else
    echo "ERROR: no se puede leer la CA en '$CAFILE'." >&2
    echo "       Sin CA no se valida al broker, y esta prueba NO se ejecuta en" >&2
    echo "       claro contra producción. Genera el material con generate-certs.sh" >&2
    echo "       o indica la ruta: ./test-acl.sh $HOST $PORT /ruta/a/ca.crt" >&2
    exit 2
fi

A_PW="${ACL_A_PW:-}"; B_PW="${ACL_B_PW:-}"; OBS_PW="${ACL_OBS_PW:-}"
[ -n "$A_PW" ]   || { echo "ERROR: falta ACL_A_PW." >&2; exit 2; }
[ -n "$B_PW" ]   || { echo "ERROR: falta ACL_B_PW." >&2; exit 2; }
[ -n "$OBS_PW" ] || { echo "ERROR: falta ACL_OBS_PW." >&2; exit 2; }

# --- Exclusión mutua ----------------------------------------------------------
# `acl-observer` es también identidad de sesión (use_username_as_clientid), así
# que dos ejecuciones simultáneas se expulsarían la una a la otra y las dos
# medirían basura. Mejor negarse que dar un resultado contaminado.
LOCK="${TMPDIR:-/tmp}/diana-test-acl.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
    echo "ERROR: ya hay otra ejecución de test-acl.sh en curso ($LOCK)." >&2
    echo "       Dos observadores con el mismo usuario se expulsan entre sí y" >&2
    echo "       contaminan el resultado. Espera, o borra el directorio si es" >&2
    echo "       un resto de una ejecución muerta." >&2
    exit 3
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

WAIT_SECS=3
PASS=0; FAIL=0; ERROR=0

log_pass()  { echo "  [PASS]  $1"; PASS=$((PASS + 1)); }
log_fail()  { echo "  [FAIL]  $1"; FAIL=$((FAIL + 1)); }
log_error() { echo "  [ERROR] $1"; ERROR=$((ERROR + 1)); }

mpub() { mosquitto_pub -h "$HOST" -p "$PORT" $TLS_ARGS -V 5 "$@"; }
msub() { mosquitto_sub -h "$HOST" -p "$PORT" $TLS_ARGS -V 5 "$@"; }

# --- Clasificador -------------------------------------------------------------
# Imprime exactamente uno de: AUTH_OK_ACL_ALLOWED | AUTH_OK_ACL_DENIED |
# AUTH_DENIED | ERROR. La distinción entre los dos primeros y AUTH_DENIED es
# la razón de ser de este script.
classify_publish() {
    cp_user="$1"; cp_pw="$2"; cp_topic="$3"; cp_payload="$4"
    cp_out="$(mpub -u "$cp_user" -P "$cp_pw" -t "$cp_topic" -m "$cp_payload" -q 1 2>&1)"
    case "$cp_out" in
        *"Connection error"*|*"Connection Refused"*) echo "AUTH_DENIED" ;;
        *"failed: Not authorized"*|*"failed: Not Authorized"*) echo "AUTH_OK_ACL_DENIED" ;;
        "") echo "AUTH_OK_ACL_ALLOWED" ;;
        *) echo "ERROR" ;;
    esac
}

# Espera ACL_DENIED. Un AUTH_DENIED aquí NO es un acierto: significa que el
# control no llegó a tocar la ACL. Ésta es exactamente la lección de D-1.
expect_denied() {
    ed_desc="$1"; ed_user="$2"; ed_pw="$3"; ed_topic="$4"
    case "$(classify_publish "$ed_user" "$ed_pw" "$ed_topic" "test-acl-$$")" in
        AUTH_OK_ACL_DENIED)  log_pass "$ed_desc · ACL_DENIED (autenticado, denegado)" ;;
        AUTH_OK_ACL_ALLOWED) log_fail "$ed_desc · ACL_ALLOWED — la ACL NO bloquea" ;;
        AUTH_DENIED)         log_error "$ed_desc · AUTH_DENIED — el control no alcanzó la ACL; NO cuenta como prueba" ;;
        *)                   log_error "$ed_desc · resultado inclasificable" ;;
    esac
}

expect_allowed() {
    ea_desc="$1"; ea_user="$2"; ea_pw="$3"; ea_topic="$4"
    case "$(classify_publish "$ea_user" "$ea_pw" "$ea_topic" "test-acl-$$")" in
        AUTH_OK_ACL_ALLOWED) log_pass "$ea_desc · ACL_ALLOWED" ;;
        AUTH_OK_ACL_DENIED)  log_fail "$ea_desc · ACL_DENIED — permiso legítimo roto" ;;
        AUTH_DENIED)         log_error "$ea_desc · AUTH_DENIED — credencial inválida, no es un resultado de ACL" ;;
        *)                   log_error "$ea_desc · resultado inclasificable" ;;
    esac
}

echo "=== PREFLIGHT · las tres identidades deben AUTENTICARSE ==="
# Sin esto, todo lo demás es el falso positivo de D-1 otra vez.
preflight_fail=0
for u_p in "$U_A|$A_PW" "$U_B|$B_PW"; do
    u="${u_p%%|*}"; p="${u_p#*|}"
    if [ "$(classify_publish "$u" "$p" "targets/v1/module/$u/presence" "preflight-$$")" = "AUTH_DENIED" ]; then
        echo "  [ERROR] $u NO se autentica. ¿Existe en passwd? ./generate-users.sh $u" >&2
        preflight_fail=1
    else
        echo "  [ OK  ] $u autentica (AUTH_OK)"
    fi
done
# El observador se valida leyendo, que es lo único que se le permite. Hay que
# separar «se conectó y no había mensajes» de «no se pudo autenticar»: sólo lo
# segundo es fatal, y -W devuelve código != 0 en ambos casos.
obs_out="$(msub -u "$U_OBS" -P "$OBS_PW" -t "targets/v1/module/$U_A/presence" -C 1 -W 1 2>&1)"
case "$obs_out" in
    *"Connection error"*|*"Connection Refused"*)
        echo "  [ERROR] $U_OBS NO se autentica. ./generate-users.sh $U_OBS" >&2
        preflight_fail=1 ;;
    *)  echo "  [ OK  ] $U_OBS autentica (AUTH_OK)" ;;
esac
if [ "$preflight_fail" -ne 0 ]; then
    echo "" >&2
    echo "ABORTADO: sin identidades válidas no hay nada que medir." >&2
    exit 4
fi

echo ""
echo "=== 1. Cliente anónimo no debe poder conectar ==="
if timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" $TLS_ARGS -V 5 \
    -t "targets/v1/module/$U_A/presence" -m '{}' >/dev/null 2>&1; then
    log_fail "el cliente anónimo pudo publicar (allow_anonymous debería ser false)"
else
    log_pass "el cliente anónimo no pudo conectar (AUTH_DENIED, que aquí SÍ es lo correcto)"
fi

echo "=== 2. Credencial incorrecta muere en autenticación, y no cuenta como ACL ==="
r="$(classify_publish "$U_A" "contrasena-incorrecta-a-proposito" \
        "targets/v1/module/$U_A/presence" 'x')"
if [ "$r" = "AUTH_DENIED" ]; then
    log_pass "credencial incorrecta → AUTH_DENIED (el clasificador los separa)"
else
    log_error "credencial incorrecta → $r; el clasificador NO distingue auth de ACL"
fi

echo "=== 3. Control positivo: cada módulo publica en su propio espacio ==="
expect_allowed "$U_A escribe su presence" "$U_A" "$A_PW" "targets/v1/module/$U_A/presence"
expect_allowed "$U_B escribe su presence" "$U_B" "$B_PW" "targets/v1/module/$U_B/presence"

echo "=== 4. Suplantación entre módulos, en ambos sentidos ==="
expect_denied "$U_A escribe el presence de $U_B" "$U_A" "$A_PW" "targets/v1/module/$U_B/presence"
expect_denied "$U_B escribe el presence de $U_A" "$U_B" "$B_PW" "targets/v1/module/$U_A/presence"

echo "=== 5. Tópicos de sólo lectura para el módulo (fallo original del contrato) ==="
expect_denied "$U_A escribe su config/desired" "$U_A" "$A_PW" "targets/v1/module/$U_A/config/desired"
expect_denied "$U_A escribe su command"        "$U_A" "$A_PW" "targets/v1/module/$U_A/command"
expect_denied "$U_A escribe su ota"            "$U_A" "$A_PW" "targets/v1/module/$U_A/ota"

echo "=== 6. El observador VE el mensaje positivo (control causal) ==="
# Suscriptor primero, publicador después: al revés se pierde el mensaje y el
# fallo se confundiría con una denegación.
OBS_OUT="$(mktemp)"
msub -u "$U_OBS" -P "$OBS_PW" -t "targets/v1/module/$U_A/presence" \
     -C 1 -W "$WAIT_SECS" >"$OBS_OUT" 2>/dev/null &
OBS_PID=$!
sleep 1
MARK="observado-$$"
mpub -u "$U_A" -P "$A_PW" -t "targets/v1/module/$U_A/presence" -m "$MARK" -q 1 >/dev/null 2>&1
wait "$OBS_PID" 2>/dev/null
if grep -q "$MARK" "$OBS_OUT" 2>/dev/null; then
    log_pass "MESSAGE_OBSERVED · el permiso concedido produce un efecto visible"
else
    log_fail "MESSAGE_NOT_OBSERVED · el positivo no llegó; el resto no es interpretable"
fi
rm -f "$OBS_OUT"

echo "=== 7. El observador NO puede publicar ==="
expect_denied "$U_OBS publica en el espacio de prueba" "$U_OBS" "$OBS_PW" \
    "targets/v1/module/$U_A/presence"

echo ""
echo "=== Resumen: ${PASS} correctos, ${FAIL} fallos, ${ERROR} errores de arnés ==="
if [ "$ERROR" -gt 0 ]; then
    echo "HAY ERRORES DE ARNÉS: algún control no alcanzó la frontera que decía" >&2
    echo "probar. El resultado NO demuestra la política de autorización." >&2
    exit 1
fi
[ "$FAIL" -gt 0 ] && exit 1
exit 0
