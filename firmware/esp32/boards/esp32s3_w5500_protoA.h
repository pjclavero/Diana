/**
 * @file esp32s3_w5500_protoA.h
 * @brief Pinout PRELIMINAR de la placa esp32s3-w5500-protoA.
 *
 * ############################################################################
 * # AVISO: NINGUN PIN DE ESTE FICHERO SE HA VERIFICADO SOBRE HARDWARE REAL.  #
 * # Es una propuesta que cumple el presupuesto de GPIO del dosier 8.4 y las  #
 * # restricciones documentadas del ESP32-S3, pero DEBE contrastarse con la   #
 * # placa concreta antes de fabricar nada. Ver                               #
 * # docs/firmware/pinout-preliminar.md y la revision obligatoria del         #
 * # dosier 28.8.                                                             #
 * ############################################################################
 *
 * Restricciones tenidas en cuenta (ESP32-S3):
 *   - GPIO 26..32 los usan la flash SPI y la PSRAM octal: NO se tocan.
 *   - GPIO 0, 3, 45, 46 son pines de strapping: se evitan para entradas con
 *     pull externo o salidas activas en arranque.
 *   - Solo ADC1 (GPIO 1..10) es utilizable con WiFi activo; aunque aqui la red
 *     es Ethernet, se usa ADC1 igualmente por seguridad.
 *   - GPIO 19/20 son USB-JTAG (D-/D+): se dejan libres para depuracion.
 *   - Las 9 entradas de comparador necesitan capacidad de interrupcion: todos
 *     los GPIO del S3 la tienen.
 */
#ifndef DIANA_BOARD_ESP32S3_W5500_PROTOA_H
#define DIANA_BOARD_ESP32S3_W5500_PROTOA_H

#define DIANA_BOARD_NAME       "esp32s3-w5500-protoA"

/* ADR-0007 · perfil de deteccion. Esta placa SI mide amplitud de envolvente por
 * ADC, luego analog_envelope: amplitude y threshold son obligatorios en su
 * hit-event. (Emitirlo es opcional: la ausencia del campo ya equivale a
 * analogico, y asi los payloads previos al ADR no cambian ni un byte.) */
#define DIANA_DETECTION_PROFILE DIANA_DETECT_ANALOG_ENVELOPE
#define DIANA_HARDWARE_REV     "protoA"

/* --- SPI del W5500 (5 GPIO) ------------------------------------------------ */
#define DIANA_PIN_ETH_MISO     13
#define DIANA_PIN_ETH_MOSI     11
#define DIANA_PIN_ETH_SCLK     12
#define DIANA_PIN_ETH_CS       10
#define DIANA_PIN_ETH_INT      14
#define DIANA_PIN_ETH_RST      21
#define DIANA_ETH_SPI_HOST     SPI2_HOST
#define DIANA_ETH_SPI_HZ       (20 * 1000 * 1000)  /* W5500 admite hasta 80 MHz;
                                                    * 20 MHz es un arranque
                                                    * conservador a validar */

/* --- Comparadores de impacto, 9 GPIO de interrupcion ----------------------- */
/* Orden = indice de diana 1..9 (orden de lectura, dosier 6.2). */
#define DIANA_PIN_PIEZO_1      4
#define DIANA_PIN_PIEZO_2      5
#define DIANA_PIN_PIEZO_3      6
#define DIANA_PIN_PIEZO_4      7
#define DIANA_PIN_PIEZO_5      15
#define DIANA_PIN_PIEZO_6      16
#define DIANA_PIN_PIEZO_7      17
#define DIANA_PIN_PIEZO_8      18
#define DIANA_PIN_PIEZO_9      33

/* --- Multiplexor analogico CD74HC4067 (4 GPIO + 1 ADC) --------------------- */
#define DIANA_PIN_MUX_S0       35
#define DIANA_PIN_MUX_S1       36
#define DIANA_PIN_MUX_S2       37
#define DIANA_PIN_MUX_S3       38
#define DIANA_PIN_MUX_OUT      8    /* ADC1_CH7 */
#define DIANA_ADC_UNIT_MUX     ADC_UNIT_1
#define DIANA_ADC_CH_MUX       ADC_CHANNEL_7
/* Tiempo de asentamiento del mux antes de muestrear. PROVISIONAL. */
#define DIANA_MUX_SETTLE_US    5

/* --- Cadenas LED por filas (3 GPIO, RMT) ----------------------------------- */
#define DIANA_PIN_LED_ROW0     39   /* fila superior, dianas 1-3 */
#define DIANA_PIN_LED_ROW1     40   /* fila central,  dianas 4-6 */
#define DIANA_PIN_LED_ROW2     41   /* fila inferior, dianas 7-9 */

/* --- Selector de funcion de 3 posiciones (2 GPIO) -------------------------- */
/* Interruptor de 3 posiciones con comun a masa y pull-up interno:
 *   SATELITE  : A=0, B=1
 *   AUTO      : A=1, B=1   (posicion central, ningun contacto cerrado)
 *   PRINCIPAL : A=1, B=0
 * A=0 y B=0 simultaneos es imposible: se trata como averia del selector. */
#define DIANA_PIN_SELECTOR_A   42
#define DIANA_PIN_SELECTOR_B   2

/* --- Boton de identificacion (1 GPIO) -------------------------------------- */
#define DIANA_PIN_BUTTON_ID    1    /* activo a nivel bajo, pull-up interno */

/* --- Supervision de tension (2 ADC) ---------------------------------------- */
#define DIANA_PIN_VSENSE_5V    9    /* ADC1_CH8, divisor resistivo */
#define DIANA_PIN_VSENSE_12V   3    /* ADC1_CH2, divisor resistivo */
#define DIANA_ADC_CH_V5        ADC_CHANNEL_8
#define DIANA_ADC_CH_V12       ADC_CHANNEL_2
/* Factores del divisor. PROVISIONALES: dependen de las resistencias montadas. */
#define DIANA_VDIV_5V_NUM      2
#define DIANA_VDIV_5V_DEN      1
#define DIANA_VDIV_12V_NUM     6
#define DIANA_VDIV_12V_DEN     1

/* --- Estado y mantenimiento (2 GPIO) --------------------------------------- */
#define DIANA_PIN_LED_STATUS   47   /* LED de estado del propio modulo */
#define DIANA_PIN_LED_FAULT    48

/* --- Presupuesto de potencia LED (dosier 10.4) ----------------------------- */
/* 72 LED x 60 mA = 4320 mA en blanco maximo. El convertidor es de 5-6 A y debe
 * alimentar tambien la logica, asi que el firmware limita el consumo LED. */
#define DIANA_LED_BUDGET_MA    3000
#define DIANA_LED_BRIGHTNESS_DEFAULT 120

#endif /* DIANA_BOARD_ESP32S3_W5500_PROTOA_H */
