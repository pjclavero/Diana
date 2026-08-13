#!/usr/bin/env bash
# ==============================================================================
# Diana · generate-certs.sh — CA propia y certificado de servidor para MQTT TLS
# ==============================================================================
# LA CLAVE DE LA CA NO VIVE EN EL ÁRBOL DE DESPLIEGUE. Desde 2026-08-13 reside
# en $CA_DIR, un directorio root-only fuera de /opt/diana, y su destino final es
# almacenamiento offline separado de la VM: su función es EMITIR y ROTAR
# certificados, no ejecutar Diana. El stack productivo no la necesita para
# arrancar — sólo necesita ca.crt, server.crt y server.key.
#
#   $CA_DIR/ca.key   clave privada de la CA   0600  — FUERA del despliegue
#   $CERT_DIR/ca.crt   certificado de la CA   0644  — se distribuye a los clientes
#   $CERT_DIR/server.key  clave del broker    0600  — propiedad del uid del broker
#   $CERT_DIR/server.crt  certificado broker  0644
#
# Los clientes (backend, simulador, firmware) validan `server.crt` contra
# `ca.crt` y comprueban además el NOMBRE del servidor, así que el certificado
# lleva todos los nombres por los que se llega al broker:
#
#   DNS:mosquitto    el backend y el resto de contenedores, por la red interna
#   DNS:localhost    el healthcheck, dentro del propio contenedor
#   IP:127.0.0.1     ídem
#   IP:<MQTT_PUBLIC_IP>  los módulos ESP32 y el simulador, desde la LAN
#
# Un nombre que falte aquí NO se traduce en un aviso: la conexión falla cerrada.
# Eso es deliberado — es justo la propiedad que P0-2 quiere garantizar.
#
# Uso:
#   ./generate-certs.sh                    # IP pública por defecto (ver abajo)
#   MQTT_PUBLIC_IP=192.168.1.209 ./generate-certs.sh
#   FORCE=1 ./generate-certs.sh            # rota el certificado de SERVIDOR
#   NEW_CA=1 ./generate-certs.sh           # crea una CA NUEVA (rompe la confianza)
#   CA_DIR=/ruta/segura ./generate-certs.sh
#
# El script es idempotente: si los certificados ya existen y siguen siendo
# válidos, no los toca (regenerarlos rompería a todo cliente que ya confía en
# la CA anterior). Usa FORCE=1 para una rotación deliberada.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="${CERT_DIR:-${SCRIPT_DIR}/certs}"
# Ubicación de la CA, FUERA del árbol de despliegue.
CA_DIR="${CA_DIR:-/root/diana-pki}"
MQTT_PUBLIC_IP="${MQTT_PUBLIC_IP:-192.168.1.209}"
CA_DAYS="${CA_DAYS:-3650}"
SERVER_DAYS="${SERVER_DAYS:-825}"   # límite habitual de los clientes TLS modernos

command -v openssl >/dev/null || { echo "[certs] ERROR: falta openssl" >&2; exit 1; }

# --- Guardarraíl: la clave de la CA nunca dentro del material desplegado -------
# Era una comprobación al final del script y se anunciaba como «pase lo que pase
# por arriba». Era falso: la ruta idempotente sale por `exit 0` mucho antes, y
# ésa es justamente la invocación por defecto —`./generate-certs.sh` sin FORCE—
# que un operador usa a diario. Un guardarraíl que sólo cubre el camino menos
# transitado no es un guardarraíl. Ahora es una función y se invoca en TODAS
# las salidas.
comprobar_ca_key_fuera() {
    if [ -e "${CERT_DIR}/ca.key" ]; then
        echo "[certs] ERROR: ha aparecido ca.key en ${CERT_DIR}. No debe estar ahí." >&2
        echo "[certs] La clave de la CA vive en ${CA_DIR}, fuera del árbol de" >&2
        echo "[certs] despliegue. Quítala de ${CERT_DIR} antes de continuar." >&2
        exit 1
    fi
}

mkdir -p "$CERT_DIR"
chmod 755 "$CERT_DIR"
comprobar_ca_key_fuera

if [ -f "${CERT_DIR}/server.crt" ] && [ "${FORCE:-0}" != "1" ]; then
    if openssl x509 -in "${CERT_DIR}/server.crt" -checkend 0 -noout >/dev/null 2>&1; then
        echo "[certs] ya existen certificados válidos en ${CERT_DIR}; nada que hacer."
        echo "[certs] (usa FORCE=1 para rotarlos deliberadamente)"
        openssl x509 -in "${CERT_DIR}/server.crt" -noout -subject -dates -ext subjectAltName
        comprobar_ca_key_fuera
        exit 0
    fi
    echo "[certs] el certificado de servidor existente está CADUCADO; se regenera."
fi

# --- La CA: se REUTILIZA, no se recrea -----------------------------------------
# Antes este bloque creaba una CA nueva en CERT_DIR cada vez que llegaba aquí
# (certificado caducado o FORCE=1). Con la clave de la CA ya fuera del árbol,
# eso habría emitido en SILENCIO una CA distinta e invalidado la confianza de
# TODOS los clientes: backend, simulador y, cuando exista, el firmware. Una
# rotación de servidor no puede convertirse en un cambio de raíz de confianza
# por accidente.
if [ -f "${CA_DIR}/ca.key" ] && [ -f "${CA_DIR}/ca.crt" ]; then
    echo "[certs] reutilizando la CA existente de ${CA_DIR} (no se toca)."
elif [ "${NEW_CA:-0}" = "1" ]; then
    # Trampa real, armada durante el saneamiento del 2026-08-13: si en CA_DIR
    # hay `ca.key` pero falta `ca.crt`, la puerta de reutilización de arriba no
    # se cumple y se cae aquí. Sin esta comprobación, `openssl req -x509
    # -keyout "${CA_DIR}/ca.key"` sobrescribía SIN AVISO la única copia de la
    # raíz de confianza — y el propio mensaje de error del script empujaba al
    # operador a hacerlo. Destrucción irreversible guiada por la herramienta.
    if [ -e "${CA_DIR}/ca.key" ]; then
        echo "[certs] ERROR: ya existe ${CA_DIR}/ca.key y NEW_CA=1 la sobrescribiría." >&2
        echo "[certs] Eso destruiría la raíz de confianza actual sin vuelta atrás." >&2
        echo "[certs] Si sólo falta ca.crt, DERÍVALO de la clave en vez de crear" >&2
        echo "[certs] una CA nueva. Si de verdad quieres reemplazar la raíz, aparta" >&2
        echo "[certs] antes la actual a un sitio seguro y vuelve a ejecutar." >&2
        exit 1
    fi
    echo "[certs] *** CREANDO UNA CA NUEVA en ${CA_DIR} ***"
    echo "[certs] Esto INVALIDA a todos los clientes que confían en la anterior:"
    echo "[certs] habrá que redistribuir ca.crt al backend, al simulador y al"
    echo "[certs] firmware antes de que vuelvan a conectar."
    mkdir -p "$CA_DIR"; chmod 700 "$CA_DIR"
    openssl req -x509 -newkey rsa:4096 -sha256 -days "$CA_DAYS" -nodes \
        -keyout "${CA_DIR}/ca.key" -out "${CA_DIR}/ca.crt" \
    -subj "/C=ES/O=Proyecto Diana/CN=Diana Internal CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
    chmod 600 "${CA_DIR}/ca.key"
else
    echo "[certs] ERROR: no hay CA en ${CA_DIR} y NEW_CA no está a 1." >&2
    echo "[certs] Este script NO crea una raíz de confianza por accidente." >&2
    echo "[certs] Si la CA está archivada fuera de esta máquina, tráela a" >&2
    echo "[certs] ${CA_DIR} (0600) o indica CA_DIR. Si de verdad quieres una CA" >&2
    echo "[certs] nueva —y redistribuir ca.crt a TODOS los clientes— usa NEW_CA=1." >&2
    exit 1
fi

# ca.crt sí es público y sí vive junto al resto del material de runtime: es lo
# que los clientes usan para validar al broker.
cp "${CA_DIR}/ca.crt" "${CERT_DIR}/ca.crt"

echo "[certs] generando certificado de broker (${SERVER_DAYS} días)…"
openssl req -newkey rsa:2048 -sha256 -nodes \
    -keyout "${CERT_DIR}/server.key" -out "${CERT_DIR}/server.csr" \
    -subj "/C=ES/O=Proyecto Diana/CN=mosquitto" 2>/dev/null

cat > "${CERT_DIR}/server.ext" <<EOF
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:mosquitto,DNS:localhost,IP:127.0.0.1,IP:${MQTT_PUBLIC_IP}
EOF

openssl x509 -req -in "${CERT_DIR}/server.csr" -sha256 -days "$SERVER_DAYS" \
    -CA "${CA_DIR}/ca.crt" -CAkey "${CA_DIR}/ca.key" -CAcreateserial \
    -extfile "${CERT_DIR}/server.ext" -out "${CERT_DIR}/server.crt" 2>/dev/null

rm -f "${CERT_DIR}/server.csr" "${CERT_DIR}/server.ext" "${CA_DIR}/ca.srl"

# Las claves privadas no las lee nadie salvo su dueño.
chmod 600 "${CERT_DIR}/server.key"
chmod 644 "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt"

# La imagen oficial eclipse-mosquitto NO corre como root: su proceso es el
# usuario `mosquitto`, uid 1883. Con server.key en 0600 propiedad de root el
# broker no puede leer su propia clave y no arranca. Se le da la propiedad de
# la clave del SERVIDOR, y sólo de ella: `ca.key` ni siquiera está en este
# directorio — vive en ${CA_DIR}, fuera del árbol de despliegue.
BROKER_UID="${BROKER_UID:-1883}"
if [ "$(id -u)" = "0" ]; then
    chown "${BROKER_UID}:${BROKER_UID}" "${CERT_DIR}/server.key"
else
    echo "[certs] AVISO: sin root no se puede dar la clave al uid ${BROKER_UID};" \
         "el broker no podrá leer server.key."
fi

echo "[certs] verificando la cadena…"
openssl verify -CAfile "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt"
openssl x509 -in "${CERT_DIR}/server.crt" -noout -subject -issuer -dates -ext subjectAltName

echo "[certs] listo en ${CERT_DIR}"
echo "[certs] RECUERDA: ca.key NO se copia a ningún cliente, ni al repositorio,"
echo "[certs] ni al árbol de despliegue. Vive en ${CA_DIR} y su sitio definitivo"
echo "[certs] es almacenamiento offline fuera de esta máquina."
comprobar_ca_key_fuera
