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
# F-02 (crítico, cerrado): el usuario mosquitto de un módulo es EXACTAMENTE su
# module_id, sin prefijo "module-" (ver generate-users.sh y mosquitto.conf,
# use_username_as_clientid true). Este script usa "m01"/"m02" como usuario Y
# module_id a la vez.
#
# *** Efecto colateral de use_username_as_clientid, encontrado al escribir
# esta prueba: el broker fuerza client_id = usuario autenticado, así que DOS
# conexiones simultáneas con el MISMO usuario (p. ej. "backend" publicando en
# una conexión mientras "backend" observa en otra) reciben el MISMO client_id
# y MQTT no permite dos clientes con igual client_id conectados a la vez: la
# segunda conexión desaloja a la primera ("Client backend already connected,
# closing old connection", visto en el log del broker). La versión anterior
# de este script backgroundeaba el publish y hacía una suscripción
# concurrente con el MISMO usuario para los pasos de "backend" — con
# use_username_as_clientid eso ya no es fiable (colisión de client_id, no una
# carrera de timing). Por eso aquí NO se abren dos conexiones concurrentes
# con el mismo usuario: cada paso publica en RETAIN, espera a que el
# publicador termine y se desconecte del todo, y sólo entonces suscribe (los
# mensajes retenidos se entregan a un suscriptor nuevo aunque nadie estuviera
# escuchando en el momento de publicarlos). Al final de cada paso se limpia
# el retenido (payload vacío) para no contaminar el siguiente run.
#
# Esto también es una advertencia para producción: si el backend llegara a
# tener alguna vez MÁS DE UNA conexión MQTT simultánea con el usuario
# "backend" (p. ej. réplicas horizontales sin un client_id derivado por
# instancia), se desalojarían entre sí en bucle. Con una única instancia de
# backend (la actual) no aplica, pero queda documentado para quien escale el
# servicio.
#
# Requisitos previos (una vez, contra el broker de destino):
#   ./generate-users.sh backend
#   ./generate-users.sh m01
#   ./generate-users.sh m02
#   ./set-coordinator.sh m02   (para las pruebas 8/9, que necesitan un
#                              coordinador activo; --none para dejarlo como
#                              estaba al terminar)
#
# Uso:
#   ./test-acl.sh <host> <puerto> <backend_password> <m01_password> <m02_password>
#
# Ejemplo contra el stack local (desde el host, con el puerto 1883 publicado):
#   ./test-acl.sh 127.0.0.1 1883 "$BACKEND_PW" "$M01_PW" "$M02_PW"
#
# Qué comprueba (todas las rutas negativas deben FALLAR; success = ACL correcta):
#    1. Cliente anónimo no puede ni conectar (allow_anonymous false).
#    2. m01 SÍ puede escribir su propio presence (permiso concedido).
#    3. m01 NO puede escribir el presence de m02 (aislamiento entre módulos: un
#       módulo comprometido no debe poder suplantar a otro).
#    4. m01 NO puede escribir su propio config/desired (sólo lectura para el
#       módulo; sólo el backend escribe ahí).
#    5. m01 NO puede escribir su propio command (sólo lectura).
#    6. m01 NO puede escribir su propio ota (sólo lectura; sólo el backend
#       escribe ahí).
#    7. backend SÍ puede escribir targets/v1/system/+/status (permiso backend).
#    8. backend SÍ puede escribir targets/v1/module/+/maintenance/command
#       (Trabajo 1: canal de mantenimiento, separado del canal de juego).
#    9. backend NO puede escribir targets/v1/module/+/command (el canal de
#       juego: el operador ha prohibido expresamente que exista un puente que
#       dé al backend ese permiso, bajo ninguna circunstancia).
#   10. el coordinador (m02, activado con set-coordinator.sh) SÍ puede
#       escribir targets/v1/module/+/command (autoridad exclusiva de juego).
#   11. m01 puede leer su propio maintenance/command (publicado por backend).
#   12. F-02: m01, autenticado con SUS credenciales pero declarando
#       client_id=m02 en el CONNECT, NO puede publicar en el hit de m02 (antes
#       de la corrección esta prueba FALLABA — confirmado en vivo el
#       2026-07-21 con exactamente este ataque; con use_username_as_clientid
#       true el broker reescribe el client_id declarado con el usuario
#       autenticado antes de evaluar la ACL, así que la suplantación deja de
#       ser posible).
#
# Método: cada comprobación de escritura publica con -r (retain) usando una
# única conexión de corta vida (mosquitto_pub se conecta, publica y se
# desconecta él solo) y luego, YA con el publicador desconectado, suscribe
# con -C 1 para leer el retenido (o el timeout, si la ACL lo bloqueó). Tras
# leerlo, se limpia el retenido publicando un payload vacío en el mismo
# tópico con las credenciales que sí tienen permiso de escritura ahí
# (siempre backend, que puede escribir en todo salvo module/+/command).
# ==============================================================================
set -u

HOST="${1:?Uso: test-acl.sh <host> <puerto> <backend_password> <m01_password> <m02_password>}"
PORT="${2:?falta el puerto}"
BACKEND_PW="${3:?falta la contraseña de backend}"
M1_PW="${4:?falta la contraseña de m01}"
M2_PW="${5:?falta la contraseña de m02}"

WAIT_SECS=4
PASS=0
FAIL=0

log_pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

# publish_retained <user> <pass> <topic> <payload>
# Publica retenido, síncrono: al volver, la conexión ya está cerrada.
publish_retained() {
    local user="$1" pass="$2" topic="$3" payload="$4"
    timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" \
        -u "$user" -P "$pass" -t "$topic" -m "$payload" -q 1 -r 2>/dev/null
}

# read_retained <user> <pass> <topic>
# Suscribe y lee UN mensaje (el retenido, si lo hay y el permiso de lectura
# existe). Se ejecuta SIEMPRE después de que el publicador ya se desconectó.
read_retained() {
    local user="$1" pass="$2" topic="$3"
    timeout "$WAIT_SECS" mosquitto_sub -h "$HOST" -p "$PORT" \
        -u "$user" -P "$pass" -t "$topic" -C 1 2>/dev/null
}

# clear_retained <user> <pass> <topic>  — limpia con un publicador autorizado
clear_retained() {
    local user="$1" pass="$2" topic="$3"
    timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" \
        -u "$user" -P "$pass" -t "$topic" -n -q 1 -r 2>/dev/null
}

# check_write <descripcion_ok> <descripcion_fail_pass> <user_pub> <pass_pub> <topic> <payload> <expect_ok:0|1> <user_clean> <pass_clean>
check_write() {
    local msg_expected="$1" msg_denied="$2" user="$3" pass="$4" topic="$5" payload="$6" \
          expect_ok="$7" clean_user="$8" clean_pass="$9"
    publish_retained "$user" "$pass" "$topic" "$payload"
    local got
    got="$(read_retained backend "$BACKEND_PW" "$topic")"
    if [[ "$expect_ok" == "1" ]]; then
        if [ -n "$got" ]; then log_pass "$msg_expected"; else log_fail "$msg_denied"; fi
    else
        if [ -n "$got" ]; then log_fail "$msg_denied"; else log_pass "$msg_expected"; fi
    fi
    clear_retained "$clean_user" "$clean_pass" "$topic"
}

echo "=== 1. Cliente anónimo no debe poder conectar ==="
if timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" \
    -t 'targets/v1/module/m01/presence' -m '{}' 2>/dev/null; then
    log_fail "el cliente anónimo pudo publicar (allow_anonymous debería ser false)"
else
    log_pass "el cliente anónimo no pudo conectar/publicar"
fi

echo "=== 2. m01 puede escribir su propio presence ==="
check_write "m01 pudo escribir su propio presence (esperado)" \
    "m01 NO pudo escribir su propio presence (permiso roto)" \
    m01 "$M1_PW" 'targets/v1/module/m01/presence' 'test-acl-presence' 1 backend "$BACKEND_PW"

echo "=== 3. m01 NO puede escribir el presence de m02 ==="
check_write "m01 no pudo escribir el presence de m02" \
    "m01 pudo escribir el presence de m02 (fuga de ACL)" \
    m01 "$M1_PW" 'targets/v1/module/m02/presence' 'suplantacion' 0 backend "$BACKEND_PW"

echo "=== 4. m01 NO puede escribir su propio config/desired ==="
check_write "m01 no pudo escribir su propio config/desired" \
    "m01 pudo escribir su propio config/desired (el fallo original del contrato)" \
    m01 "$M1_PW" 'targets/v1/module/m01/config/desired' 'auto-config' 0 backend "$BACKEND_PW"

echo "=== 5. m01 NO puede escribir su propio command ==="
check_write "m01 no pudo escribir su propio command" \
    "m01 pudo escribir su propio command" \
    m01 "$M1_PW" 'targets/v1/module/m01/command' 'auto-command' 0 backend "$BACKEND_PW"

echo "=== 6. m01 NO puede escribir su propio ota ==="
check_write "m01 no pudo escribir su propio ota" \
    "m01 pudo escribir su propio ota" \
    m01 "$M1_PW" 'targets/v1/module/m01/ota' 'auto-ota' 0 backend "$BACKEND_PW"

echo "=== 7. backend puede escribir targets/v1/system/+/status ==="
check_write "backend pudo escribir system/s1/status (esperado)" \
    "backend NO pudo escribir system/s1/status (permiso roto)" \
    backend "$BACKEND_PW" 'targets/v1/system/s1/status' 'test-acl-backend' 1 backend "$BACKEND_PW"

echo "=== 8. backend puede escribir targets/v1/module/m01/maintenance/command ==="
check_write "backend pudo escribir maintenance/command de m01 (esperado, Trabajo 1)" \
    "backend NO pudo escribir maintenance/command de m01 (canal de mantenimiento roto)" \
    backend "$BACKEND_PW" 'targets/v1/module/m01/maintenance/command' 'reboot' 1 backend "$BACKEND_PW"

echo "=== 9. backend NO puede escribir targets/v1/module/m01/command (canal de juego) ==="
check_write "backend no pudo escribir module/m01/command (separación de autoridad respetada)" \
    "backend pudo escribir module/m01/command (PUENTE PROHIBIDO: el backend no debe poder mandar órdenes de juego)" \
    backend "$BACKEND_PW" 'targets/v1/module/m01/command' 'orden-de-juego-desde-backend' 0 backend "$BACKEND_PW"

echo "=== 10. el coordinador (m02) SÍ puede escribir targets/v1/module/+/command ==="
check_write "m02 (coordinador) pudo escribir module/m01/command (esperado)" \
    "m02 (coordinador) NO pudo escribir module/m01/command (rol de coordinador roto o no activado — ¿se ejecutó ./set-coordinator.sh m02?)" \
    m02 "$M2_PW" 'targets/v1/module/m01/command' 'orden-de-juego-desde-coordinador' 1 m02 "$M2_PW"

echo "=== 11. m01 puede leer su propio maintenance/command ==="
publish_retained backend "$BACKEND_PW" 'targets/v1/module/m01/maintenance/command' 'reboot-read-test'
M1_READ="$(read_retained m01 "$M1_PW" 'targets/v1/module/m01/maintenance/command')"
if [ -n "$M1_READ" ]; then
    log_pass "m01 pudo leer su propio maintenance/command (esperado)"
else
    log_fail "m01 NO pudo leer su propio maintenance/command (permiso roto)"
fi
clear_retained backend "$BACKEND_PW" 'targets/v1/module/m01/maintenance/command'

echo "=== 12. F-02: m01 con credenciales propias pero client_id=m02 NO puede suplantar a m02 ==="
timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" -u m01 -P "$M1_PW" -i "m02" \
    -t 'targets/v1/module/m02/hit' -m '{"suplantado_por":"m01"}' -q 1 -r 2>/dev/null
F02_READ="$(read_retained backend "$BACKEND_PW" 'targets/v1/module/m02/hit')"
if [ -n "$F02_READ" ]; then
    log_fail "m01 con client_id=m02 pudo escribir en module/m02/hit (F-02 SIGUE ABIERTO): $F02_READ"
else
    log_pass "m01 con client_id=m02 no pudo escribir en module/m02/hit (F-02 cerrado)"
fi
clear_retained backend "$BACKEND_PW" 'targets/v1/module/m02/hit'

echo ""
echo "=== Resumen: ${PASS} correctos, ${FAIL} fallos ==="
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
