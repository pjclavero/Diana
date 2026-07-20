#!/bin/bash
# Endurece SSH: sólo autenticación por clave, sin login directo de root.
# Idempotente. Ejecutar como root DESPUÉS de 02-usuario-admin.sh y de haber
# verificado que el usuario administrativo tiene acceso por clave funcional
# (si te equivocas aquí y no tienes otra vía, te quedas sin acceso remoto).
#
# Vía de recuperación si algo sale mal: `qm guest exec 109 -- <comando>` desde
# yggdrasil (usa el canal del guest agent, no pasa por sshd).
set -euo pipefail

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-diana.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
EOF

sshd -t
systemctl reload sshd

echo "== hecho: ssh endurecido (sin login root, sin contraseña) =="
echo "verifica AHORA en otra sesión que el usuario administrativo sigue entrando:"
echo "  ssh diana-admin@192.168.1.209 'sudo whoami'"
