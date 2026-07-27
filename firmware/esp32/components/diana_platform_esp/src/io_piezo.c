/**
 * @file io_piezo.c
 * @brief Captura de impacto por interrupcion AGREGADA + identidad por registro
 *        de desplazamiento, y lectura de amplitud. Dosier 9.4 y 9.5.
 *
 * Por que no hay 9 interrupciones: el presupuesto de GPIO no lo permite
 * (hardware/electronics/calculations/03-presupuesto-gpio.md). Las salidas de
 * los 9 comparadores se combinan en un OR cableado por diodos hacia un unico
 * GPIO `IRQ_ANY`, y la identidad del canal se lee despues por dos 74HC165.
 *
 * Reparto de responsabilidades, que es lo delicado aqui:
 *
 *   ISR (IRAM)  : hace lo MINIMO. Lee el reloj monotonico y avisa. Ese t_us es
 *                 T1 (ADR-0002) y no puede depender de cuando se llegue a
 *                 atender el aviso. NO lee el registro de desplazamiento: eso
 *                 son decenas de microsegundos de bit-bang, inaceptables en una
 *                 ISR.
 *   Tarea piezo : lee el 74HC165, traduce los bits a canales y encola un
 *                 disparo por canal activo, todos con el MISMO t_us de la ISR.
 *   diana_core  : agrupa en la ventana de 1-3 ms y decide por amplitud
 *                 (dosier 9.6). No sabe nada de todo esto.
 *
 * Limitacion conocida y aceptada (decision D-03): con la agregacion se pierde
 * el ORDEN temporal entre canales dentro de una misma lectura (decenas de us).
 * El algoritmo del dosier 9.6 decide por AMPLITUD dentro de la ventana, no por
 * orden de llegada, asi que no se pierde funcionalidad exigida.
 *
 * Segunda limitacion: mientras un canal siga activo, el nodo `IRQ_ANY` no
 * vuelve a reposo y un impacto en OTRO canal no genera flanco nuevo. Por eso,
 * tras cada interrupcion se sigue sondeando el registro hasta que todos los
 * canales vuelven a reposo, emitiendo los que aparezcan durante ese sondeo.
 */
#include "platform_internal.h"

#include <string.h>

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/task.h"

#if DIANA_LED_ENABLED || defined(DIANA_PIN_VREF_PWM)
#include "driver/ledc.h"
#endif

static const char *TAG = "diana.piezo";

/* Cola de avisos de la ISR. Solo lleva el instante: el canal aun no se sabe. */
static QueueHandle_t s_irq_queue;
static QueueHandle_t s_trigger_queue;

/* Tiempo maximo que se sigue sondeando el registro tras una interrupcion antes
 * de rearmar. Cubre la cola de una envolvente larga sin bloquear la tarea de
 * forma indefinida si un canal se queda pegado por averia. */
#define PIEZO_DRAIN_MAX_MS   250
#define PIEZO_DRAIN_STEP_MS  1

static void IRAM_ATTR piezo_isr(void *arg)
{
    (void)arg;
    /* IRAM_ATTR: debe poder ejecutarse con la cache de flash deshabilitada,
     * por ejemplo durante una escritura OTA. */
    uint64_t t_us = (uint64_t)esp_timer_get_time();

    BaseType_t hp = pdFALSE;
    xQueueSendFromISR(s_irq_queue, &t_us, &hp);
    if (hp) portYIELD_FROM_ISR();
}

/**
 * Lee los DIANA_SR_BITS bits del registro de desplazamiento por bit-bang.
 *
 * Secuencia del 74HC165: un pulso bajo en /PL captura las entradas paralelas;
 * a partir de ahi QH presenta la entrada H y cada flanco de subida de CP
 * desplaza la siguiente. Se lee, por tanto, de H hacia A.
 *
 * Convenio de mapeo: la entrada A del primer registro es el canal 1, de modo
 * que el bit n del valor devuelto corresponde al canal n+1.
 */
static uint32_t sr_read(void)
{
    gpio_set_level(DIANA_PIN_SR_LOAD, 0);
    esp_rom_delay_us(1);                 /* el 74HC165 exige >= 100 ns */
    gpio_set_level(DIANA_PIN_SR_LOAD, 1);
    esp_rom_delay_us(1);

    uint32_t v = 0;
    for (int i = DIANA_SR_BITS - 1; i >= 0; --i) {
        if (gpio_get_level(DIANA_PIN_SR_DATA)) v |= (1u << i);
        gpio_set_level(DIANA_PIN_SR_CLK, 1);
        esp_rom_delay_us(1);
        gpio_set_level(DIANA_PIN_SR_CLK, 0);
        esp_rom_delay_us(1);
    }
    return v;
}

/** Convierte la lectura cruda en mascara de canales disparados. */
static uint32_t sr_triggered(uint32_t raw)
{
    /* La polaridad depende del hardware montado: colector abierto activo bajo
     * en la PCB definitiva, salida activa en alto en los modulos comerciales de
     * la fase 1 (hallazgo M-02). */
#if DIANA_PIEZO_TRIGGERED_BIT == 0
    raw = ~raw;
#endif
    const uint32_t present = (DIANA_PIEZO_CHANNELS >= 32)
                                 ? 0xFFFFFFFFu
                                 : ((1u << DIANA_PIEZO_CHANNELS) - 1u);
    return raw & present;
}

static void push_triggers(uint32_t mask, uint64_t t_us)
{
    for (uint8_t ch = 0; ch < DIANA_PIEZO_CHANNELS; ++ch) {
        if (!(mask & (1u << ch))) continue;
        diana_platform_trigger t = {.channel = ch, .t_us = t_us};
        if (xQueueSend(s_trigger_queue, &t, 0) != pdTRUE)
            ESP_LOGW(TAG, "cola de disparos llena: impacto descartado");
    }
}

/**
 * Tarea de identificacion. Espera el aviso de la ISR, lee quien fue y encola.
 *
 * El primer disparo conserva el t_us de la ISR. Los canales que aparezcan
 * durante el sondeo posterior llevan su propio instante: son impactos
 * distintos, no el mismo.
 */
static void piezo_task(void *arg)
{
    (void)arg;
    uint64_t t_us = 0;

    for (;;) {
        if (xQueueReceive(s_irq_queue, &t_us, portMAX_DELAY) != pdTRUE) continue;

        uint32_t reported = sr_triggered(sr_read());
        push_triggers(reported, t_us);

        /* Mientras algun canal siga activo no habra flanco nuevo en IRQ_ANY:
         * hay que seguir mirando el registro. */
        for (int ms = 0; ms < PIEZO_DRAIN_MAX_MS; ms += PIEZO_DRAIN_STEP_MS) {
            vTaskDelay(pdMS_TO_TICKS(PIEZO_DRAIN_STEP_MS));
            uint32_t now_mask = sr_triggered(sr_read());
            if (now_mask == 0) break;

            uint32_t nuevos = now_mask & ~reported;
            if (nuevos) {
                push_triggers(nuevos, (uint64_t)esp_timer_get_time());
                reported |= nuevos;
            }
            /* Un canal que vuelve a reposo puede volver a dispararse. */
            reported &= now_mask;
        }

        /* Avisos de la ISR acumulados durante el sondeo: ya estan cubiertos. */
        xQueueReset(s_irq_queue);
    }
}

#if defined(DIANA_PIN_VREF_PWM)
/**
 * Genera el umbral comun por PWM filtrado (decision D-15: el ESP32-S3 no tiene
 * DAC).
 *
 * CRITICO: con el PWM a cero, VREF_TH = 0 V y TODOS los comparadores quedan
 * disparados. Esta funcion debe completarse, incluida la espera de asentamiento
 * del filtro RC, ANTES de habilitar la interrupcion de IRQ_ANY. De lo contrario
 * el modulo arranca con una tormenta de falsos impactos.
 */
static int vref_init(void)
{
    ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num = LEDC_TIMER_0,
        .freq_hz = 5000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    if (ledc_timer_config(&timer) != ESP_OK) return -1;

    /* Duty proporcional al umbral deseado sobre el fondo de escala de 3,3 V. */
    const uint32_t full = (1u << 10) - 1u;
    const uint32_t duty = (DIANA_VREF_TH_MV_DEFAULT * full) / 3300u;

    ledc_channel_config_t ch = {
        .gpio_num = DIANA_PIN_VREF_PWM,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0,
        .timer_sel = LEDC_TIMER_0,
        .duty = duty,
        .hpoint = 0,
    };
    if (ledc_channel_config(&ch) != ESP_OK) return -2;

    /* El filtro RC necesita 5 constantes de tiempo para asentarse. */
    vTaskDelay(pdMS_TO_TICKS(DIANA_VREF_SETTLE_MS));
    ESP_LOGI(TAG, "umbral fijado en %u mV (duty %u/%u), filtro asentado",
             (unsigned)DIANA_VREF_TH_MV_DEFAULT, (unsigned)duty, (unsigned)full);
    return 0;
}
#endif

int diana_pf_piezo_init(struct diana_platform *p)
{
    s_trigger_queue = xQueueCreate(64, sizeof(diana_platform_trigger));
    if (!s_trigger_queue) return -1;
    p->trigger_queue = s_trigger_queue;

    s_irq_queue = xQueueCreate(8, sizeof(uint64_t));
    if (!s_irq_queue) return -2;

    /* --- registro de desplazamiento --------------------------------------- */
    gpio_config_t sr_out = {
        .pin_bit_mask = (1ULL << DIANA_PIN_SR_LOAD) | (1ULL << DIANA_PIN_SR_CLK),
        .mode = GPIO_MODE_OUTPUT,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&sr_out) != ESP_OK) return -3;
    gpio_set_level(DIANA_PIN_SR_LOAD, 1);   /* /PL en reposo alto */
    gpio_set_level(DIANA_PIN_SR_CLK, 0);    /* CP desplaza en flanco de subida */

    gpio_config_t sr_in = {
        .pin_bit_mask = (1ULL << DIANA_PIN_SR_DATA),
        .mode = GPIO_MODE_INPUT,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&sr_in) != ESP_OK) return -4;

    /* --- ADC de amplitud --------------------------------------------------- */
    adc_oneshot_unit_init_cfg_t unit = {.unit_id = DIANA_ADC_UNIT_PIEZO};
    if (adc_oneshot_new_unit(&unit, &p->adc) != ESP_OK) return -5;

    adc_oneshot_chan_cfg_t ch_cfg = {
        .atten = ADC_ATTEN_DB_12,          /* rango completo 0-3,3 V */
        .bitwidth = ADC_BITWIDTH_12,
    };
#if defined(DIANA_ADC_CH_PIEZO_1)
    adc_oneshot_config_channel(p->adc, DIANA_ADC_CH_PIEZO_1, &ch_cfg);
    adc_oneshot_config_channel(p->adc, DIANA_ADC_CH_PIEZO_2, &ch_cfg);
#endif
#if DIANA_HAS_VSENSE
    adc_oneshot_config_channel(p->adc, DIANA_ADC_CH_V12, &ch_cfg);
#endif

    p->adc_lock = xSemaphoreCreateMutex();
    if (!p->adc_lock) return -6;

    /* --- umbral ANTES de habilitar la interrupcion (D-15) ------------------ */
#if defined(DIANA_PIN_VREF_PWM)
    if (vref_init() != 0) return -7;
#endif

    /* Lectura de descarte: deja el registro en un estado conocido y absorbe
     * cualquier disparo espurio del arranque. */
    (void)sr_read();

    /* --- tarea de identificacion ------------------------------------------ */
    /* Prioridad alta: entre el flanco y la lectura del registro no debe
     * colarse otro impacto. Se crea ANTES de habilitar la interrupcion. */
    if (xTaskCreate(piezo_task, "diana_piezo", 3072, NULL, 20, NULL) != pdPASS)
        return -8;

    /* --- interrupcion agregada -------------------------------------------- */
    gpio_config_t irq = {
        .pin_bit_mask = (1ULL << DIANA_PIN_IRQ_ANY),
        .mode = GPIO_MODE_INPUT,
        /* El OR cableado ya lleva su resistencia externa; el pull interno solo
         * define el nivel si esa resistencia faltara. */
        .pull_up_en = DIANA_PIEZO_IRQ_PULL_UP ? GPIO_PULLUP_ENABLE
                                              : GPIO_PULLUP_DISABLE,
        .pull_down_en = DIANA_PIEZO_IRQ_PULL_UP ? GPIO_PULLDOWN_DISABLE
                                                : GPIO_PULLDOWN_ENABLE,
        .intr_type = DIANA_PIEZO_IRQ_EDGE,
    };
    if (gpio_config(&irq) != ESP_OK) return -9;

    esp_err_t err = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return -10;
    if (gpio_isr_handler_add(DIANA_PIN_IRQ_ANY, piezo_isr, NULL) != ESP_OK)
        return -11;

    ESP_LOGI(TAG, "captura lista: %d canales, IRQ agregada en GPIO%d, "
                  "%d bits de registro, activo en %s",
             DIANA_PIEZO_CHANNELS, DIANA_PIN_IRQ_ANY, DIANA_SR_BITS,
             DIANA_PIEZO_TRIGGERED_BIT ? "alto" : "bajo");
    return 0;
}

bool diana_platform_trigger_pop(struct diana_platform *p,
                                diana_platform_trigger *out, uint32_t timeout_ms)
{
    if (!p->trigger_queue) return false;
    return xQueueReceive(p->trigger_queue, out, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}

int diana_pf_piezo_amplitude(void *ctx, uint8_t channel, uint16_t *out)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    if (channel >= DIANA_TARGET_COUNT) return DIANA_HAL_ERR_INVALID;

    /* Canales sin sensor conectado (la fase 1 monta 2 de 9): se reportan en
     * reposo, no como averia. Inventar un error haria fallar el
     * autodiagnostico por un hardware que sencillamente no esta. */
    if (channel >= DIANA_PIEZO_CHANNELS) {
        *out = 0;
        return DIANA_HAL_OK;
    }

#if defined(DIANA_ADC_CH_PIEZO_1)
    const adc_channel_t map[] = {DIANA_ADC_CH_PIEZO_1, DIANA_ADC_CH_PIEZO_2};
    if (channel >= (sizeof(map) / sizeof(map[0]))) return DIANA_HAL_ERR_INVALID;

    int raw = 0;
    xSemaphoreTake(p->adc_lock, portMAX_DELAY);
    esp_err_t err = adc_oneshot_read(p->adc, map[channel], &raw);
    xSemaphoreGive(p->adc_lock);

    if (err != ESP_OK) return DIANA_HAL_ERR_GENERIC;
    if (raw < 0) raw = 0;
    if (raw > 65535) raw = 65535;
    *out = (uint16_t)raw;
    return DIANA_HAL_OK;
#else
    /* Modulo definitivo: la amplitud la da un ADC SPI externo cuyo componente
     * NO esta decidido todavia (decision P-04: ADS7953 o 2x MCP3208). Hasta que
     * se elija, esto no puede devolver una lectura y no se finge que si. */
    (void)p;
    *out = 0;
    return DIANA_HAL_ERR_NOT_FOUND;
#endif
}

int diana_pf_adc_read_mv(struct diana_platform *p, int channel, int *out_mv)
{
    int raw = 0;
    xSemaphoreTake(p->adc_lock, portMAX_DELAY);
    esp_err_t err = adc_oneshot_read(p->adc, channel, &raw);
    xSemaphoreGive(p->adc_lock);
    if (err != ESP_OK) return DIANA_HAL_ERR_GENERIC;
    /* Conversion cruda sin curva de calibracion de eFuse: aproximada. Para
     * telemetria de tension basta; NO sirve para decidir un umbral piezo. */
    *out_mv = raw * 3300 / 4095;
    return DIANA_HAL_OK;
}
