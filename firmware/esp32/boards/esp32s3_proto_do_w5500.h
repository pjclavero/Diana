/**
 * @file esp32s3_proto_do_w5500.h
 * @brief Perfil DIANA_BOARD_PROTO_DO_W5500 para el prototipo fisico DO-only.
 *
 * Fuente de verdad: montaje real descrito en docs/hardware/prototipo-do-only.md.
 * No usa ADC de impacto, ADS1115, ADS7953, MCP3208, MCP6004 externo, LM339
 * externo ni VREF_TH. La sensibilidad se ajusta con el potenciometro fisico de
 * cada modulo piezo comercial.
 */
#ifndef DIANA_BOARD_ESP32S3_PROTO_DO_W5500_H
#define DIANA_BOARD_ESP32S3_PROTO_DO_W5500_H

#define DIANA_BOARD_PROTO_DO_W5500 1
#define DIANA_BOARD_NAME       "proto-do-w5500"
#define DIANA_HARDWARE_REV     "PROTO_DO_W5500"

/* Banco 2026-08-23: sensores medidos en reposo a 0 V; impacto sube a 5 V. */
#define DIANA_DO_POLARITY      DIANA_DO_ACTIVE_HIGH
#define DIANA_SELECTOR_PROFILE DIANA_SELECTOR_2_POSITION
#define DIANA_HC165_POLL_MS    2

/* --- Cadenas LED por filas: 3 aros de 24 LED por fila --------------------- */
#define DIANA_PIN_LED_ROW0     4    /* D1-D3 */
#define DIANA_PIN_LED_ROW1     5    /* D4-D6 */
#define DIANA_PIN_LED_ROW2     6    /* D7-D9 */

/* --- SPI del W5500 -------------------------------------------------------- */
/* Reservados por compatibilidad documental; el montaje actual deja RST/INT NC. */
#define DIANA_PIN_ETH_RST      8
#define DIANA_PIN_ETH_INT      9
#define DIANA_PIN_ETH_CS       10
#define DIANA_PIN_ETH_MOSI     11
#define DIANA_PIN_ETH_SCLK     12
#define DIANA_PIN_ETH_MISO     13
#define DIANA_ETH_SPI_HOST     SPI2_HOST
#define DIANA_ETH_SPI_HZ       (5 * 1000 * 1000)

/* --- Selector SPDT actual ------------------------------------------------- */
#define DIANA_PIN_SELECTOR_A   15
#define DIANA_PIN_SELECTOR_B   16

/* --- Pulsador IDENTIFY ---------------------------------------------------- */
#define DIANA_PIN_BUTTON_ID    17

/* --- 2 x SN74HC165 en cascada -------------------------------------------- */
#define DIANA_PIN_HC165_DATA   38
#define DIANA_PIN_HC165_LOAD   47
#define DIANA_PIN_HC165_CLK    48
#define DIANA_HC165_BITS       16

/* --- Presupuesto de potencia LED ----------------------------------------- */
#define DIANA_LED_BUDGET_MA    3000
#define DIANA_LED_BRIGHTNESS_DEFAULT 120

#endif /* DIANA_BOARD_ESP32S3_PROTO_DO_W5500_H */
