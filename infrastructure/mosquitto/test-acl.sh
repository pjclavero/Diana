#!/usr/bin/env bash
# ==============================================================================
# Diana · test-acl.sh — verificación de la ACL de Mosquitto contra un broker
# real (no requiere daemon Docker: se ejecuta con mosquitto_pub/mosquitto_sub
# apuntando a un mosquitto en marcha, típicamente en la VM de WP-08).
# ==============================================================================
# Este repositorio (WP-01) NO tiene daemon Docker ni un broker real donde
# ejecutar esto: se entrega como prueba documentada/ejecutable para que WP-08
# (o WP-11, calidad) la corra en un entorno con Mosquitto vivo, tras generar
# los usuarios de prueba con generate-users.sh.
#
# Requisitos previos (una vez, contra el broker de destino):
#   ./generate-users.sh backend
#   ./generate-users.sh module-m1
#   ./generate-users.sh module-m2
#
# Uso (P0-2: TLS por defecto, desde el HOST de la VM):
#
#   cd /opt/diana/infrastructure/mosquitto
#   ACL_BACKEND_PW=... ACL_M1_PW=... ACL_M2_PW=... ./test-acl.sh
#
# Sin argumentos apunta a localhost:8883 y valida contra ./certs/ca.crt. El
# `localhost` está en el SAN del certificado del servidor junto a `mosquitto`,
# `127.0.0.1` y la IP de la LAN, así que la verificación de nombre es real, no
# un rodeo. Forma completa:
#
#   ./test-acl.sh [host] [puerto] [cafile]
#
# HISTORIA DE DOS INSTRUCCIONES FALSAS, escrita aquí para que no haya una
# tercera. (1) Este encabezado decía «ejecútalo desde el host contra 1883»
# cuando el 1883 ya no se publicaba. (2) La corrección decía «ejecútalo con
# `docker compose exec mosquitto sh -c ./test-acl.sh`», y eso TAMPOCO funciona:
# el script no está montado en ese contenedor y la imagen `eclipse-mosquitto`
# no lleva bash (COMPROBADO en VM109, 2026-08-13). Lo que sí es cierto y está
# comprobado es que el host de la VM tiene mosquitto_pub, mosquitto_sub, bash y
# la CA legible. Antes de cambiar esta línea, EJECUTA lo que vayas a escribir.
#
# CONTRASEÑAS: se leen preferentemente del entorno (ACL_BACKEND_PW, ACL_M1_PW,
# ACL_M2_PW) para no dejarlas en el historial del shell ni en `ps`. Se aceptan
# aún como argumentos 4/5/6 por compatibilidad, avisando. Mitigación parcial y
# hay que decirlo: mosquitto_pub/mosquitto_sub sólo aceptan la contraseña con
# `-P`, así que aparece en el argv de los procesos HIJOS de todos modos. Lo que
# esto elimina es la exposición de la línea que un operador copia y pega.
#
# Qué comprueba (todas las rutas negativas deben FALLAR; success = ACL correcta):
#   1. Cliente anónimo no puede ni conectar (allow_anonymous false).
#   2. module-m1 SÍ puede escribir su propio presence (permiso concedido).
#   3. module-m1 NO puede escribir el presence de module-m2 (aislamiento entre
#      módulos: un módulo comprometido no debe poder suplantar a otro).
#   4. module-m1 NO puede escribir su propio config/desired (sólo lectura para
#      el módulo; sólo el backend escribe ahí — éste es justo el fallo de
#      contrato que se corrigió: antes un comodín de escritura lo permitía).
#   5. module-m1 NO puede escribir su propio command (sólo lectura).
#   6. module-m1 NO puede escribir su propio ota (sólo lectura; sólo el
#      backend escribe ahí).
#   7. backend SÍ puede escribir targets/v1/system/+/status (permiso backend).
#
# Método: como MQTT 3.1.1 no siempre devuelve un error explícito al cliente
# cuando el PUBLISH es rechazado por ACL (el broker simplemente no lo
# entrega), la detección real de "escritura denegada" se hace con un
# suscriptor autorizado (backend, que lee '#') esperando el mensaje con
# timeout: si no llega, la escritura fue bloqueada por la ACL, que es el
# resultado correcto para los casos negativos.
# ==============================================================================
set -u

HOST="${1:-localhost}"
PORT="${2:-8883}"
CAFILE="${3:-$(cd "$(dirname "$0")" && pwd)/certs/ca.crt}"

# --- Transporte: TLS obligatorio, y falla cerrado -----------------------------
# Verificar la ACL a través de un canal sin cifrar mediría la ACL de un broker
# que P0-2 dice no existir, y dejaría el resultado en verde mientras el camino
# en claro sigue vivo. Por eso la ausencia de CA ABORTA en lugar de degradar a
# texto en claro: exactamente el mismo criterio que el backend.
#
# La única excepción es un broker de pruebas efímero y aislado, y hay que
# pedirla a gritos con ACL_TEST_ALLOW_PLAINTEXT=1. Nunca contra producción.
TLS_ARGS=""
if [ "${ACL_TEST_ALLOW_PLAINTEXT:-0}" = "1" ]; then
    echo "AVISO: ACL_TEST_ALLOW_PLAINTEXT=1 — sin TLS. Sólo para un broker de pruebas aislado." >&2
elif [ -r "$CAFILE" ]; then
    TLS_ARGS="--cafile $CAFILE"
else
    echo "ERROR: no se puede leer la CA en '$CAFILE'." >&2
    echo "       Sin CA no se puede validar al broker, y esta prueba NO se ejecuta" >&2
    echo "       en claro contra producción. Genera el material con generate-certs.sh" >&2
    echo "       o indica la ruta: ./test-acl.sh $HOST $PORT /ruta/a/ca.crt" >&2
    exit 2
fi

# Envoltorios: un único punto donde se decide el transporte. Con --cafile,
# mosquitto_pub/sub validan la cadena Y el nombre del servidor contra -h.
mpub() { mosquitto_pub -h "$HOST" -p "$PORT" $TLS_ARGS "$@"; }
msub() { mosquitto_sub -h "$HOST" -p "$PORT" $TLS_ARGS "$@"; }

# Contraseñas: entorno primero, argumentos 4/5/6 como compatibilidad.
BACKEND_PW="${ACL_BACKEND_PW:-${4:-}}"
M1_PW="${ACL_M1_PW:-${5:-}}"
M2_PW="${ACL_M2_PW:-${6:-}}"
if [ -n "${4:-}${5:-}${6:-}" ]; then
    echo "AVISO: contraseñas pasadas como argumentos; usa ACL_BACKEND_PW/ACL_M1_PW/ACL_M2_PW." >&2
fi
for v in BACKEND_PW M1_PW M2_PW; do
    eval "val=\${$v}"
    [ -n "$val" ] || { echo "ERROR: falta la contraseña $v (entorno ACL_$v)." >&2; exit 2; }
done

WAIT_SECS=3
PASS=0
FAIL=0

log_pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

# --- Utilidad: intenta recibir UN mensaje en $topic durante $WAIT_SECS,
#     autenticado como backend (que tiene 'topic read #'). Devuelve 0 si
#     llegó un mensaje, 1 si no llegó nada (timeout).
expect_message_on() {
    topic="$1"
    # -C 1 -W $WAIT_SECS: el propio mosquitto_sub corta. Antes lo cortaba
    # `timeout` desde fuera, que no puede invocar a la función msub().
    payload="$(msub -u backend -P "$BACKEND_PW" -t "$topic" \
        -C 1 -W "$WAIT_SECS" -i "test-acl-observer-$$" 2>/dev/null)"
    [ -n "$payload" ]
}

echo "=== 1. Cliente anónimo no debe poder conectar ==="
if timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" $TLS_ARGS \
    -t 'targets/v1/module/m1/presence' -m '{}' 2>/dev/null; then
    log_fail "el cliente anónimo pudo publicar (allow_anonymous debería ser false)"
else
    log_pass "el cliente anónimo no pudo conectar/publicar"
fi

echo "=== 2. module-m1 puede escribir su propio presence ==="
PROBE_TOPIC="targets/v1/module/m1/presence"
PROBE_PAYLOAD="test-acl-$$-presence"
mpub -u module-m1 -P "$M1_PW" \
    -t "$PROBE_TOPIC" -m "$PROBE_PAYLOAD" -q 1 -i "test-acl-m1-pub-$$" 2>/dev/null &
if expect_message_on "$PROBE_TOPIC"; then
    log_pass "module-m1 pudo escribir su propio presence (esperado)"
else
    log_fail "module-m1 NO pudo escribir su propio presence (permiso roto)"
fi
wait 2>/dev/null

echo "=== 3. module-m1 NO puede escribir el presence de module-m2 ==="
mpub -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m2/presence' -m 'suplantacion' -q 1 -i "test-acl-m1-spoof-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m2/presence'; then
    log_fail "module-m1 pudo escribir el presence de module-m2 (fuga de ACL)"
else
    log_pass "module-m1 no pudo escribir el presence de module-m2"
fi
wait 2>/dev/null

echo "=== 4. module-m1 NO puede escribir su propio config/desired ==="
mpub -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m1/config/desired' -m 'auto-config' -q 1 -i "test-acl-m1-cfg-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m1/config/desired'; then
    log_fail "module-m1 pudo escribir su propio config/desired (el fallo original del contrato)"
else
    log_pass "module-m1 no pudo escribir su propio config/desired"
fi
wait 2>/dev/null

echo "=== 5. module-m1 NO puede escribir su propio command ==="
mpub -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m1/command' -m 'auto-command' -q 1 -i "test-acl-m1-cmd-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m1/command'; then
    log_fail "module-m1 pudo escribir su propio command"
else
    log_pass "module-m1 no pudo escribir su propio command"
fi
wait 2>/dev/null

echo "=== 6. module-m1 NO puede escribir su propio ota ==="
mpub -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m1/ota' -m 'auto-ota' -q 1 -i "test-acl-m1-ota-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m1/ota'; then
    log_fail "module-m1 pudo escribir su propio ota"
else
    log_pass "module-m1 no pudo escribir su propio ota"
fi
wait 2>/dev/null

echo "=== 7. backend puede escribir targets/v1/system/+/status ==="
mpub -u backend -P "$BACKEND_PW" \
    -t 'targets/v1/system/s1/status' -m 'test-acl-backend' -q 1 -i "test-acl-backend-pub-$$" 2>/dev/null &
if expect_message_on 'targets/v1/system/s1/status'; then
    log_pass "backend pudo escribir system/s1/status (esperado)"
else
    log_fail "backend NO pudo escribir system/s1/status (permiso roto)"
fi
wait 2>/dev/null

echo ""
echo "=== Resumen: ${PASS} correctos, ${FAIL} fallos ==="
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
