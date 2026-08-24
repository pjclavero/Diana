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
| NC | RST / RESET | No conectado; reset software del driver |
| NC | INT / IRQ | No usado; firmware por sondeo cada 10 ms |
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

El firmware actual sigue el ejemplo W5500 de ESP-IDF 5.5:

- SPI modo 0 a 5 MHz en el firmware completo.
- CS en GPIO10, forzado a nivel alto desde el inicio del arranque.
- Espera de 1.5 s antes del primer acceso SPI.
- RST sin conectar y `reset_gpio_num = -1`.
- INT sin usar; `poll_period_ms = 10`.
- Verificacion y reset software realizados por el driver oficial.

## Estado de bring-up

Esperado:

```text
VERSIONR = 0x04
```

Prueba minima oficial validada:

```text
W5500 SPI=OK
LINK=UP
DHCP IP=192.168.1.168
```

Configuracion de esa prueba: GPIO10/11/12/13, SPI modo 0 a 1 MHz, RST e INT sin
usar, sondeo cada 10 ms. El LED del modulo y el LED RJ45 estaban encendidos.

El firmware completo tambien alcanzo `W5500 SPI=OK` a 5 MHz despues de cortar y
reponer la alimentacion del W5500. Sin embargo, aproximadamente 2 s despues de
`driver arrancado` aparece un `StoreProhibited`/asercion dentro del temporizador
de FreeRTOS. Esta integracion sigue abierta y no se atribuye al cableado SPI.

Tras algunos reflasheos con el W5500 alimentado continuamente, `VERSIONR`
volvio a `0x00`; un corte de alimentacion del modulo lo recupero al menos una
vez. Queda pendiente validar diez reinicios consecutivos y medir 3.3 V en carga.

## Servidor LAN

Desde el PC de banco:

```text
192.168.1.209 responde a ping
TCP 1883, 8080, 80, 22, 443, 8443 y 9001 no aceptan conexion
```

DHCP queda validado solo en la imagen minima. MQTT real no queda validado hasta
resolver el reinicio del firmware completo, aprovisionar `module_id` y exponer
el broker.
