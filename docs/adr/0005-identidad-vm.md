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
| Recursos | 4 vCPU · 4 GB RAM (balloon mínimo 1 GB) · 50 GB |
| Almacenamiento | `local-lvm`, `discard=on` |
| Red | `net0` virtio sobre `vmbr0` |
| Sistema | Debian 12 cloud-init (misma plantilla que VM107/108) |
| Máquina | q35, virtio-scsi, QEMU Guest Agent activo |
| Arranque | `onboot=1` |

La convención VMID→IP (10x → .20x) se respeta: 109 → .209.

## Memoria: decisión con el usuario

La medición real del nodo desaconsejaba asignar 4 GB fijos:

```
31,9 GB físicos · 25,1 GB en uso · 6,8 GB disponibles
4,4 GB de swap ya en uso
37,8 GB asignados a las VM en marcha (VM108 pide 16 GB ella sola)
KSM compartiendo ~1,73 M páginas (≈6,7 GB)
```

El nodo ya está sobrecomprometido y se sostiene sobre KSM y swap. Añadir 4 GB rígidos
podía degradar servicios de producción (Nextcloud, web-hosting, knowledge).

Consultado el usuario, la decisión es **`memory=4096` con `balloon=1024`**: la VM ve y
puede usar sus 4 GB cuando hay memoria libre, y el hipervisor recupera hasta 3 GB cuando
hay presión. Se cumple el requisito de 4 GB del encargo sin poner en riesgo el resto del
homelab.

No se reduce la memoria de ninguna VM existente, ni se apaga ninguna.

## Copias

La VM 109 se añade a la lista `vmid` del job existente `backup-daily-critical`
(02:00, `serverJ-backups`, `keep-daily=7,keep-weekly=4`). Es un cambio aditivo sobre
`/etc/pve/jobs.cfg`, con copia previa del fichero y sin alterar la política de las demás.
