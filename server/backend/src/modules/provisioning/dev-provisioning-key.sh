#!/bin/sh
# Genera una clave operativa de DESARROLLO para el plano DEVICE_MANAGEMENT.
#
# NO SIRVE PARA PRODUCCIÓN, y el backend lo impide: con
# DIANA_PROVISIONING_KEY_DEV=1 y NODE_ENV=production, el arranque aborta.
#
# La clave se escribe FUERA del repositorio, en ${XDG_RUNTIME_DIR:-/tmp}, con
# 0600. No es una convención amable: `ProvisioningSigner` rechaza cualquier
# ruta dentro del árbol de trabajo de git y cualquier fichero cuyos permisos
# dejen algo al grupo o a otros. Un .gitignore no habría servido —se borra en
# un commit y nadie se entera—.
#
# En PRODUCCIÓN la clave NO se genera así. El camino es un gestor de secretos
# (Vault, systemd-creds, Docker/Podman secret) que materialice el PEM en un
# fichero 0600 y exporte su RUTA en DIANA_PROVISIONING_KEY_FILE. El backend no
# lee nunca material de clave desde una variable de entorno ni desde argv: el
# entorno y la línea de órdenes de un proceso son legibles por otros usuarios
# de la máquina (/proc/<pid>/environ, /proc/<pid>/cmdline).
#
# Uso:
#   sh src/modules/provisioning/dev-provisioning-key.sh
#   export DIANA_PROVISIONING_KEY_FILE=... (lo imprime este script)
#   export DIANA_PROVISIONING_KEY_ID=op-key-dev
#   export DIANA_PROVISIONING_KEY_DEV=1
#
# La DELEGACIÓN (material público: clave pública operativa + firma de la raíz)
# es cosa aparte y se apunta con DIANA_PROVISIONING_DELEGATION_FILE. La raíz de
# fábrica firma delegaciones FUERA DE LÍNEA: este backend no tiene, ni debe
# tener, la clave raíz. Comprometerlo no compromete la raíz.

set -eu

DEST_DIR="${XDG_RUNTIME_DIR:-/tmp}/diana-provisioning"
KEY_FILE="${DEST_DIR}/operational-dev.pem"

mkdir -p "$DEST_DIR"
chmod 0700 "$DEST_DIR"

if [ -e "$KEY_FILE" ]; then
    echo "Ya existe: $KEY_FILE (no se sobrescribe)" >&2
else
    # `umask` ANTES de crear: si se creara con permisos amplios y se corrigiera
    # después, habría una ventana —corta, pero real— en la que otro usuario de
    # la máquina podría leerla.
    (umask 077; openssl genpkey -algorithm EC \
        -pkeyopt ec_paramgen_curve:P-256 \
        -pkeyopt ec_param_enc:named_curve \
        -out "$KEY_FILE" 2>/dev/null)
    chmod 0600 "$KEY_FILE"
    echo "Clave de DESARROLLO generada (efímera, fuera del repositorio)." >&2
fi

# Sólo se imprime la RUTA y la clave PÚBLICA. El material privado no sale por
# stdout ni por ningún log.
echo "$KEY_FILE"
