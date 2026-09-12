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

# La version del app_desc identifica al binario en el log de arranque y es lo
# unico que permite afirmar, delante de la placa, QUE COMMIT esta corriendo.
# ESP-IDF la deduce de `git describe`, pero dentro del contenedor esto es un
# worktree cuyo .git es un fichero y cuyo propietario no coincide: git falla en
# silencio y el binario sale con version "1", que no identifica nada. Se pasa
# medida DESDE EL HOST, donde git si puede responder.
#
#   VER="$(git log -1 --format=%h)$(git status --porcelain -- firmware \
#          | grep -q . && echo -dirty)"
#   docker run --rm -e DIANA_PROJECT_VER="$VER" -v "$PWD:/w" -w /w \
#          espressif/idf:v5.5 bash /w/firmware/esp32/tools/idf_build.sh
#
# El sufijo -dirty NO es cosmetico: un binario compilado sobre un arbol sucio
# no se puede reproducir desde su commit, y flashearlo al banco dejaria una
# placa cuyo codigo no esta en ningun sitio.
if [ -n "${DIANA_PROJECT_VER:-}" ]; then
  VERARG="-DPROJECT_VER=${DIANA_PROJECT_VER}"
  echo "PROJECT_VER=${DIANA_PROJECT_VER}"
else
  VERARG=""
  echo "PROJECT_VER=(sin declarar: el binario NO sera identificable)"
fi

idf.py set-target esp32s3 >/tmp/settarget.log 2>&1
echo "SETTARGET_RC=$?"

idf.py $VERARG build >/tmp/build.log 2>&1
echo "BUILD_RC=$?"
tail -25 /tmp/build.log
