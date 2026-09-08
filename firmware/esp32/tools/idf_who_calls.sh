#!/usr/bin/env bash
# Quien llama a esp_transport_ssl_enable_global_ca_store en el ELF: se busca la
# ETIQUETA DE FUNCION que precede a la instruccion de llamada en el
# desensamblado. Nombrar al llamante es lo que separa "hay un simbolo" de "hay
# un problema".
set -u
cd /w/firmware/esp32
source "$IDF_PATH/export.sh" >/dev/null 2>&1

xtensa-esp32s3-elf-objdump -d build/diana_firmware.elf \
  | awk '
      /^[0-9a-f]+ <.*>:/ { fn = $0 }
      /call[0-9]*[[:space:]]+.*(crt_bundle_attach|global_ca_store|conn_new_sync_insecure)/ {
          print "LLAMANTE: " fn; print "   " $0
      }'
