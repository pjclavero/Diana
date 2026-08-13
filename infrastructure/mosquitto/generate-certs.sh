#!/usr/bin/env bash
# ==============================================================================
# Diana · generate-certs.sh — CA propia y certificado de servidor para MQTT TLS
# ==============================================================================
# Genera, bajo infrastructure/mosquitto/certs/ (fuera de git):
#
#   ca.key      clave privada de la CA        0600  — NUNCA sale de aquí
#   ca.crt      certificado de la CA          0644  — se distribuye a los clientes
#   server.key  clave privada del broker      0600
#   server.crt  certificado del broker        0644
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
#   FORCE=1 ./generate-certs.sh            # regenera aunque ya existan
#
# El script es idempotente: si los certificados ya existen y siguen siendo
# válidos, no los toca (regenerarlos rompería a todo cliente que ya confía en
# la CA anterior). Usa FORCE=1 para una rotación deliberada.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="${CERT_DIR:-${SCRIPT_DIR}/certs}"
MQTT_PUBLIC_IP="${MQTT_PUBLIC_IP:-192.168.1.209}"
CA_DAYS="${CA_DAYS:-3650}"
SERVER_DAYS="${SERVER_DAYS:-825}"   # límite habitual de los clientes TLS modernos

command -v openssl >/dev/null || { echo "[certs] ERROR: falta openssl" >&2; exit 1; }

mkdir -p "$CERT_DIR"
chmod 755 "$CERT_DIR"

if [ -f "${CERT_DIR}/server.crt" ] && [ "${FORCE:-0}" != "1" ]; then
    if openssl x509 -in "${CERT_DIR}/server.crt" -checkend 0 -noout >/dev/null 2>&1; then
        echo "[certs] ya existen certificados válidos en ${CERT_DIR}; nada que hacer."
        echo "[certs] (usa FORCE=1 para rotarlos deliberadamente)"
        openssl x509 -in "${CERT_DIR}/server.crt" -noout -subject -dates -ext subjectAltName
        exit 0
    fi
    echo "[certs] el certificado de servidor existente está CADUCADO; se regenera."
fi

echo "[certs] generando CA propia (${CA_DAYS} días)…"
openssl req -x509 -newkey rsa:4096 -sha256 -days "$CA_DAYS" -nodes \
    -keyout "${CERT_DIR}/ca.key" -out "${CERT_DIR}/ca.crt" \
    -subj "/C=ES/O=Proyecto Diana/CN=Diana Internal CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

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
    -CA "${CERT_DIR}/ca.crt" -CAkey "${CERT_DIR}/ca.key" -CAcreateserial \
    -extfile "${CERT_DIR}/server.ext" -out "${CERT_DIR}/server.crt" 2>/dev/null

rm -f "${CERT_DIR}/server.csr" "${CERT_DIR}/server.ext" "${CERT_DIR}/ca.srl"

# Las claves privadas no las lee nadie salvo su dueño.
chmod 600 "${CERT_DIR}/ca.key" "${CERT_DIR}/server.key"
chmod 644 "${CERT_DIR}/ca.crt" "${CERT_DIR}/server.crt"

# La imagen oficial eclipse-mosquitto NO corre como root: su proceso es el
# usuario `mosquitto`, uid 1883. Con server.key en 0600 propiedad de root el
# broker no puede leer su propia clave y no arranca. Se le da la propiedad de
# la clave del SERVIDOR, y sólo de ella: `ca.key` sigue siendo de root y ni
# siquiera se monta en el contenedor (ver compose.yml).
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
echo "[certs] RECUERDA: ca.key NO se copia a ningún cliente ni al repositorio."
