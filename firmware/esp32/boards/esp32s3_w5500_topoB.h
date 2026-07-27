/**
 * @file esp32s3_w5500_topoB.h
 * @brief Pinout del modulo 3x3 completo — TOPOLOGIA B.
 *
 * ############################################################################
 * # SIN VERIFICAR SOBRE HARDWARE. No autoriza fabricar ninguna PCB.          #
 * # Fuente normativa del conexionado:                                        #
 * #   hardware/electronics/schematics/02-esp32-w5500.md §3                   #
 * #   hardware/electronics/calculations/03-presupuesto-gpio.md §3.1          #
 * # Vista de firmware: docs/firmware/pinout-definitivo.md                    #
 * ############################################################################
 *
 * Por que topologia B y no la lectura literal del dosier §8.4: aquella pide 29
 * GPIO sin reserva (34 con ella) y solo hay 25 utilizables en un
 * ESP32-S3-WROOM-1-N16R8. Deficit de 4 a 9 pines. La topologia B cierra el
 * presupuesto en 21 usados + 4 de reserva mediante:
 *   - agregar las 9 interrupciones de comparador en 4 GPIO (OR cableado por
 *     diodos hacia IRQ_ANY + dos 74HC165 en cascada para la identidad);
 *   - sustituir el multiplexor CD74HC4067 (5 GPIO) por un ADC SPI externo que
 *     comparte bus con el W5500 y solo cuesta un chip select.
 *
 * Restricciones del ESP32-S3-WROOM-1-N16R8:
 *   - GPIO 26..32 : flash SPI interna, no salen del modulo.
 *   - GPIO 35..37 : PSRAM octal (variante R8). NO CONECTAR NADA.
 *   - GPIO 0,3,45,46 : strapping. IO45 ademas exige pull-down externo.
 *   - GPIO 19,20  : USB-Serial-JTAG nativo. Se conservan (no se usa JTAG
 *                   externo: decision P-02), asi que la reserva IO40..42 queda
 *                   libre.
 *   - GPIO 43,44  : UART0, cabezal de programacion de respaldo.
 *   - Solo ADC1 (GPIO 1..10).
 */
#ifndef DIANA_BOARD_ESP32S3_W5500_TOPOB_H
#define DIANA_BOARD_ESP32S3_W5500_TOPOB_H

#define DIANA_BOARD_NAME       "esp32s3-w5500-topoB"
#define DIANA_HARDWARE_REV     "topoB"

/* --- Bus SPI compartido: W5500 + ADC externo ------------------------------ */
/* El arbitraje es por chip select. Riesgo conocido (hoja 02 §7.4): si un
 * esclavo no libera MISO, se bloquea el bus. */
#define DIANA_PIN_SPI_MOSI     11
#define DIANA_PIN_SPI_SCLK     12
#define DIANA_PIN_SPI_MISO     13
#define DIANA_ETH_SPI_HOST     SPI2_HOST

/* Ethernet W5500 */
#define DIANA_PIN_ETH_MISO     DIANA_PIN_SPI_MISO
#define DIANA_PIN_ETH_MOSI     DIANA_PIN_SPI_MOSI
#define DIANA_PIN_ETH_SCLK     DIANA_PIN_SPI_SCLK
#define DIANA_PIN_ETH_CS       10
#define DIANA_PIN_ETH_INT      9    /* INTn, pull-up externo 10 k */
#define DIANA_PIN_ETH_RST      8    /* RSTn, pull-up 10 k + RC de 1 ms */
/* 20 MHz de arranque. El W5500 admite mas, pero con dos esclavos en el bus y
 * sin impedancia controlada hay que validarlo con analizador logico (V). */
#define DIANA_ETH_SPI_HZ       (20 * 1000 * 1000)

/* ADC SPI externo: COMPONENTE PENDIENTE DE SELECCION (decision P-04).
 * Candidatos: ADS7953 (16 can., solo SMD) o 2x MCP3208 (DIP, facil de comprar).
 * Solo consume el chip select: cambiar de uno a otro no altera el pinout. */
#define DIANA_PIN_ADC_CS       14

/* --- Captura de impacto: IRQ agregada + identidad por 74HC165 -------------- */
#define DIANA_PIN_IRQ_ANY      7    /* OR de 9 diodos, pull-up 4,7 k, activo BAJO */
#define DIANA_PIN_SR_DATA      38   /* QH del segundo 74HC165 */
#define DIANA_PIN_SR_LOAD      47   /* /PL de ambos */
#define DIANA_PIN_SR_CLK       48   /* CP de ambos */
#define DIANA_SR_BITS          16   /* dos 74HC165 en cascada; se usan 9 bits */
#define DIANA_PIEZO_CHANNELS   9

/* --- Umbral comun ajustable por PWM filtrado (decision D-15) --------------- */
/* El ESP32-S3 NO tiene DAC. El umbral se genera con PWM + filtro RC
 * (47 kohm / 1 uF, tau = 47 ms) y un seguidor.
 *
 * PELIGRO DE ARRANQUE: con el PWM a 0, VREF_TH = 0 V y los 9 comparadores
 * quedan disparados. El firmware DEBE fijar el umbral y esperar a que el filtro
 * se asiente ANTES de habilitar la interrupcion de IRQ_ANY. */
#define DIANA_PIN_VREF_PWM     21
#define DIANA_VREF_RC_TAU_MS   47
#define DIANA_VREF_SETTLE_MS   (5 * DIANA_VREF_RC_TAU_MS)   /* 235 ms */
/* Umbral inicial. El calculo 02 §6 da 120,7 mV para la configuracion NO
 * inversora, pero esa polaridad contradice el OR de diodos (hallazgo H-PIN-01)
 * y la PCB debe usar la INVERSORA, cuyo umbral de subida sale a ~151 mV con la
 * misma referencia. Se arranca en el valor del calculo y se ajusta en banco:
 * el ajuste fino por canal lo hace el firmware contra la amplitud del ADC
 * (dosier 9.7). */
#define DIANA_VREF_TH_MV_DEFAULT  120

/* --- Cadenas LED por filas (RMT) ------------------------------------------ */
#define DIANA_PIN_LED_ROW0     4    /* fila superior, dianas 1-3 */
#define DIANA_PIN_LED_ROW1     5    /* fila central,  dianas 4-6 */
#define DIANA_PIN_LED_ROW2     6    /* fila inferior, dianas 7-9 */
#define DIANA_LED_ENABLED      1

/* --- Selector, boton y estado --------------------------------------------- */
#define DIANA_PIN_SELECTOR_A   15
#define DIANA_PIN_SELECTOR_B   16
#define DIANA_PIN_BUTTON_ID    17
#define DIANA_PIN_LED_STATUS   18   /* verde */
#define DIANA_PIN_LED_FAULT    39   /* ambar. Consume MTCK; aceptado por P-02 */

/* --- Supervision de tension ------------------------------------------------ */
/* Solo queda una medida directa: el ADC externo lee tambien los rieles y hace
 * de redundancia. IO3 (strapping), que el pinout preliminar usaba para esto,
 * queda descartado: cierra el hallazgo X-04. */
#define DIANA_HAS_VSENSE       1
#define DIANA_PIN_VSENSE_12V   1    /* ADC1_CH0, divisor resistivo */
#define DIANA_ADC_UNIT_PIEZO   ADC_UNIT_1
#define DIANA_ADC_CH_V12       ADC_CHANNEL_0
/* Factores del divisor. PROVISIONALES: dependen de las resistencias montadas.
 * Sin ajustarlos, la telemetria de tension miente. */
#define DIANA_VDIV_12V_NUM     6
#define DIANA_VDIV_12V_DEN     1

/* --- Pines de reserva ------------------------------------------------------ */
/* IO2 (ADC1_CH1, sin restricciones) e IO40..42. Llevados a puntos de prueba
 * TP16..TP19, sin funcion asignada. */

/* --- Presupuesto de potencia LED (dosier 10.4) ---------------------------- */
/* 72 LED x 60 mA = 4320 mA en blanco maximo. El convertidor es de 6 A y ademas
 * alimenta la logica: el firmware limita el consumo. */
#define DIANA_LED_BUDGET_MA    3000
#define DIANA_LED_BRIGHTNESS_DEFAULT 120

#endif /* DIANA_BOARD_ESP32S3_W5500_TOPOB_H */
