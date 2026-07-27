/**
 * @file esp32s3_topoB_fase1.h
 * @brief Pinout de la FASE 1: devkit ESP32-S3 + modulos piezo comerciales.
 *
 * ############################################################################
 * # SIN VERIFICAR SOBRE HARDWARE. Ver docs/firmware/fase1-protoboard.md.     #
 * ############################################################################
 *
 * Banco de pruebas para desarrollar el firmware sin la PCB definitiva:
 *   - 2 modulos "piezoelectric shock/tap sensor" (disco + comparador + pot).
 *   - Identidad de canal por 74HC165, igual que la topologia B definitiva.
 *   - Amplitud por el ADC1 interno (en la PCB sera un ADC SPI externo).
 *   - Red por WiFi mientras no haya W5500.
 *
 * Restricciones del ESP32-S3-WROOM-1 tenidas en cuenta (caso peor N16R8):
 *   - GPIO 26..32 : flash SPI interna. No salen del modulo.
 *   - GPIO 35..37 : PSRAM octal de la variante R8. NO CONECTAR.
 *   - GPIO 0,3,45,46 : strapping. No se usan.
 *   - GPIO 19,20  : USB-Serial-JTAG nativo, reservados para `idf.py flash`.
 *   - GPIO 43,44  : UART0, consola de respaldo.
 *   - Solo ADC1 (GPIO 1..10) es utilizable: ADC2 no funciona con la radio WiFi
 *     activa, y en fase 1 la radio SI esta activa.
 *
 * DESVIACIONES del modulo comercial respecto al diseno de la PCB (M-01, M-02
 * de docs/firmware/fase1-protoboard.md §1):
 *   M-01  Su ficha dice 5 V. Se alimenta a 3,3 V: a 5 V, DO y AO superarian el
 *         maximo absoluto del ESP32-S3 (VDD+0,3 = 3,6 V).
 *   M-02  Su salida DO es ACTIVA EN ALTO, al reves que la PCB definitiva (LM339
 *         en colector abierto, activo bajo). De ahi que aqui el OR de diodos
 *         lleve pull-DOWN y la interrupcion sea por flanco de SUBIDA.
 *         Lo gobierna CONFIG_DIANA_PIEZO_ACTIVE_LOW.
 */
#ifndef DIANA_BOARD_ESP32S3_TOPOB_FASE1_H
#define DIANA_BOARD_ESP32S3_TOPOB_FASE1_H

#define DIANA_BOARD_NAME       "esp32s3-topoB-fase1"
#define DIANA_HARDWARE_REV     "fase1"

/* --- Captura de impacto: IRQ agregada + identidad por 74HC165 -------------- */
/* Un unico GPIO despierta ante CUALQUIER canal; el registro de desplazamiento
 * dice cual fue. Es la arquitectura de la topologia B (calculo 03), montada
 * aqui con 2 canales en vez de 9. */
#define DIANA_PIN_IRQ_ANY      7
#define DIANA_PIN_SR_DATA      38   /* QH  (pin 9)  del 74HC165 */
#define DIANA_PIN_SR_LOAD      47   /* /PL (pin 1)  del 74HC165, activo bajo */
#define DIANA_PIN_SR_CLK       48   /* CP  (pin 2)  del 74HC165 */

/* Numero de bits a desplazar. Un solo 74HC165 = 8 bits (en la PCB seran dos en
 * cascada = 16, de los que se usan 9). */
#define DIANA_SR_BITS          8

/* Canales fisicamente cableados. Los demas hasta DIANA_TARGET_COUNT existen en
 * la logica pero no tienen sensor: su amplitud se reporta como 0 (reposo), no
 * como error, para que el autodiagnostico no los marque averiados. */
#define DIANA_PIEZO_CHANNELS   2

/* --- Amplitud por ADC1 interno (provisional de la fase 1) ------------------ */
/* En la PCB definitiva esto lo hace un ADC SPI externo tras el mismo interfaz
 * del HAL (piezo_amplitude), sin tocar diana_core. */
#define DIANA_ADC_UNIT_PIEZO   ADC_UNIT_1
#define DIANA_PIN_AO_CH1       1    /* AO modulo 1 -> ADC1_CH0 */
#define DIANA_PIN_AO_CH2       2    /* AO modulo 2 -> ADC1_CH1 */
#define DIANA_ADC_CH_PIEZO_1   ADC_CHANNEL_0
#define DIANA_ADC_CH_PIEZO_2   ADC_CHANNEL_1

/* --- Selector de funcion de 3 posiciones (dosier 6.3) --------------------- */
/* Interruptor con comun a masa y pull-up interno:
 *   SATELITE  : A=0, B=1
 *   AUTO      : A=1, B=1   (posicion central, ningun contacto cerrado)
 *   PRINCIPAL : A=1, B=0
 * A=0 y B=0 es imposible con un selector sano: se trata como averia y se
 * degrada a SATELITE (decision D-12). */
#define DIANA_PIN_SELECTOR_A   15
#define DIANA_PIN_SELECTOR_B   16

/* --- Boton de identificacion ---------------------------------------------- */
#define DIANA_PIN_BUTTON_ID    17   /* activo a nivel bajo, pull-up interno */

/* --- Estado y averia ------------------------------------------------------- */
#define DIANA_PIN_LED_STATUS   18
#define DIANA_PIN_LED_FAULT    39

/* --- Cadenas LED de dianas ------------------------------------------------- */
/* En fase 1 no se montan las tiras WS2812, pero los pines se reservan ya con la
 * asignacion definitiva para no tener que recablear despues. */
#define DIANA_PIN_LED_ROW0     4    /* fila superior, dianas 1-3 */
#define DIANA_PIN_LED_ROW1     5    /* fila central,  dianas 4-6 */
#define DIANA_PIN_LED_ROW2     6    /* fila inferior, dianas 7-9 */
#define DIANA_LED_ENABLED      0    /* 0 = no hay tiras conectadas todavia */

/* --- Supervision de tension ------------------------------------------------ */
/* El devkit se alimenta por USB: no hay divisores de 5 V ni de 12 V. La
 * telemetria declara "tension no disponible" en vez de inventar un valor. */
#define DIANA_HAS_VSENSE       0

/* --- Presupuesto de potencia LED (dosier 10.4) ---------------------------- */
#define DIANA_LED_BUDGET_MA    3000
#define DIANA_LED_BRIGHTNESS_DEFAULT 120

#endif /* DIANA_BOARD_ESP32S3_TOPOB_FASE1_H */
