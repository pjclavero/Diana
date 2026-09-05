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
# module_id (ver generate-users.sh y mosquitto.conf, use_username_as_clientid
# true).
#
# MP0-A: este script YA NO lleva identidades escritas a mano. Antes usaba
# "m01"/"m02", que NO existen en la fuente única (infrastructure/mosquitto/
# identities.json: backend, healthcheck, module-01..module-09): con esos
# usuarios el CONNECT falla (rc=135, "Not authorized") y TODAS las pruebas
# negativas pasan por ausencia de mensaje — un falso verde. Ahora los dos
# módulos de prueba se leen de la fuente única con
#   node generate-identities.mjs --list-users
# y el paso 0 exige que MOD_A pueda autenticarse y publicar lo suyo ANTES de
# interpretar ninguna denegación: un DENY por credencial inexistente (rc=135)
# y un DENY por ACL (rc=0 con "Publish ... failed: Not authorized") son
# indistinguibles desde la ausencia de retenido.
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
#   ./generate-users.sh --all      (crea las 11 identidades de la fuente única)
#   ./set-coordinator.sh <MOD_B>   (para las pruebas 8/9, que necesitan un
#                                  coordinador activo; --none para dejarlo como
#                                  estaba al terminar)
#
# Uso (las contraseñas se pasan por ENTORNO, nunca en argv):
#   MQTT_BACKEND_PASSWORD=... MQTT_PASSWORD_A=... MQTT_PASSWORD_B=... \
#       ./test-acl.sh <host> <puerto> [mod_a] [mod_b]
#
# Contra el listener TLS (8883), añade la CA por entorno:
#   MQTT_CAFILE=infrastructure/mosquitto/certs/ca.crt \
#   MQTT_BACKEND_PASSWORD=... MQTT_PASSWORD_A=... MQTT_PASSWORD_B=... \
#       ./test-acl.sh localhost 8883
#
# GAP conocido y no cerrado aquí: mosquitto_pub/mosquitto_sub sólo aceptan la
# contraseña con -P, es decir en su propio argv. Este script evita el secreto
# en el argv DEL SCRIPT (y por tanto en el historial del operador), pero no
# puede evitarlo en el argv del cliente mosquitto. Ejecutar sólo en un host de
# pruebas.
#
# Qué comprueba (todas las rutas negativas deben FALLAR; success = ACL correcta):
#    1. Cliente anónimo no puede ni conectar (allow_anonymous false).
#    2. MOD_A SÍ puede escribir su propio presence (permiso concedido).
#    3. MOD_A NO puede escribir el presence de MOD_B (aislamiento entre módulos: un
#       módulo comprometido no debe poder suplantar a otro).
#    4. MOD_A NO puede escribir su propio config/desired (sólo lectura para el
#       módulo; sólo el backend escribe ahí).
#    5. MOD_A NO puede escribir su propio command (sólo lectura).
#    6. MOD_A NO puede escribir su propio ota (sólo lectura; sólo el backend
#       escribe ahí).
#    7. backend SÍ puede escribir targets/v1/system/+/status (permiso backend).
#    8. backend SÍ puede escribir targets/v1/module/+/maintenance/command
#       (Trabajo 1: canal de mantenimiento, separado del canal de juego).
#    9. backend NO puede escribir targets/v1/module/+/command (el canal de
#       juego: el operador ha prohibido expresamente que exista un puente que
#       dé al backend ese permiso, bajo ninguna circunstancia).
#   10. el coordinador (MOD_B, activado con set-coordinator.sh) SÍ puede
#       escribir targets/v1/module/+/command (autoridad exclusiva de juego).
#   11. MOD_A puede leer su propio maintenance/command (publicado por backend).
#   12. F-02: MOD_A, autenticado con SUS credenciales pero declarando
#       client_id=MOD_B en el CONNECT, NO puede publicar en el hit de MOD_B (antes
#       de la corrección esta prueba FALLABA — confirmado en vivo el
#       2026-07-21 con exactamente este ataque; con use_username_as_clientid
#       true el broker reescribe el client_id declarado con el usuario
#       autenticado antes de evaluar la ACL, así que la suplantación deja de
#       ser posible).
#
# DEFECTO CORREGIDO EN EL PORTE D1 (2026-09-05) — falso verde generalizado.
#   Quince tópicos estaban escritos entre COMILLAS SIMPLES con `$MOD_A`/`$MOD_B`
#   dentro, así que la variable NO expandía y el script publicaba y leía en
#   tópicos literales del tipo `targets/v1/module/$MOD_A/presence`. Ningún
#   usuario tiene permiso sobre esos tópicos, de modo que TODAS las pruebas
#   negativas (3, 4, 5, 6, 9) pasaban por el motivo equivocado, y las positivas
#   (2, 11) fallaban por el mismo motivo. La prueba 12 —la de F-02, la más
#   importante del fichero— era un FALSO VERDE: publicaba en
#   `targets/v1/module/$MOD_B/hit`, que se deniega con o sin suplantación, así
#   que jamás demostró que la suplantación estuviera cerrada.
#   Medido ejecutando el script contra un broker real antes y después.
#   Es exactamente lo que este fichero denuncia en el párrafo de MP0-A: un
#   rechazo por otra causa contado como demostración de autorización.
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
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="${SCRIPT_DIR}/generate-identities.mjs"

HOST="${1:?Uso: test-acl.sh <host> <puerto> [mod_a] [mod_b]}"
PORT="${2:?falta el puerto}"

# Identidades: SIEMPRE de la fuente única, nunca literales en este fichero.
mapfile -t SOURCE_USERS < <(node "$GEN" --list-users)
MOD_A="${3:-module-01}"
MOD_B="${4:-module-02}"
for u in "$MOD_A" "$MOD_B"; do
    printf '%s\n' "${SOURCE_USERS[@]}" | grep -qx "$u" || {
        echo "ERROR: '$u' no está en infrastructure/mosquitto/identities.json (fuente única)." >&2
        echo "       Usuarios declarados: ${SOURCE_USERS[*]}" >&2
        exit 2
    }
done

BACKEND_PW="${MQTT_BACKEND_PASSWORD:?falta MQTT_BACKEND_PASSWORD en el entorno}"
M1_PW="${MQTT_PASSWORD_A:?falta MQTT_PASSWORD_A (contraseña de $MOD_A) en el entorno}"
M2_PW="${MQTT_PASSWORD_B:?falta MQTT_PASSWORD_B (contraseña de $MOD_B) en el entorno}"

# NOTA (defecto preexistente, corregido en el porte D1): aquí vivía una SEGUNDA
# declaración de HOST/PORT que además releía $3/$4/$5 como contraseñas, con un
# `usage` incompatible con el de arriba. Con la invocación documentada
# —contraseñas por entorno, `./test-acl.sh <host> <puerto>`— ese bloque abortaba
# el script en `${3:?falta la contraseña de backend}` antes de ejecutar una sola
# comprobación, y además contradecía la regla de no pasar secretos en argv.
# El bloque se ha ELIMINADO; manda el de arriba (entorno + posicionales 3 y 4
# como identidades de módulo).

# --- Transporte -----------------------------------------------------------
# Porte P0-2 (paso 14). El broker escucha en 8883 con TLS y una CA propia, que
# no está en el almacén del sistema: sin --cafile el cliente no puede validarlo
# y la conexión falla. Se pasa por entorno para no cambiar la firma posicional:
#
#   MQTT_CAFILE=infrastructure/mosquitto/certs/ca.crt \
#   MQTT_BACKEND_PASSWORD=... MQTT_PASSWORD_A=... MQTT_PASSWORD_B=... \
#       ./test-acl.sh localhost 8883
#
# Sin MQTT_CAFILE el script sigue hablando en claro, que es lo que hace falta
# para el 1883 de transición y para un broker de laboratorio. Eso NO es una
# puerta de atrás: la política de TLS se aplica en el backend y el simulador,
# que fallan cerrado; esto es un arnés de pruebas, y su trabajo es poder
# apuntar a cualquiera de los dos listeners para comparar.
WAIT_SECS=4
MQTT_CAFILE="${MQTT_CAFILE:-}"
TRANSPORT=()
if [ -n "$MQTT_CAFILE" ]; then
    [ -r "$MQTT_CAFILE" ] || {
        echo "ERROR: MQTT_CAFILE='$MQTT_CAFILE' no existe o no se puede leer." >&2
        exit 2
    }
    TRANSPORT=(--cafile "$MQTT_CAFILE")
    echo "Transporte: TLS contra ${HOST}:${PORT}, validando la CA de ${MQTT_CAFILE}"
else
    echo "Transporte: EN CLARO contra ${HOST}:${PORT} (sin MQTT_CAFILE)."
    echo "            Todo lo que viaje por aquí, credenciales incluidas, es legible"
    echo "            por cualquiera con acceso a la red. Sólo para laboratorio."
fi

PASS=0
FAIL=0

log_pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
log_fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

# publish_retained <user> <pass> <topic> <payload>
# Publica retenido, síncrono: al volver, la conexión ya está cerrada.
publish_retained() {
    local user="$1" pass="$2" topic="$3" payload="$4"
    timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" \
        -u "$user" -P "$pass" -t "$topic" -m "$payload" -q 1 -r 2>/dev/null
}

# read_retained <user> <pass> <topic>
# Suscribe y lee UN mensaje (el retenido, si lo hay y el permiso de lectura
# existe). Se ejecuta SIEMPRE después de que el publicador ya se desconectó.
read_retained() {
    local user="$1" pass="$2" topic="$3"
    timeout "$WAIT_SECS" mosquitto_sub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" \
        -u "$user" -P "$pass" -t "$topic" -C 1 2>/dev/null
}

# clear_retained <user> <pass> <topic>  — limpia con un publicador autorizado
clear_retained() {
    local user="$1" pass="$2" topic="$3"
    timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" \
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

echo "=== 0. Control positivo de autenticación (evita el falso verde del CONNECT fallido) ==="
if publish_retained "$MOD_A" "$M1_PW" "targets/v1/module/$MOD_A/presence" '{"paso":0}'; then
    log_pass "$MOD_A se autentica y publica lo suyo (las denegaciones posteriores son de ACL, no de credencial)"
else
    log_fail "$MOD_A NO pudo autenticarse/publicar: rc=$? — 135/5: el usuario no existe o la contraseña no vale (./generate-users.sh --all); 14 (Protocol error) contra el 8883: falta MQTT_CAFILE o la CA no corresponde; conexión rechazada: el puerto no escucha. ABORTA: cualquier prueba negativa a partir de aquí sería un falso verde, porque un fallo de TRANSPORTE o de AUTENTICACIÓN se anunciaría como si fuera una denegación de AUTORIZACIÓN."
    echo "RESULTADO: 0 PASS / 1 FAIL (precondición)"
    exit 1
fi
clear_retained backend "$BACKEND_PW" "targets/v1/module/$MOD_A/presence"

echo "=== 1. Cliente anónimo no debe poder conectar ==="
if timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" \
    -t "targets/v1/module/$MOD_A/presence" -m '{}' 2>/dev/null; then
    log_fail "el cliente anónimo pudo publicar (allow_anonymous debería ser false)"
else
    log_pass "el cliente anónimo no pudo conectar/publicar"
fi

echo "=== 2. $MOD_A puede escribir su propio presence ==="
check_write "$MOD_A pudo escribir su propio presence (esperado)" \
    "$MOD_A NO pudo escribir su propio presence (permiso roto)" \
    "$MOD_A" "$M1_PW" "targets/v1/module/$MOD_A/presence" 'test-acl-presence' 1 backend "$BACKEND_PW"

echo "=== 3. $MOD_A NO puede escribir el presence de $MOD_B ==="
check_write "$MOD_A no pudo escribir el presence de $MOD_B" \
    "$MOD_A pudo escribir el presence de $MOD_B (fuga de ACL)" \
    "$MOD_A" "$M1_PW" "targets/v1/module/$MOD_B/presence" 'suplantacion' 0 backend "$BACKEND_PW"

echo "=== 4. $MOD_A NO puede escribir su propio config/desired ==="
check_write "$MOD_A no pudo escribir su propio config/desired" \
    "$MOD_A pudo escribir su propio config/desired (el fallo original del contrato)" \
    "$MOD_A" "$M1_PW" "targets/v1/module/$MOD_A/config/desired" 'auto-config' 0 backend "$BACKEND_PW"

echo "=== 5. $MOD_A NO puede escribir su propio command ==="
check_write "$MOD_A no pudo escribir su propio command" \
    "$MOD_A pudo escribir su propio command" \
    "$MOD_A" "$M1_PW" "targets/v1/module/$MOD_A/command" 'auto-command' 0 backend "$BACKEND_PW"

echo "=== 6. $MOD_A NO puede escribir su propio ota ==="
check_write "$MOD_A no pudo escribir su propio ota" \
    "$MOD_A pudo escribir su propio ota" \
    "$MOD_A" "$M1_PW" "targets/v1/module/$MOD_A/ota" 'auto-ota' 0 backend "$BACKEND_PW"

echo "=== 7. backend puede escribir targets/v1/system/+/status ==="
check_write "backend pudo escribir system/s1/status (esperado)" \
    "backend NO pudo escribir system/s1/status (permiso roto)" \
    backend "$BACKEND_PW" 'targets/v1/system/s1/status' 'test-acl-backend' 1 backend "$BACKEND_PW"

echo "=== 8. backend puede escribir targets/v1/module/$MOD_A/maintenance/command ==="
check_write "backend pudo escribir maintenance/command de $MOD_A (esperado, Trabajo 1)" \
    "backend NO pudo escribir maintenance/command de $MOD_A (canal de mantenimiento roto)" \
    backend "$BACKEND_PW" "targets/v1/module/$MOD_A/maintenance/command" 'reboot' 1 backend "$BACKEND_PW"

echo "=== 9. backend NO puede escribir targets/v1/module/$MOD_A/command (canal de juego) ==="
check_write "backend no pudo escribir module/$MOD_A/command (separación de autoridad respetada)" \
    "backend pudo escribir module/$MOD_A/command (PUENTE PROHIBIDO: el backend no debe poder mandar órdenes de juego)" \
    backend "$BACKEND_PW" "targets/v1/module/$MOD_A/command" 'orden-de-juego-desde-backend' 0 backend "$BACKEND_PW"

echo "=== 10. el coordinador ($MOD_B) SÍ puede escribir targets/v1/module/+/command ==="
check_write "$MOD_B (coordinador) pudo escribir module/$MOD_A/command (esperado)" \
    "$MOD_B (coordinador) NO pudo escribir module/$MOD_A/command (rol de coordinador roto o no activado — ¿se ejecutó ./set-coordinator.sh $MOD_B?)" \
    "$MOD_B" "$M2_PW" "targets/v1/module/$MOD_A/command" 'orden-de-juego-desde-coordinador' 1 "$MOD_B" "$M2_PW"

echo "=== 11. $MOD_A puede leer su propio maintenance/command ==="
publish_retained backend "$BACKEND_PW" "targets/v1/module/$MOD_A/maintenance/command" 'reboot-read-test'
M1_READ="$(read_retained "$MOD_A" "$M1_PW" "targets/v1/module/$MOD_A/maintenance/command")"
if [ -n "$M1_READ" ]; then
    log_pass "$MOD_A pudo leer su propio maintenance/command (esperado)"
else
    log_fail "$MOD_A NO pudo leer su propio maintenance/command (permiso roto)"
fi
clear_retained backend "$BACKEND_PW" "targets/v1/module/$MOD_A/maintenance/command"

echo "=== 12. F-02: $MOD_A con credenciales propias pero client_id=$MOD_B NO puede suplantar a $MOD_B ==="
timeout "$WAIT_SECS" mosquitto_pub -h "$HOST" -p "$PORT" "${TRANSPORT[@]}" -u "$MOD_A" -P "$M1_PW" -i "$MOD_B" \
    -t "targets/v1/module/$MOD_B/hit" -m "{\"suplantado_por\":\"$MOD_A\"}" -q 1 -r 2>/dev/null
F02_READ="$(read_retained backend "$BACKEND_PW" "targets/v1/module/$MOD_B/hit")"
# El veredicto compara contra el MARCADOR de suplantacion, no contra "no vacio".
#
# Antes bastaba que hubiera algo retenido para declarar F-02 ABIERTO, y como
# $MOD_B puede publicar su propio hit retenido -- cosa perfectamente legitima --
# la prueba daba un FALSO ROJO permanente con la configuracion integra. Una
# supervision independiente lo reprodujo. Un veredicto de seguridad que no mira
# QUIEN escribio no esta midiendo la suplantacion, solo la presencia.
if printf '%s' "$F02_READ" | grep -q "suplantado_por"; then
    log_fail "$MOD_A con client_id=$MOD_B pudo escribir en module/$MOD_B/hit (F-02 SIGUE ABIERTO): $F02_READ"
else
    log_pass "$MOD_A con client_id=$MOD_B no pudo escribir en module/$MOD_B/hit (F-02 cerrado)"
fi
# La limpieza la hace $MOD_B con SUS credenciales: `backend` NO tiene permiso de
# escritura sobre module/+/hit (su ACL solo cubre system/#, config/desired, ota
# y maintenance/command), asi que limpiar con backend era un no-op silencioso
# que dejaba el retenido para la siguiente ejecucion.
clear_retained "$MOD_B" "$M2_PW" "targets/v1/module/$MOD_B/hit"

echo ""
echo "=== Resumen: ${PASS} correctos, ${FAIL} fallos ==="
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
