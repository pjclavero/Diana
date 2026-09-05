#!/usr/bin/env bash
# Build CRUZADO real para ESP32-S3 con la imagen oficial de Espressif.
# Se ejecuta DENTRO del contenedor. La clave de firma es EFIMERA y desechable:
# solo existe para que el enlace firmado pueda completar, igual que en CI.
set -u
cd /w/firmware/esp32

source "$IDF_PATH/export.sh" >/dev/null 2>&1

if [ ! -f secure_boot_signing_key.pem ]; then
  espsecure.py generate_signing_key --version 2 secure_boot_signing_key.pem \
    >/dev/null 2>&1 \
    || python -m espsecure generate_signing_key --version 2 secure_boot_signing_key.pem
fi

idf.py set-target esp32s3 >/tmp/settarget.log 2>&1
echo "SETTARGET_RC=$?"

idf.py build >/tmp/build.log 2>&1
echo "BUILD_RC=$?"
tail -25 /tmp/build.log
