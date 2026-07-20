/**
 * @file io_piezo.c
 * @brief Captura digital por interrupcion + lectura de amplitud por multiplexor.
 *        NO COMPILADO. Dosier 9.4 y 9.5.
 *
 * La ISR hace lo MINIMO: leer el reloj monotonico y encolar (canal, t_us). Ese
 * t_us es T1 (ADR-0002) y no puede depender de cuando la tarea llegue a
 * atenderlo. La lectura del ADC, que es lenta y bloqueante, ocurre fuera de la
 * ISR.
 */
#include "platform_internal.h"

#include <string.h>

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"

static const char *TAG = "diana.piezo";

static const gpio_num_t PIEZO_PINS[DIANA_TARGET_COUNT] = {
    DIANA_PIN_PIEZO_1, DIANA_PIN_PIEZO_2, DIANA_PIN_PIEZO_3,
    DIANA_PIN_PIEZO_4, DIANA_PIN_PIEZO_5, DIANA_PIN_PIEZO_6,
    DIANA_PIN_PIEZO_7, DIANA_PIN_PIEZO_8, DIANA_PIN_PIEZO_9,
};

static const gpio_num_t MUX_PINS[4] = {
    DIANA_PIN_MUX_S0, DIANA_PIN_MUX_S1, DIANA_PIN_MUX_S2, DIANA_PIN_MUX_S3,
};

static QueueHandle_t s_trigger_queue;

static void IRAM_ATTR piezo_isr(void *arg)
{
    /* IRAM_ATTR: la ISR debe poder ejecutarse con la cache de flash
     * deshabilitada (p. ej. durante una escritura OTA). */
    diana_platform_trigger t;
    t.channel = (uint8_t)(uintptr_t)arg;
    t.t_us = (uint64_t)esp_timer_get_time();

    BaseType_t hp = pdFALSE;
    xQueueSendFromISR(s_trigger_queue, &t, &hp);
    if (hp) portYIELD_FROM_ISR();
}

int diana_pf_piezo_init(struct diana_platform *p)
{
    s_trigger_queue = xQueueCreate(64, sizeof(diana_platform_trigger));
    if (!s_trigger_queue) return -1;
    p->trigger_queue = s_trigger_queue;

    /* Entradas de comparador: flanco de subida. El antirrebote y la ventana de
     * agrupacion los aplica diana_core, no el hardware. */
    uint64_t mask = 0;
    for (int i = 0; i < DIANA_TARGET_COUNT; ++i) mask |= (1ULL << PIEZO_PINS[i]);

    gpio_config_t in = {
        .pin_bit_mask = mask,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_ENABLE,
        .intr_type = GPIO_INTR_POSEDGE,
    };
    if (gpio_config(&in) != ESP_OK) return -2;

    if (gpio_install_isr_service(ESP_INTR_FLAG_IRAM) != ESP_OK) return -3;
    for (int i = 0; i < DIANA_TARGET_COUNT; ++i) {
        if (gpio_isr_handler_add(PIEZO_PINS[i], piezo_isr,
                                 (void *)(uintptr_t)i) != ESP_OK)
            return -4;
    }

    /* Selectores del multiplexor CD74HC4067. */
    uint64_t mux_mask = 0;
    for (int i = 0; i < 4; ++i) mux_mask |= (1ULL << MUX_PINS[i]);
    gpio_config_t mux = {
        .pin_bit_mask = mux_mask,
        .mode = GPIO_MODE_OUTPUT,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&mux) != ESP_OK) return -5;

    /* ADC del ESP32-S3 para la envolvente. Sustituible por un ADC externo SPI
     * sin tocar diana_core: la interfaz del HAL es la misma (dosier 9.5). */
    adc_oneshot_unit_init_cfg_t unit = {.unit_id = DIANA_ADC_UNIT_MUX};
    if (adc_oneshot_new_unit(&unit, &p->adc) != ESP_OK) return -6;

    adc_oneshot_chan_cfg_t ch = {
        .atten = ADC_ATTEN_DB_12,      /* rango completo 0-3,3 V */
        .bitwidth = ADC_BITWIDTH_12,
    };
    adc_oneshot_config_channel(p->adc, DIANA_ADC_CH_MUX, &ch);
    adc_oneshot_config_channel(p->adc, DIANA_ADC_CH_V5, &ch);
    adc_oneshot_config_channel(p->adc, DIANA_ADC_CH_V12, &ch);

    p->adc_lock = xSemaphoreCreateMutex();
    if (!p->adc_lock) return -7;

    ESP_LOGI(TAG, "9 comparadores y multiplexor inicializados");
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

    xSemaphoreTake(p->adc_lock, portMAX_DELAY);
    for (int i = 0; i < 4; ++i)
        gpio_set_level(MUX_PINS[i], (channel >> i) & 1);

    /* El mux necesita asentarse antes de muestrear. El valor es PROVISIONAL y
     * debe medirse con osciloscopio (docs/firmware/validacion-fisica-pendiente.md). */
    esp_rom_delay_us(DIANA_MUX_SETTLE_US);

    int raw = 0;
    esp_err_t err = adc_oneshot_read(p->adc, DIANA_ADC_CH_MUX, &raw);
    xSemaphoreGive(p->adc_lock);

    if (err != ESP_OK) return DIANA_HAL_ERR_GENERIC;
    if (raw < 0) raw = 0;
    if (raw > 65535) raw = 65535;
    *out = (uint16_t)raw;
    return DIANA_HAL_OK;
}

int diana_pf_adc_read_mv(struct diana_platform *p, int channel, int *out_mv)
{
    int raw = 0;
    xSemaphoreTake(p->adc_lock, portMAX_DELAY);
    esp_err_t err = adc_oneshot_read(p->adc, channel, &raw);
    xSemaphoreGive(p->adc_lock);
    if (err != ESP_OK) return DIANA_HAL_ERR_GENERIC;
    /* Conversion cruda sin curva de calibracion eFuse: aproximada. Para
     * telemetria de tension basta; NO sirve para decidir un umbral piezo. */
    *out_mv = raw * 3300 / 4095;
    return DIANA_HAL_OK;
}
