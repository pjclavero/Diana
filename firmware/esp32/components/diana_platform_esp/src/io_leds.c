/**
 * @file io_leds.c
 * @brief Tres cadenas de 24 LED por RMT (dosier 10.2).
 *
 * En el banco de la fase 1 no hay tiras conectadas (DIANA_LED_ENABLED = 0): las
 * operaciones se aceptan y no hacen nada, en vez de fallar. Asi el resto del
 * firmware —que si publica estados de diana— se ejecuta igual y no hay que
 * poner condicionales en diana_core.
 */
#include "platform_internal.h"

#include <string.h>

#include "esp_log.h"

static const char *TAG = "diana.led";

#if DIANA_LED_ENABLED
static const int LED_PINS[DIANA_LED_CHAINS] = {
    DIANA_PIN_LED_ROW0, DIANA_PIN_LED_ROW1, DIANA_PIN_LED_ROW2,
};
#endif

int diana_pf_leds_init(struct diana_platform *p)
{
#if !DIANA_LED_ENABLED
    (void)p;
    ESP_LOGW(TAG, "sin tiras de LED en esta placa: salidas de diana simuladas");
    return 0;
#else
    for (int c = 0; c < DIANA_LED_CHAINS; ++c) {
        led_strip_config_t scfg = {
            .strip_gpio_num = LED_PINS[c],
            .max_leds = DIANA_LEDS_PER_CHAIN,
            .led_model = LED_MODEL_WS2812,
            .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
            .flags.invert_out = false,
        };
        led_strip_rmt_config_t rcfg = {
            .clk_src = RMT_CLK_SRC_DEFAULT,
            .resolution_hz = 10 * 1000 * 1000,
            .flags.with_dma = false,
        };
        if (led_strip_new_rmt_device(&scfg, &rcfg, &p->strip[c]) != ESP_OK) {
            ESP_LOGE(TAG, "no se pudo inicializar la cadena %d", c);
            return -1;
        }
        led_strip_clear(p->strip[c]);
    }
    ESP_LOGI(TAG, "3 cadenas de %d LED inicializadas", DIANA_LEDS_PER_CHAIN);
    return 0;
#endif
}

int diana_pf_led_write(void *ctx, uint8_t chain, const diana_hal_rgb *px,
                       size_t count)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    if (chain >= DIANA_LED_CHAINS) return DIANA_HAL_ERR_INVALID;
    if (count > DIANA_LEDS_PER_CHAIN) count = DIANA_LEDS_PER_CHAIN;

    /* Se guarda el fotograma para poder estimar la corriente y para el
     * diagnostico de cadena; el volcado real ocurre en led_refresh. */
    memcpy(p->pixels[chain], px, count * sizeof(diana_hal_rgb));

#if DIANA_LED_ENABLED
    for (size_t i = 0; i < count; ++i) {
        if (led_strip_set_pixel(p->strip[chain], i, px[i].r, px[i].g, px[i].b)
            != ESP_OK)
            return DIANA_HAL_ERR_GENERIC;
    }
#endif
    return DIANA_HAL_OK;
}

int diana_platform_led_refresh(struct diana_platform *p)
{
#if DIANA_LED_ENABLED
    for (int c = 0; c < DIANA_LED_CHAINS; ++c) {
        if (led_strip_refresh(p->strip[c]) != ESP_OK) return DIANA_HAL_ERR_GENERIC;
    }
#else
    (void)p;
#endif
    return DIANA_HAL_OK;
}
