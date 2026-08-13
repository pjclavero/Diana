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
# Uso:
#   ./test-acl.sh <host> <puerto> <backend_password> <m1_password> <m2_password>
#
# OJO (P0-2, 2026-08-13): desde el host YA NO FUNCIONA. El 1883 dejó de
# publicarse; sólo se publica 8883 con TLS, y este script todavía no sabe
# hablar TLS (no pasa --cafile en ninguna invocación). Mientras siga así, hay
# que ejecutarlo DENTRO de la red de Docker, contra el listener 1883 interno:
#
#   docker compose exec mosquitto sh -c \
#     './test-acl.sh 127.0.0.1 1883 "$BACKEND_PW" "$M1_PW" "$M2_PW"'
#
# Dotar de TLS a este script es la condición para cerrar ese listener interno
# (ver infrastructure/mosquitto/mosquitto.conf, bloque del paso 10). Si alguien
# "arregla" el fallo republicando el 1883 al host, deshace P0-2 entero.
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

HOST="${1:?Uso: test-acl.sh <host> <puerto> <backend_password> <m1_password> <m2_password>}"
PORT="${2:?falta el puerto}"
BACKEND_PW="${3:?falta la contraseña de backend}"
M1_PW="${4:?falta la contraseña de module-m1}"
M2_PW="${5:?falta la contraseña de module-m2}"

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
    payload="$(timeout "$WAIT_SECS" mosquitto_sub -h "$HOST" -p "$PORT" \
        -u backend -P "$BACKEND_PW" -t "$topic" -C 1 -i "test-acl-observer-$$" 2>/dev/null)"
    [ -n "$payload" ]
}

echo "=== 1. Cliente anónimo no debe poder conectar ==="
if timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" \
    -t 'targets/v1/module/m1/presence' -m '{}' 2>/dev/null; then
    log_fail "el cliente anónimo pudo publicar (allow_anonymous debería ser false)"
else
    log_pass "el cliente anónimo no pudo conectar/publicar"
fi

echo "=== 2. module-m1 puede escribir su propio presence ==="
PROBE_TOPIC="targets/v1/module/m1/presence"
PROBE_PAYLOAD="test-acl-$$-presence"
mosquitto_pub -h "$HOST" -p "$PORT" -u module-m1 -P "$M1_PW" \
    -t "$PROBE_TOPIC" -m "$PROBE_PAYLOAD" -q 1 -i "test-acl-m1-pub-$$" 2>/dev/null &
if expect_message_on "$PROBE_TOPIC"; then
    log_pass "module-m1 pudo escribir su propio presence (esperado)"
else
    log_fail "module-m1 NO pudo escribir su propio presence (permiso roto)"
fi
wait 2>/dev/null

echo "=== 3. module-m1 NO puede escribir el presence de module-m2 ==="
mosquitto_pub -h "$HOST" -p "$PORT" -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m2/presence' -m 'suplantacion' -q 1 -i "test-acl-m1-spoof-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m2/presence'; then
    log_fail "module-m1 pudo escribir el presence de module-m2 (fuga de ACL)"
else
    log_pass "module-m1 no pudo escribir el presence de module-m2"
fi
wait 2>/dev/null

echo "=== 4. module-m1 NO puede escribir su propio config/desired ==="
mosquitto_pub -h "$HOST" -p "$PORT" -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m1/config/desired' -m 'auto-config' -q 1 -i "test-acl-m1-cfg-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m1/config/desired'; then
    log_fail "module-m1 pudo escribir su propio config/desired (el fallo original del contrato)"
else
    log_pass "module-m1 no pudo escribir su propio config/desired"
fi
wait 2>/dev/null

echo "=== 5. module-m1 NO puede escribir su propio command ==="
mosquitto_pub -h "$HOST" -p "$PORT" -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m1/command' -m 'auto-command' -q 1 -i "test-acl-m1-cmd-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m1/command'; then
    log_fail "module-m1 pudo escribir su propio command"
else
    log_pass "module-m1 no pudo escribir su propio command"
fi
wait 2>/dev/null

echo "=== 6. module-m1 NO puede escribir su propio ota ==="
mosquitto_pub -h "$HOST" -p "$PORT" -u module-m1 -P "$M1_PW" \
    -t 'targets/v1/module/m1/ota' -m 'auto-ota' -q 1 -i "test-acl-m1-ota-$$" 2>/dev/null &
if expect_message_on 'targets/v1/module/m1/ota'; then
    log_fail "module-m1 pudo escribir su propio ota"
else
    log_pass "module-m1 no pudo escribir su propio ota"
fi
wait 2>/dev/null

echo "=== 7. backend puede escribir targets/v1/system/+/status ==="
mosquitto_pub -h "$HOST" -p "$PORT" -u backend -P "$BACKEND_PW" \
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
