#!/bin/bash
# Instala Docker Engine + Compose + Buildx desde el repositorio OFICIAL de Docker
# (no el paquete docker.io/docker-compose de Debian). Idempotente.
# Ejecutar como root en la VM.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if ! command -v docker >/dev/null 2>&1; then
  echo "== añadiendo repositorio oficial de Docker =="
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
else
  echo "== docker ya instalado, se omite el repositorio =="
fi

echo "== instalando Docker Engine, CLI, containerd, Buildx y Compose =="
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

echo "== versiones instaladas =="
docker --version
docker compose version
docker buildx version

# Añade al grupo docker al usuario administrativo si existe (ver 02-usuario-admin.sh)
if id diana-admin >/dev/null 2>&1; then
  usermod -aG docker diana-admin
  echo "diana-admin añadido al grupo docker"
fi

echo "== hecho: docker =="
