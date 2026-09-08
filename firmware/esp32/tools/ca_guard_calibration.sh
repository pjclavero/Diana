#!/usr/bin/env bash
# CALIBRACION de la guarda de la CA (C-1). NO forma parte de `make test`: es el
# utillaje que demuestra que la guarda SABE PONERSE ROJA.
#
# Una guarda que nunca se ha visto roja no es evidencia de nada. Aqui se planta
# de verdad un certificado en main/certs/broker_ca.pem -- generado con openssl,
# valido, bien formado, exactamente lo que alguien pondria "para que arranque"
# -- y se comprueba que la comprobacion FALLA. Cada escenario:
#
#   1. se aplica sobre el arbol real
#   2. se VERIFICA que la mutacion entro (una que no entra no calibra nada)
#   3. se ejecuta la comprobacion y se registra el rc REAL
#   4. se revierte con git checkout
#
#   ./firmware/esp32/tools/ca_guard_calibration.sh
#
# Salida 0 si TODOS los escenarios salen rojos (es decir: la guarda funciona).
set -u +e
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
REPO="$PWD"
CERTS="firmware/esp32/main/certs"
GUARD="python3 firmware/esp32/tools/check_broker_ca.py"
SUITE="make -C firmware test"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; git -C "$REPO" checkout -- "$CERTS" 2>/dev/null' EXIT

pass=0; fail=0

# --- material plantado -------------------------------------------------------
# (a) autofirmado "de tutorial": el subject por defecto de openssl req.
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout "$TMP/a.key" -out "$TMP/ejemplo_tutorial.pem" \
  -subj "/O=Internet Widgits Pty Ltd/CN=localhost" >/dev/null 2>&1
# (b) autofirmado con nombre plausible: NO esta en la lista de sospechosos.
#     Es el caso importante: la defensa no puede depender de una lista negra.
openssl ecparam -name prime256v1 -genkey -noout -out "$TMP/b.key" 2>/dev/null
openssl req -x509 -key "$TMP/b.key" -days 30 \
  -out "$TMP/ejemplo_plausible.pem" \
  -subj "/O=Seccion Nueve/CN=Diana Broker CA" >/dev/null 2>&1

escenario() {
  local nombre="$1" pem="$2" decl="$3" cmd="$4"
  printf '\n=== ESCENARIO %s ===\n' "$nombre"

  cp "$pem" "$REPO/$CERTS/broker_ca.pem"
  printf '%s\n' "$decl" > "$REPO/$CERTS/broker_ca.sha256"

  if grep -q 'BEGIN CERTIFICATE' "$REPO/$CERTS/broker_ca.pem"; then
    echo "  plantado VERIFICADO: hay un PEM real en broker_ca.pem"
  else
    echo "  EL PLANTADO NO ENTRO -- no calibra nada"
    git -C "$REPO" checkout -- "$CERTS"; fail=$((fail+1)); return
  fi
  echo "  declaracion: $(head -c 20 "$REPO/$CERTS/broker_ca.sha256" | tr -d '\n')..."

  eval "$cmd" >"$TMP/out.log" 2>&1; rc=$?
  echo "  rc=$rc  ($(grep -cE '  FALLO|fallidas' "$TMP/out.log") lineas de fallo)"
  grep -E '  FALLO' "$TMP/out.log" | head -3 | sed 's/^/    /'
  if [ "$rc" -ne 0 ]; then
    echo "  RESULTADO: ROJO -- la guarda caza el certificado plantado"
    pass=$((pass+1))
  else
    echo "  RESULTADO: VERDE -- HUECO: un certificado ajeno pasaria en silencio"
    fail=$((fail+1))
  fi
  git -C "$REPO" checkout -- "$CERTS"
}

# E1 · EL CASO QUE MOTIVA TODO. Alguien planta un certificado porque "el modulo
#      no arrancaba" y no toca la declaracion. Antes de C-1 esto pasaba: el PEM
#      es sintacticamente valido y ca_is_valid() lo aceptaba.
escenario "E1 certificado de tutorial plantado, declaracion sin tocar" \
  "$TMP/ejemplo_tutorial.pem" "NONE" "$GUARD"

# E2 · Igual, pero con un certificado de nombre PLAUSIBLE, ausente de cualquier
#      lista negra. Demuestra que la defensa es la DECLARACION, no la lista.
escenario "E2 certificado plausible (no esta en ninguna lista negra)" \
  "$TMP/ejemplo_plausible.pem" "NONE" "$GUARD"

# E3 · Alguien declara una huella y planta OTRO certificado. Es el escenario de
#      sustitucion silenciosa: el fichero de declaracion parece en orden.
escenario "E3 declaracion valida pero PEM sustituido por otro" \
  "$TMP/ejemplo_plausible.pem" \
  "$(openssl x509 -in "$TMP/ejemplo_tutorial.pem" -noout -fingerprint -sha256 \
     | sed 's/.*=//; s/://g' | tr 'A-Z' 'a-z')" \
  "$GUARD"

# E4 · La misma sustitucion, pero comprobada por la SUITE EN C, que lee los
#      ficheros reales del arbol. Dos guardas independientes, no una.
escenario "E4 el mismo E1, contra la suite de host (make test)" \
  "$TMP/ejemplo_tutorial.pem" "NONE" "$SUITE"

# E5 · CONTROL POSITIVO INVERSO. Un PEM CON su declaracion correcta tiene que
#      pasar: una guarda que dice que no a todo tampoco sirve.
printf '\n=== ESCENARIO E5 control: PEM correctamente declarado ===\n'
cp "$TMP/ejemplo_plausible.pem" "$REPO/$CERTS/broker_ca.pem"
openssl x509 -in "$TMP/ejemplo_plausible.pem" -noout -fingerprint -sha256 \
  | sed 's/.*=//; s/://g' | tr 'A-Z' 'a-z' > "$REPO/$CERTS/broker_ca.sha256"
eval "$GUARD" >"$TMP/out.log" 2>&1; rc=$?
echo "  rc=$rc"
if [ "$rc" -eq 0 ]; then
  echo "  RESULTADO: VERDE -- correcto: la guarda acepta una CA declarada"
  pass=$((pass+1))
else
  echo "  RESULTADO: ROJO -- la guarda rechaza incluso lo correcto"
  grep -E '  FALLO' "$TMP/out.log" | head -3 | sed 's/^/    /'
  fail=$((fail+1))
fi
git -C "$REPO" checkout -- "$CERTS"

printf '\n=== CALIBRACION: %d correctos, %d huecos ===\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
