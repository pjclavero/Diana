# ADR-0005 · Identidad de la VM de Diana

**Estado:** aceptado · 2026-07-20

## Contexto

El encargo exige una VM nueva dedicada a Diana, sin reutilizar VMID ni IP y respetando
las convenciones del homelab documentadas en `s9-server`.

## Inventario verificado (nodo yggdrasil, 2026-07-20)

- VMID ocupados: 100 y 101 (LXC), 102-108 (KVM). **109 libre.**
- IP en uso: .200, .201, .203, .204, .205, .207, .208 y .157 (VM102), .164 (VM106).
  **192.168.1.209 libre** (sin respuesta a ping, sin entrada ARP).
- Bridge: `vmbr0` (192.168.1.152/24, gw 192.168.1.1).
- Almacenamiento: `local-lvm` (thin) con 211 GB disponibles de 337 GB.
- Plantilla disponible: `debian-12-genericcloud-amd64.qcow2`, ya usada por VM107 y VM108.
- Política de copias: `backup-daily-critical` a las 02:00 sobre `serverJ-backups`.

## Decisión

| Parámetro | Valor |
|---|---|
| VMID | 109 |
| Nombre | `diana-server` |
| IP LAN | 192.168.1.209/24, gw 192.168.1.1 |
| Recursos | 4 vCPU · 4 GB RAM · 50 GB |
| Almacenamiento | `local-lvm`, `discard=on` |
| Red | `net0` virtio sobre `vmbr0` |
| Sistema | Debian 12 cloud-init (misma plantilla que VM107/108) |
| Máquina | q35, virtio-scsi, QEMU Guest Agent activo |
| Arranque | `onboot=1` |

La convención VMID→IP (10x → .20x) se respeta: 109 → .209.

## Riesgo aceptado

El nodo tenía ~7 GB de RAM disponibles con todas las VM en marcha. La VM pide 4 GB, lo
que deja un margen estrecho. Se verifica el margen real antes de arrancar y se documenta.
No se reduce la memoria de ninguna VM existente.
