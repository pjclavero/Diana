# Artefactos del banco · primer módulo físico `module-01`

Índice **no sensible** del material que hizo falta para dar de alta el primer
módulo 3×3 y poder reproducirlo o reflashearlo.

El contenido **no está aquí ni puede estarlo**: cinco de los nueve artefactos
llevan la contraseña MQTT del módulo o particiones NVS que la contienen en
claro. Lo que se versiona es su nombre, su tamaño, su huella y para qué sirve
— lo justo para saber qué falta si algún día falta, y para comprobar que lo
que aparezca es lo mismo que se preservó.

## Dónde vive

```
ia-server (VM102) : ~/diana-private/handoff/module-01/     (0700)
```

En `ia-server` y no en VM109 a propósito: la VM109 es el servidor Diana en
producción, y llevar allí la contraseña del módulo añadiría una exposición sin
ninguna ventaja — quien reflashea la placa es `ia-server`, que es donde está el
USB y el ESP-IDF. Tampoco va en `/opt`: ese árbol pertenece a root y en
`ia-server` no hay `sudo`.

Verificación de integridad, con la herramienta estándar y no con un guion
propio:

```
cd ~/diana-private/handoff/module-01 && sha256sum -c manifest.sha256
```

Calibrado: alterando un solo byte, sale `rc=1`.

## Inventario

| artefacto | bytes | sha256 | clasificacion | proposito |
| --- | ---: | --- | --- | --- |
| `ca.crt` | 2639 | `4106bb0d0f51522d37d89d047ba2469fc7435b0bd4ab7f4397df7902c78960ac` | publico | CA publica AUTORITATIVA del broker de VM109, obtenida de su propia cadena TLS |
| `HANDOFF.txt` | 2180 | `32c5682d2a04933676372a33d7f2855366f7eb1cfb5699bb44c0281306ac1108` | publico | Datos de alta del modulo: ids, host, puerto, usuario, huella de CA y config_version |
| `mqtt_module-01.pw` | 32 | `d830406bc542819a8cd3c2715974909ade25422371095f78289c5bb9637be856` | SENSIBLE | Contrasena MQTT de module-01, emitida por el servidor. UNICA copia legible |
| `nvs-01-antes-de-reaprovisionar.bin` | 24576 | `28a612773657d2783c950eab0f985209ba289f879f93aa886eb268a5643d7971` | SENSIBLE | Particion NVS tal como estaba con la identidad de laboratorio lab-module-01 |
| `nvs-identidad.csv` | 335 | `db9e9c1208f02ecbcf734291f5f92a35e404546a89f142d89492ca9eff187963` | SENSIBLE | CSV de identidad con el que se genero la particion (contiene la contrasena) |
| `nvs-02-identidad-generada.bin` | 24576 | `109d46a672203e58533d378a9c985e48314007bbb1ff79304d81ff7fae0ec9f4` | SENSIBLE | Particion NVS generada para module-01 y flasheada |
| `nvs-03-antes-del-flasheo-firmware.bin` | 24576 | `8b68b935b184f21a95faede97b07f38953ac3f6ba0005cb58c8403a7e48b38d0` | SENSIBLE | NVS leida antes de flashear el firmware corregido; seq_hi=3328 |
| `nvs-04-despues-del-flasheo.bin` | 24576 | `c2915d1ec43562f7782229eeab16aff60eebe7ef9119d5b5310477e3181a4321` | SENSIBLE | NVS leida despues; seq_hi=3456, identidad intacta |
| `evtqueue-8-eventos-lab.bin` | 1572864 | `efd9948c4addf23bfdc189e0c51aeab7729aacf4c16708f9ff5e34d92ab46c2d` | SENSIBLE | Particion evtqueue con los 8 eventos de lab-module-01, antes de retirarlos |

## Qué NO se conserva, y por qué

- La clave privada de la CA de Diana. Nunca estuvo aquí: el `ca.crt` se obtuvo
  de la cadena TLS que el propio broker presenta.
- La clave privada del servidor. Idem.
- La credencial del administrador de VM109 ni ningún token de sesión: eran
  efímeros y se retiraron.

## Si hay que reproducir el módulo desde cero

1. `HANDOFF.txt` da los identificadores, el broker, el usuario y la huella de
   la CA que el firmware debe llevar empotrada.
2. `mqtt_module-01.pw` es la contraseña. **No se puede volver a leer del
   servidor**: se entregó una sola vez. Si se pierde, hay que ROTARLA por
   `POST /api/modules/:id/mqtt-identity`, no recuperarla.
3. `nvs-identidad.csv` regenera la partición de identidad con
   `nvs_partition_gen.py` (codificación `hex2bin`: el HAL lee con
   `nvs_get_blob`, y una entrada `str` daría `TYPE_MISMATCH`).
4. `evtqueue-8-eventos-lab.bin` es evidencia histórica, no material operativo:
   son los ocho eventos de `lab-module-01` que el firmware republicaba en cada
   arranque antes de ligar la cola a la identidad.
