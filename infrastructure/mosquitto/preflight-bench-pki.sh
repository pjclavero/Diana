#!/usr/bin/env bash
# ==============================================================================
# Diana · PREFLIGHT DE PKI PARA EL BANCO
# ==============================================================================
# Comprueba, ANTES de compilar el firmware, que el material de confianza que se
# va a empotrar en el ESP32 es EXACTAMENTE el que firma el certificado del
# broker con el que se va a probar.
#
# Existe porque la alternativa es descubrirlo con la placa delante. Los siete
# puntos son los que fijó el operador al decidir
# BENCH_CA_POLICY = REUSE_EXISTING_DIANA_CA.
#
# POLITICA (no negociable en banco):
#   · Se REUTILIZA la CA activa de Diana. NO se genera una nueva sólo para la
#     sesión: eso validaría el firmware contra una raíz que luego se descarta,
#     y habríamos probado otra PKI.
#   · Se puede REEMITIR el certificado del broker (hoja) para añadir el nombre
#     al SAN. Cambiar la hoja NO es rotar la raíz de confianza.
#   · `ca.key` no se empotra, no se versiona y no llega jamás al ESP32.
#
# Uso:
#   CA_DIR=/root/diana-pki CERT_DIR=infrastructure/mosquitto/certs \
#     bash infrastructure/mosquitto/preflight-bench-pki.sh
#
# El rc NO lo decide el último comando de ninguna tubería: se acumulan hallazgos
# y se corta explícitamente. Ver la regla permanente en
# docs/coordination/C-PREPARACION-BANCO.md.
# ==============================================================================
set -uo pipefail

CA_DIR="${CA_DIR:-/root/diana-pki}"
CERT_DIR="${CERT_DIR:-infrastructure/mosquitto/certs}"
FW_CERTS="${FW_CERTS:-firmware/esp32/main/certs}"
BROKER_NAME="${MQTT_PUBLIC_NAME:-mqtt.diana.local}"

CA_CRT="$CA_DIR/ca.crt"
BROKER_CRT="$CERT_DIR/server.crt"
FW_CA="$FW_CERTS/broker_ca.pem"
FW_FP="$FW_CERTS/broker_ca.sha256"

HALLAZGOS=0
fail() { echo "  FALLO · $*"; HALLAZGOS=$((HALLAZGOS + 1)); }
ok()   { echo "  ok    · $*"; }

echo "== preflight PKI de banco =="
echo "   CA declarada : $CA_CRT"
echo "   cert broker  : $BROKER_CRT"
echo "   nombre TLS   : $BROKER_NAME"
echo

for f in "$CA_CRT" "$BROKER_CRT" "$FW_CA" "$FW_FP"; do
  [ -r "$f" ] || fail "no se puede leer $f"
done
if [ "$HALLAZGOS" -gt 0 ]; then
  echo; echo "preflight: faltan ficheros; nada más que comprobar"; exit 1
fi

# 1 · el certificado del broker verifica contra la CA declarada
if openssl verify -CAfile "$CA_CRT" "$BROKER_CRT" >/dev/null 2>&1; then
  ok "1 · el certificado del broker verifica contra la CA declarada"
else
  fail "1 · el certificado del broker NO verifica contra $CA_CRT"
fi

# 2 · el issuer es esa misma CA (no basta con que verifique una cadena)
ISS="$(openssl x509 -in "$BROKER_CRT" -noout -issuer 2>/dev/null)"
SUB="$(openssl x509 -in "$CA_CRT" -noout -subject 2>/dev/null)"
if [ "${ISS#issuer=}" = "${SUB#subject=}" ]; then
  ok "2 · issuer del broker == subject de la CA declarada"
else
  fail "2 · issuer distinto de la CA declarada: '${ISS#issuer=}' vs '${SUB#subject=}'"
fi

# 3 · el NOMBRE está en el SAN, como DNS. La identidad TLS es el nombre, no la IP.
SAN="$(openssl x509 -in "$BROKER_CRT" -noout -ext subjectAltName 2>/dev/null)"
if printf '%s' "$SAN" | grep -q "DNS:$BROKER_NAME"; then
  ok "3 · DNS:$BROKER_NAME presente en el SAN"
else
  fail "3 · DNS:$BROKER_NAME NO está en el SAN. SAN emitido: $(printf '%s' "$SAN" | tr -d '\n')"
fi

# 4 y 6 · la huella declarada en el firmware es la de ESA CA
FP_CA="$(openssl x509 -in "$CA_CRT" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f')"
FP_FW="$(tr -d ' \t\n\r' < "$FW_FP" | tr -d ':' | tr 'A-F' 'a-f')"
# El centinela se compara sobre el texto BAJADO ENTERO. `tr 'A-F' 'a-f'`, que es
# lo correcto para un hexadecimal, deja "NONE" como "NONe": ni "NONE" ni "none"
# casaban, asi que este caso nunca disparaba su mensaje propio y caia al
# generico de huella distinta. Correcto en el veredicto, inutil en el
# diagnostico -- y el diagnostico es justo lo que se necesita a las tres de la
# manana con la placa delante.
FP_FW_LOWER="$(printf '%s' "$FP_FW" | tr 'A-Z' 'a-z')"
if [ "$FP_FW_LOWER" = "none" ] || [ -z "$FP_FW" ]; then
  fail "4 · broker_ca.sha256 sigue en NONE: es estado de preparación, no de banco"
elif [ "$FP_CA" = "$FP_FW" ]; then
  ok "4 · la huella declarada coincide con la CA"
else
  fail "4 · huella declarada ($FP_FW) != huella de la CA ($FP_CA)"
fi

# 5 · el PEM empotrado ES esa CA, byte a byte por su huella
FP_EMB="$(openssl x509 -in "$FW_CA" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f')"
if [ -z "$FP_EMB" ]; then
  fail "5 · broker_ca.pem no es un certificado legible (¿sigue siendo el marcador?)"
elif [ "$FP_EMB" = "$FP_CA" ]; then
  ok "5 · broker_ca.pem es la CA declarada"
else
  fail "5 · broker_ca.pem NO es la CA declarada"
fi

# 7 · ninguna clave privada de CA en firmware, repo ni artefactos
if git ls-files | grep -qiE '(^|/)ca\.key$|(^|/)ca\.srl$'; then
  fail "7 · hay material de CA versionado en git"
elif find "$FW_CERTS" -name '*.key' -o -name 'ca.*' 2>/dev/null | grep -q '\.key$'; then
  fail "7 · hay una clave privada dentro de $FW_CERTS"
else
  ok "7 · sin ca.key en el repositorio ni en el firmware"
fi

# Control de nombre: el bueno valida, uno ajeno NO. Sin el segundo, un
# certificado comodín pasaría el punto 3 y la verificación seguiría siendo laxa.
if openssl verify -CAfile "$CA_CRT" -verify_hostname "$BROKER_NAME" "$BROKER_CRT" >/dev/null 2>&1; then
  ok "8 · verify_hostname $BROKER_NAME → OK"
else
  fail "8 · verify_hostname $BROKER_NAME → FALLA"
fi
if openssl verify -CAfile "$CA_CRT" -verify_hostname "broker.ajeno.invalid" "$BROKER_CRT" >/dev/null 2>&1; then
  fail "9 · un nombre AJENO también valida: la verificación de hostname es laxa"
else
  ok "9 · verify_hostname de un nombre ajeno → RECHAZADO (control negativo)"
fi

echo
if [ "$HALLAZGOS" -gt 0 ]; then
  echo "preflight PKI: $HALLAZGOS HALLAZGO(S) — NO compilar el firmware todavía"
  exit 1
fi
echo "preflight PKI: 9/9 · el material de confianza corresponde al broker de banco"
exit 0
