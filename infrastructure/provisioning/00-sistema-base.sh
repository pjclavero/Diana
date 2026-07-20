#!/bin/bash
# Aprovisionamiento base del sistema operativo para VM 109 (diana-server).
# Idempotente: se puede volver a ejecutar sin efectos destructivos.
# Ejecutar como root en la VM (192.168.1.209) tras el primer arranque.
#
# Qué hace:
#   - Paquetes base (git, curl, wget, jq, unzip, diagnóstico) y qemu-guest-agent.
#   - chrony (sincronización horaria) y unattended-upgrades (parches de seguridad).
#   - NO instala PostgreSQL, Node.js, Mosquitto ni ningún runtime de aplicación:
#     todo eso vive en contenedores Docker (ver 01-docker.sh).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "== apt update =="
apt-get update -y

echo "== paquetes base =="
apt-get install -y \
  qemu-guest-agent \
  git curl wget jq unzip ca-certificates gnupg lsb-release \
  net-tools iproute2 htop iputils-ping dnsutils tcpdump less vim \
  chrony unattended-upgrades apt-listchanges

echo "== qemu-guest-agent =="
systemctl enable --now qemu-guest-agent

echo "== chrony (sincronización horaria) =="
systemctl enable --now chrony

echo "== unattended-upgrades (actualizaciones de seguridad desatendidas) =="
systemctl enable --now unattended-upgrades
# /etc/apt/apt.conf.d/20auto-upgrades ya lo crea el propio paquete
# (APT::Periodic::Update-Package-Lists "1"; APT::Periodic::Unattended-Upgrade "1";)

echo "== hecho: sistema base =="
