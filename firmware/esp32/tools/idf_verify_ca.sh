#!/usr/bin/env bash
# Verificacion del ELF construido: por SISTEMA DE FICHEROS y por `nm`, NUNCA
# por el log (idf_build.sh lo trunca a 25 lineas y un "todo bien" en pantalla
# no dice que simbolos hay dentro).
#
#   docker run --rm -v "$PWD":/w -w /w espressif/idf:v5.5 \
#       bash /w/firmware/esp32/tools/idf_verify_ca.sh
set -u
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
xtensa-esp32s3-elf-nm "$ELF" | grep -i "broker_ca_sha256" \
  && echo "  (los simbolos _binary_broker_ca_sha256_* existen: el fichero esta empotrado)"

echo
echo "== relajamientos de TLS: se comprueba la LLAMADA, no el simbolo =="
# esp-tls EXPORTA esp_transport_ssl_crt_bundle_attach y
# esp_transport_ssl_enable_global_ca_store esten o no en uso: aparecen en `nm`
# de cualquier imagen que enlace la libreria. Contarlos como hallazgo seria un
# falso positivo. Lo que importa es si el codigo de Diana los LLAMA, y eso se
# ve en el desensamblado de nuestras unidades, no en la tabla de simbolos.
xtensa-esp32s3-elf-objdump -d --demangle "$ELF" \
  | grep -iE "call[0-9]*[[:space:]]+.*(crt_bundle_attach|global_ca_store|conn_new_sync_insecure)" \
  && echo "  HALLAZGO: hay una LLAMADA a un relajamiento de verificacion" \
  || echo "  ninguna llamada (correcto)"

# NOTA sobre lo que NO sale en `nm`: log_mqtt_error, log_cert_flags y
# log_connack son `static`, asi que el enlazador no los publica. Su presencia
# se fija estructuralmente en check_broker_ca.py sobre el fuente, no aqui.
