# Lock operativo de producción · VM109

**Este fichero es la autoridad.** Antes de tocar VM109, léelo. Si tu carril no es
`PRODUCTION_OWNER`, no tocas producción — da igual lo pequeño que parezca el cambio.

```
PRODUCTION_OWNER = A          (VM109_BOOT_RECOVERY_P0)
Desde            = 2026-09-13
```

## Qué significa tener el lock

Sólo el propietario puede, sobre VM109:

reiniciar la VM · reiniciar Docker · recrear contenedores · modificar el Compose
productivo · modificar Mosquitto productivo · modificar volúmenes · modificar
nftables · modificar la ACL productiva · desplegar backend · ejecutar gates
físicos que dependan del broker real.

## Qué puede hacer todo el mundo, siempre

Desarrollar, revisar, escribir y ejecutar tests, construir imágenes, preparar
despliegues, y **leer** el estado de producción sin modificarlo.

## Prohibiciones que no dependen del lock

- `nft -f /etc/nftables.conf` y reiniciar/recargar nftables: borra las cadenas de
  Docker y tira MQTT y el panel. Añadir reglas en caliente sí es seguro.
- `sleep` o cualquier comando bloqueante **dentro** de `qm guest exec`: agota el
  canal y deja la VM sin gestión. Ya ha pasado dos veces. Las esperas van en el
  lado del controlador.
- Borrar o recrear datos productivos «para probar».
- Limpiar la NVS del ESP32.
- Secretos en el chat, en `argv`, en logs o en git.

## Vías administrativas de VM109, por orden

1. **SSH `diana-admin@192.168.1.209`** con la clave de ia-server — primaria.
2. `qm guest exec 109` desde yggdrasil (`root@192.168.1.152`) — secundaria.
3. Consola de Proxmox — recuperación final (credenciales NO documentadas hoy).

`PermitRootLogin` está en `no` y no se toca.

## Mapa de propiedad de ficheros

Un carril no edita ficheros de otro. Si necesita un cambio ahí, lo pide.

| Ruta | Propietario |
|---|---|
| `infrastructure/mosquitto/**` | A |
| `infrastructure/systemd/**` (nuevo) | A |
| `compose.yml` (servicios y volúmenes) | A |
| `docs/operations/**` | A |
| `server/backend/src/modules/games/**` | B |
| `server/backend/src/modules/mqtt/**` | B |
| `server/backend/test/games/**` | B |
| `tests/e2e/game/**` | B |
| `simulators/**` | B |
| `install/**`, `docs/installation/**` (nuevos) | C |
| `server/backend/src/modules/modules/module-diagnostics*` | D |
| `firmware/esp32/**` (diagnósticos) | D |
| `docs/operations/PRODUCTION_LOCK.md` | organizador |

**Zona de fricción declarada:** A y C tocan el mismo territorio conceptual
(Compose, Mosquitto, volúmenes, systemd). La regla es asimétrica y no negociable:
**A decide y demuestra sobre producción; C generaliza lo ya demostrado.** C no
edita ficheros de A ni inventa una variante propia en paralelo.

## Estado de los gates

```
A_BOOT_RECOVERY = NOT_RUN
B_COORDINATOR   = NOT_RUN   (bf9305b + b29f1ae en repo; b29f1ae SIN desplegar)
C_INSTALLATION  = NOT_RUN
D_DIAGNOSTICS   = NOT_RUN
```

## Aviso sobre el estado actual de VM109

En producción corre la imagen de `bf9305b`. El arreglo `b29f1ae` (el sobre `game`
en `start_game`) está **construido y cargado en la VM pero sin recrear el
servicio**: hoy el backend productivo devolvería 500 al arrancar una ronda. El
despliegue le corresponde a B cuando reciba el lock.
