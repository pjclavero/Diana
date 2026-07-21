# VM 109 · diana-server

Especificación real y ficha de la VM que aloja el proyecto Diana. Creada bajo WP-08
el 2026-07-20 en el nodo Proxmox **yggdrasil** (192.168.1.152).

## Ficha (datos reales verificados)

| Campo | Valor |
|---|---|
| VMID | 109 |
| Nombre | `diana-server` |
| Nodo Proxmox | yggdrasil (192.168.1.152) |
| IP LAN | 192.168.1.209/24, gw 192.168.1.1 |
| IP Tailscale | **100.117.178.92** (hostname `diana-server`), unida a la tailnet `pjclavero@` el 2026-07-21 (`tailscale up`, autorizada por el operador). Panel accesible en `http://100.117.178.92:8080` |
| MAC (net0) | `BC:24:11:DB:01:CE` |
| UUID (smbios1) | `edd27e6a-58d2-4abb-9bf7-99cd34a7a948` |
| vCPU | 4 (cores=4, sockets=1) |
| RAM | 4096 MB con `balloon=1024` (decisión expresa del usuario para proteger las VM de producción del nodo, que está sobrecomprometido en RAM) |
| Disco | 50 GB en `local-lvm`, `discard=on`, virtio-scsi |
| Red | `net0` virtio sobre `vmbr0` |
| Máquina | q35, ostype l26 |
| Guest agent | `agent: enabled=1`, `qemu-guest-agent` instalado, activo y verificado desde el host (`qm agent 109 ping` → exit 0) |
| Arranque | `onboot=1` |
| SO | Debian GNU/Linux 12 (bookworm) |
| Kernel | `6.1.0-49-cloud-amd64` |
| Usuario administrativo | `diana-admin` (sudo NOPASSWD, sin contraseña de login — ver `docs/operations/acceso-y-seguridad.md`) |
| Docker | 29.6.2 (repositorio oficial `download.docker.com`) |
| Docker Compose plugin | v5.3.1 |
| Docker Buildx plugin | v0.35.0 |
| Fecha de creación | 2026-07-20 |
| Backup | añadida al job `backup-daily-critical` (ver más abajo) |

## Procedimiento reproducible de creación

Ejecutado contra el nodo yggdrasil. Requiere la plantilla cloud-init
`/var/lib/vz/template/iso/debian-12-genericcloud-amd64.qcow2` (la misma usada por
VM107/VM108) y el storage `local-lvm`.

```bash
# 1. Crear la VM (sin discos todavía)
qm create 109 \
  --name diana-server \
  --cores 4 --sockets 1 \
  --memory 4096 --balloon 1024 \
  --machine q35 --ostype l26 \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-pci \
  --agent enabled=1 \
  --serial0 socket --vga serial0 \
  --onboot 1

# 2. Importar el disco de la plantilla cloud-init
qm importdisk 109 /var/lib/vz/template/iso/debian-12-genericcloud-amd64.qcow2 local-lvm

# 3. Adjuntar el disco, redimensionar a 50G y añadir la unidad cloud-init
qm set 109 --scsi0 local-lvm:vm-109-disk-0,discard=on
qm resize 109 scsi0 50G
qm set 109 --ide2 local-lvm:cloudinit
qm set 109 --boot c --bootdisk scsi0

# 4. Configuración cloud-init: red estática, DNS, usuario y clave pública
qm set 109 --ipconfig0 ip=192.168.1.209/24,gw=192.168.1.1
qm set 109 --nameserver 8.8.8.8
qm set 109 --ciuser root
qm set 109 --sshkeys /ruta/a/claves_autorizadas.pub   # ver claves abajo

# 5. Metadatos
qm set 109 --tags diana,project-diana
qm set 109 --description "VM 109 diana-server - aloja el proyecto Diana ..."

# 6. Arrancar
qm start 109
```

Claves públicas incluidas en `--sshkeys` (dos líneas, formato NoCloud):
```
ssh-rsa AAAA...root@yggdrasil
ssh-ed25519 AAAA...ia02@ia-server
```

### Hallazgo importante: la plantilla `debian-12-genericcloud-amd64.qcow2` de este nodo **no trae cloud-init instalado**

A diferencia de lo asumido inicialmente (por convención con VM107/VM108), al arrancar
la VM 109 **no cogió la IP configurada por `ipconfig0` ni aceptó SSH**: el agente de
QEMU nunca respondió (`qm agent 109 ping` con timeout durante >5 minutos) y no hubo
respuesta a ping en `192.168.1.209`.

Diagnóstico (con la VM parada, editando el disco offline vía `qm stop 109` +
`kpartx -av /dev/pve/vm-109-disk-0` + montaje manual): el sistema de archivos raíz
**no tenía `/etc/cloud`**, es decir, la imagen base de este nodo es una imagen "generic"
sin cloud-init, pese al nombre del fichero. Por tanto `ipconfig0`/`sshkeys`/`ciuser` de
Proxmox (que dependen de que el datasource NoCloud de cloud-init los lea desde el CD-ROM
`ide2`) nunca se aplicaron.

**Corrección aplicada** (una sola vez, offline, sobre el disco de la VM 109 exclusivamente;
no se tocó ninguna otra VM ni la plantilla original):

1. Red estática vía `systemd-networkd` (`/etc/systemd/network/10-lan.network`,
   `Address=192.168.1.209/24`, `Gateway=192.168.1.1`), `systemd-networkd` y
   `systemd-resolved` habilitados, `/etc/resolv.conf` con `192.168.1.1` y `8.8.8.8`.
2. Hostname `diana-server` en `/etc/hostname` y `/etc/hosts`.
3. Claves de host SSH generadas con `ssh-keygen -A` (faltaban por completo, por lo que
   `ssh.service` no arrancaba).
4. `authorized_keys` de `root` con la clave `ia02@ia-server`.
5. `/etc/ssh/sshd_config.d/10-diana.conf` con `PermitRootLogin prohibit-password` y
   `PasswordAuthentication no` (endurecido después a `PermitRootLogin no`, ver
   `docs/operations/acceso-y-seguridad.md`).
6. `ssh.service` habilitado.
7. `network: {config: disabled}` en `/etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`
   por si en el futuro se instala cloud-init, para que no pise la configuración estática.

**Recomendación para futuras VMs de este nodo:** verificar ANTES de depender de
`ipconfig0`/`sshkeys` que la plantilla realmente contiene `/etc/cloud` (montar la
plantilla `.qcow2` con `qemu-nbd` o inspeccionarla, o simplemente comprobar con
`qm agent <vmid> ping` tras el primer arranque con margen de 2-3 minutos). Si no lo
trae, hay que aprovisionar red y SSH manualmente como se hizo aquí, o descargar de
nuevo una imagen cloud genuina de `cloud.debian.org`.

## Añadido al job de copias `backup-daily-critical`

Cambio **aditivo** en `/etc/pve/jobs.cfg` (copia previa guardada en
`/root/jobs.cfg.bak-pre-vm109-<timestamp>` en yggdrasil, no se tocó ninguna otra línea):

```
vzdump: backup-daily-critical
	schedule 02:00
	compress zstd
	enabled 1
	mode snapshot
	notes-template {{guestname}}
	prune-backups keep-daily=7,keep-weekly=4
	storage serverJ-backups
	vmid 100,104,105,106,109
```

## Comprobaciones realizadas

- `qm agent 109 ping` → exit 0 (guest agent operativo), verificado antes y después de
  un `qm reboot 109` de prueba.
- `ping -c3 192.168.1.209` desde yggdrasil → respuesta correcta.
- SSH por clave a `diana-admin@192.168.1.209` → operativo, con `sudo` funcional.
- SSH directo a `root@192.168.1.209` → **denegado** (`Permission denied (publickey)`),
  a propósito, ver `docs/operations/acceso-y-seguridad.md`.
- Tras `qm reboot 109`: la VM volvió sola, con Docker activo, red con la IP correcta,
  guest agent respondiendo y firewall `nftables` activo con las mismas reglas.
- Ninguna VM ni LXC existente (100-108, 100-101) fue modificada; se verificó el
  inventario antes y después con `qm list` / `pct list`.
