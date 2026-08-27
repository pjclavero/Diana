# Pinout efectivo del prototipo V1

Fuente de codigo:

```text
firmware/esp32/boards/esp32s3_proto_do_w5500.h
```

## Constantes de placa

| Constante | Valor | Funcion |
| --- | ---: | --- |
| `DIANA_BOARD_PROTO_DO_W5500` | 1 | Perfil activo |
| `DIANA_DO_POLARITY` | `DIANA_DO_ACTIVE_HIGH` | Sensores DO activos en HIGH |
| `DIANA_HC165_POLL_MS` | 2 | Polling de sensores |
| `DIANA_LEDS_PER_TARGET` | 24 | En `diana/types.h` |
| `DIANA_LEDS_PER_CHAIN` | 72 | En `diana/types.h` |
| `DIANA_ETH_SPI_HZ` | 5 MHz | Velocidad de banco para W5500 |

## GPIO

| GPIO | Firmware | Hardware |
| --- | --- | --- |
| 4 | `DIANA_PIN_LED_ROW0` | Fila D1-D3 |
| 5 | `DIANA_PIN_LED_ROW1` | Fila D4-D6 |
| 6 | `DIANA_PIN_LED_ROW2` | Fila D7-D9 |
| 8 | `DIANA_PIN_ETH_RST` | W5500 RST; salida, pulso de reset hardware en el arranque |
| 9 | `DIANA_PIN_ETH_INT` | Reservado; W5500 INT queda NC |
| 10 | `DIANA_PIN_ETH_CS` | W5500 chip select |
| 11 | `DIANA_PIN_ETH_MOSI` | SPI MOSI |
| 12 | `DIANA_PIN_ETH_SCLK` | SPI clock |
| 13 | `DIANA_PIN_ETH_MISO` | SPI MISO |
| 15 | `DIANA_PIN_SELECTOR_A` | Selector terminal 1 |
| 16 | `DIANA_PIN_SELECTOR_B` | Selector terminal 2 |
| 17 | `DIANA_PIN_BUTTON_ID` | IDENTIFY |
| 38 | `DIANA_PIN_HC165_DATA` | Datos 74HC165 |
| 47 | `DIANA_PIN_HC165_LOAD` | LOAD 74HC165 |
| 48 | `DIANA_PIN_HC165_CLK` | CLK 74HC165 |

## Pendiente de pinout

La devboard ESP32-S3 exacta esta pendiente de identificar. GPIO48 puede estar
relacionado con RGB integrado en algunas revisiones de devboard; no congelar el
cableado final sin verificar la placa fisica.
