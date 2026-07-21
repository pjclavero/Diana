#!/bin/bash
# Crea el usuario administrativo dedicado 'diana-admin' (no se trabaja como root
# de forma habitual). Idempotente. Ejecutar como root.
#
# Nota de seguridad (ver docs/operations/acceso-y-seguridad.md):
#   - diana-admin no tiene contraseña de login (cuenta bloqueada, 'passwd -S' = L),
#     sólo acceso por clave SSH.
#   - sudo NOPASSWD:ALL para diana-admin es necesario porque no hay forma de pedir
#     contraseña a una cuenta sin contraseña. Como contrapartida, el login DIRECTO
#     de root por SSH está deshabilitado (PermitRootLogin no) para que la única vía
#     administrativa sea diana-admin + sudo (auditable, un solo camino).
set -euo pipefail

ADMIN_USER="diana-admin"
PUBKEY_IA02="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ9XRyAOlyTdcvTZteCC/mivvgu7fyUlMmQEPyvaZgtK ia02@ia-server"

if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash -c "Administrador dedicado VM 109 (proyecto Diana)" "$ADMIN_USER"
fi

mkdir -p "/home/$ADMIN_USER/.ssh"
chmod 700 "/home/$ADMIN_USER/.ssh"
grep -qxF "$PUBKEY_IA02" "/home/$ADMIN_USER/.ssh/authorized_keys" 2>/dev/null || \
  echo "$PUBKEY_IA02" >> "/home/$ADMIN_USER/.ssh/authorized_keys"
chmod 600 "/home/$ADMIN_USER/.ssh/authorized_keys"
chown -R "$ADMIN_USER:$ADMIN_USER" "/home/$ADMIN_USER/.ssh"

usermod -aG sudo "$ADMIN_USER"
if command -v docker >/dev/null 2>&1; then
  usermod -aG docker "$ADMIN_USER"
fi

cat > /etc/sudoers.d/90-diana-admin <<EOF
$ADMIN_USER ALL=(ALL) NOPASSWD:ALL
EOF
chmod 440 /etc/sudoers.d/90-diana-admin
visudo -cf /etc/sudoers.d/90-diana-admin

echo "== $ADMIN_USER =="
id "$ADMIN_USER"
echo "== hecho: usuario administrativo =="
