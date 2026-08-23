# Ethernet W5500

## Hardware

Modulo comercial W5500 con RJ45.

Modelo comercial exacto: PENDIENTE DE IDENTIFICAR.

Referencia/enlace de compra: no localizada en el repo.

Referencia tecnica generica consultada:

```text
https://docs.wiznet.io/Product/ioModule/W5500-io
```

Esto confirma familia/chip, pero no identifica la variante comercial comprada.

## Conexionado firmware

| ESP32-S3 | W5500 | Direccion |
| --- | --- | --- |
| GPIO8 | RST / RESET | ESP32 -> W5500 |
| GPIO9 | INT / IRQ | W5500 -> ESP32 |
| GPIO10 | CS / SCS / SS | ESP32 -> W5500 |
| GPIO11 | MOSI / SI / DIN | ESP32 -> W5500 |
| GPIO12 | SCK / SCLK | ESP32 -> W5500 |
| GPIO13 | MISO / SO / DOUT | W5500 -> ESP32 |
| GND | GND | comun |

MOSI/MISO no se cruzan.

## Alimentacion

La documentacion local previa indica que el modulo fisico dispone de pines de
alimentacion 5 V y 3.3 V. Pendiente de identificar variante exacta del modulo.

El chip/modulo WIZnet trabaja a 3.3 V nominal. Si el pin 5 V del modulo comprado
es valido, debe ser una entrada de la placa portadora con regulador integrado.

No alimentar simultaneamente por 5 V y 3.3 V salvo confirmacion explicita del
modulo comercial.

El W5500 usa senales SPI a 3.3 V.

## Firmware

Driver:

```text
firmware/esp32/components/diana_platform_esp/src/net_w5500.c
```

Board profile:

```text
DIANA_ETH_SPI_HZ = 5 MHz
```

El firmware de banco fuerza reset por GPIO8 antes de leer `VERSIONR`.

## Estado de bring-up

Esperado:

```text
VERSIONR = 0x04
```

Observado:

```text
VERSIONR = 0x00
W5500 SPI=FAIL
LINK=DOWN
IP=0.0.0.0
```

El W5500 estaba conectado al switch LAN y alimentado; los LED RJ45 del modulo
estaban apagados.

Interpretacion: no se declara Ethernet validado. El fallo esta antes de DHCP y
MQTT. Revisar alimentacion, GND, RST, CS, MISO/MOSI/SCK, variante exacta del
modulo y cable/switch.

## Servidor LAN

Desde el PC de banco:

```text
192.168.1.209 responde a ping
TCP 1883, 8080, 80, 22, 443, 8443 y 9001 no aceptan conexion
```

Aunque el W5500 quede arreglado, MQTT real no queda validado hasta que el broker
este expuesto o se configure otro destino.
