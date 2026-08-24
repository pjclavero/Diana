# Conexionado maestro del prototipo V1

## Tabla maestra GPIO

| GPIO | Direccion | Funcion | Destino | Estado |
| --- | --- | --- | --- | --- |
| GPIO4 | OUT | LED_ROW1 | D1 -> D2 -> D3 | Firmware actual |
| GPIO5 | OUT | LED_ROW2 | D4 -> D5 -> D6 | Firmware actual |
| GPIO6 | OUT | LED_ROW3 | D7 -> D8 -> D9 | Firmware actual |
| GPIO8 | Libre | W5500_RST historico | NC | Firmware actual usa reset software |
| GPIO9 | Libre | W5500_INT historico | NC | Firmware actual usa sondeo de 10 ms |
| GPIO10 | OUT | W5500_CS | W5500 CS/SCS/SS | Firmware actual |
| GPIO11 | OUT | SPI_MOSI | W5500 MOSI/SI/DIN | Firmware actual |
| GPIO12 | OUT | SPI_CLK | W5500 SCK/SCLK | Firmware actual |
| GPIO13 | IN | SPI_MISO | W5500 MISO/SO/DOUT | Firmware actual |
| GPIO15 | IN PU | SELECTOR_A | SPDT terminal 1 | Firmware actual; monitor 1 |
| GPIO16 | IN PU | SELECTOR_B | SPDT terminal 2 | Firmware actual; monitor 1 |
| GPIO17 | IN PU | IDENTIFY | Pulsador a GND | Firmware actual; monitor HIGH |
| GPIO38 | IN | SR_DATA | 74HC165 #2 QH/SER_OUT | Firmware actual |
| GPIO47 | OUT | SR_LOAD | 74HC165 SH/LD compartido | Firmware actual |
| GPIO48 | OUT | SR_CLK | 74HC165 CLK compartido | Firmware actual; devboard exacta pendiente |

## W5500

```text
ESP32 GPIO11 MOSI -> W5500 MOSI / SI / DIN
ESP32 GPIO12 SCK  -> W5500 SCK / SCLK
ESP32 GPIO13 MISO <- W5500 MISO / SO / DOUT
ESP32 GPIO10 CS   -> W5500 CS / SCS / SS
W5500 RST / RESET -> NC
W5500 INT / IRQ   -> NC
GND <----------------------> GND
```

MOSI/MISO no se cruzan como UART. El W5500 usa logica SPI a 3.3 V. GPIO10 se
mantiene alto antes de inicializar SPI; despues CS lo controla el periferico.

## 74HC165

```text
HC165 #1 QH/SER_OUT -> HC165 #2 SER_IN
HC165 #2 QH/SER_OUT -> ESP32 GPIO38

ESP32 GPIO47 -> HC165 #1 SH/LD
             -> HC165 #2 SH/LD

ESP32 GPIO48 -> HC165 #1 CLK
             -> HC165 #2 CLK

CE / CLK_INH de ambos -> GND
SER_IN de HC165 #1 -> nivel fijo conocido
```

Entradas:

| Entrada | Diana |
| --- | --- |
| HC165 #1 A | D1 |
| HC165 #1 B | D2 |
| HC165 #1 C | D3 |
| HC165 #1 D | D4 |
| HC165 #1 E | D5 |
| HC165 #1 F | D6 |
| HC165 #1 G | D7 |
| HC165 #1 H | D8 |
| HC165 #2 A | D9 |
| HC165 #2 B-H | reserva |

Las entradas libres no deben quedar flotantes. En el banco parcial D4-D9 se
documentaron a GND para `DIANA_DO_ACTIVE_HIGH`.

## LED

```text
ROW1: GPIO4 -> D1 DI ; D1 DO -> D2 DI ; D2 DO -> D3 DI
ROW2: GPIO5 -> D4 DI ; D4 DO -> D5 DI ; D5 DO -> D6 DI
ROW3: GPIO6 -> D7 DI ; D7 DO -> D8 DI ; D8 DO -> D9 DI
```

Cada aro tiene 24 LED. Cada fila tiene 72 LED. Los GPIO del ESP32 no alimentan
los aros; solo llevan dato.

## Selector e IDENTIFY

```text
Selector SPDT:
terminal 1 -> GPIO15
COM        -> GND
terminal 2 -> GPIO16

IDENTIFY:
GPIO17 -> pulsador -> GND
```

## Diagrama de bloques

```text
                    +-------------------+
                    |     ESP32-S3      |
                    |                   |
            GPIO4 --| LED ROW 1         |--> D1 -> D2 -> D3
            GPIO5 --| LED ROW 2         |--> D4 -> D5 -> D6
            GPIO6 --| LED ROW 3         |--> D7 -> D8 -> D9
                    |                   |
       GPIO10-13 ---| SPI / W5500       |--> RJ45 / Ethernet
                    |                   |
           GPIO38 <-| HC165 DATA        |
           GPIO47 ->| HC165 LOAD        |
           GPIO48 ->| HC165 CLK         |
                    +---------+---------+
                              |
                    +---------+---------+
                    |   2 x 74HC165     |
                    +-------------------+
                       | | | | | | | |
                       D1 ... D8
                              |
                              D9
```
