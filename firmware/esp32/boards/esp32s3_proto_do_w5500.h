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

/* Banco 2026-08-20: sensores en reposo alto; impacto activa a nivel bajo. */
#define DIANA_DO_POLARITY      DIANA_DO_ACTIVE_LOW
#define DIANA_SELECTOR_PROFILE DIANA_SELECTOR_2_POSITION
#define DIANA_HC165_POLL_MS    2

/* --- Cadenas LED por filas: 3 aros de 24 LED por fila --------------------- */
#define DIANA_PIN_LED_ROW0     4    /* D1-D3 */
#define DIANA_PIN_LED_ROW1     5    /* D4-D6 */
#define DIANA_PIN_LED_ROW2     6    /* D7-D9 */

/* --- SPI del W5500 -------------------------------------------------------- */
#define DIANA_PIN_ETH_RST      8
#define DIANA_PIN_ETH_INT      9
#define DIANA_PIN_ETH_CS       10
#define DIANA_PIN_ETH_MOSI     11
#define DIANA_PIN_ETH_SCLK     12
#define DIANA_PIN_ETH_MISO     13
#define DIANA_ETH_SPI_HOST     SPI2_HOST
#define DIANA_ETH_SPI_HZ       (20 * 1000 * 1000)

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

/* --- Reserva: pines libres que NO se cablean en V1 -------------------------
 * Rescatado de hw/do-only-v1. Se declaran para que consten y para que nadie
 * los ocupe sin saber por que estaban libres. NO tienen uso en el firmware.
 *   GPIO7 : IRQ_ANY agregado de las senales DO. NO IMPLEMENTADO y no cableado:
 *           hace falta medir antes polaridad, duracion y forma del pulso DO.
 *   GPIO14: libre (era nCS_ADC).
 *   GPIO21: libre (era VREF_TH_PWM).
 * Si se confirma el conflicto GPIO48 / LED RGB del DevKit, HC165_CLK se mueve
 * a 14 o 21 y se actualiza tambien docs/firmware/pinout-definitivo.md. */
#define DIANA_PIN_RESERVED_IRQ_ANY  7
#define DIANA_PIN_RESERVED_A       14
#define DIANA_PIN_RESERVED_B       21

/* --- Presupuesto de potencia LED ----------------------------------------- */
#define DIANA_LED_BUDGET_MA    3000
#define DIANA_LED_BRIGHTNESS_DEFAULT 120

#endif /* DIANA_BOARD_ESP32S3_PROTO_DO_W5500_H */
