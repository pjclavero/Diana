#!/usr/bin/env bash
# Verificacion del ELF construido: por SISTEMA DE FICHEROS y por `nm`, NUNCA
# por el log (idf_build.sh lo trunca a 25 lineas y un "todo bien" en pantalla
# no dice que simbolos hay dentro).
#
#   docker run --rm -v "$PWD":/w -w /w espressif/idf:v5.5 \
#       bash /w/firmware/esp32/tools/idf_verify_ca.sh
set -u

# Contador de hallazgos. SIN esto el script era una guarda que NO PODIA FALLAR:
# terminaba en un `grep ... && echo HALLAZGO || echo ninguna`, y el `||` se
# tragaba el codigo de salida, asi que devolvia 0 incluso encontrando una
# llamada a un relajamiento de TLS. Lo detecto una supervision independiente.
# Una guarda que nunca ha estado roja no es una guarda.
HALLAZGOS=0
cd /w/firmware/esp32
source "$IDF_PATH/export.sh" >/dev/null 2>&1

ELF=build/diana_firmware.elf
echo "== fichero =="
ls -l "$ELF" build/diana_firmware.bin

echo
echo "== simbolos de la guarda C-1 y del diagnostico C-2 =="
xtensa-esp32s3-elf-nm "$ELF" | grep -iE \
  "broker_ca|ca_is_declared|ca_fingerprint|ca_is_valid|log_mqtt_error|log_cert_flags|log_connack"

echo
echo "== la DECLARACION viaja de verdad en la imagen =="
if xtensa-esp32s3-elf-nm "$ELF" | grep -i "broker_ca_sha256"; then
  echo "  (los simbolos _binary_broker_ca_sha256_* existen: el fichero esta empotrado)"
else
  echo "  FALLO: la declaracion de huella NO viaja en la imagen"
  HALLAZGOS=$((HALLAZGOS + 1))
fi

echo
echo "== relajamientos de TLS: se comprueba la LLAMADA, no el simbolo =="
# esp-tls EXPORTA esp_transport_ssl_crt_bundle_attach y
# esp_transport_ssl_enable_global_ca_store esten o no en uso: aparecen en `nm`
# de cualquier imagen que enlace la libreria. Contarlos como hallazgo seria un
# falso positivo. Lo que importa es si el codigo de Diana los LLAMA, y eso se
# ve en el desensamblado de nuestras unidades, no en la tabla de simbolos.
# Se atribuye cada llamada a SU LLAMANTE y solo cuenta si el llamante es codigo
# de Diana. Sin esa atribucion el chequeo daba un falso positivo permanente: la
# unica llamada a global_ca_store del binario la hace `esp_mqtt_task`, codigo
# interno de esp-mqtt en una rama que este firmware nunca pide. Una guarda que
# esta roja sobre una imagen correcta acaba desactivada, que es peor que no
# tenerla.
RELAJ=$(xtensa-esp32s3-elf-objdump -d --demangle "$ELF" | awk '
  /^[0-9a-f]+ <.*>:$/ { fn = $2; gsub(/[<>:]/, "", fn); next }
  /call[0-9]*[ \t]+.*(crt_bundle_attach|global_ca_store|conn_new_sync_insecure)/ {
    print fn " -> " $NF
  }')

if [ -n "$RELAJ" ]; then
  echo "$RELAJ" | sed 's/^/    /'
  # Solo es hallazgo si quien llama es codigo NUESTRO.
  PROPIAS=$(echo "$RELAJ" | grep -E '^(diana_|app_|mqtt_client)' || true)
  if [ -n "$PROPIAS" ]; then
    echo "  HALLAZGO: codigo de Diana LLAMA a un relajamiento de verificacion"
    HALLAZGOS=$((HALLAZGOS + 1))
  else
    echo "  llamadas presentes, pero SOLO desde codigo de terceros (esp-mqtt):"
    echo "  ninguna procede de Diana (correcto). check_mqtt_tls.py lo fija sobre el fuente."
  fi
else
  echo "  ninguna llamada (correcto)"
fi

# NOTA sobre lo que NO sale en `nm`: log_mqtt_error, log_cert_flags y
# log_connack son `static`, asi que el enlazador no los publica. Su presencia
# se fija estructuralmente en check_broker_ca.py sobre el fuente, no aqui.

echo
if [ "$HALLAZGOS" -gt 0 ]; then
  echo "idf_verify_ca: $HALLAZGOS HALLAZGO(S) — la imagen NO es aceptable"
  exit 1
fi
echo "idf_verify_ca: sin hallazgos"
exit 0
