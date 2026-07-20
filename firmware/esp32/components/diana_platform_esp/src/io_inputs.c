/**
 * @file io_inputs.c
 * @brief Selector de 3 posiciones y boton de identificacion. NO COMPILADO.
 *        Dosier 6.3.
 */
#include "platform_internal.h"

#include "driver/gpio.h"
#include "esp_log.h"

static const char *TAG = "diana.in";

int diana_pf_inputs_init(void)
{
    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << DIANA_PIN_SELECTOR_A) |
                        (1ULL << DIANA_PIN_SELECTOR_B) |
                        (1ULL << DIANA_PIN_BUTTON_ID),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,   /* contactos a masa */
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&cfg) != ESP_OK) return -1;

    gpio_config_t out = {
        .pin_bit_mask = (1ULL << DIANA_PIN_LED_STATUS) |
                        (1ULL << DIANA_PIN_LED_FAULT),
        .mode = GPIO_MODE_OUTPUT,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&out) != ESP_OK) return -2;
    return 0;
}

int diana_pf_selector_read(void *ctx, int *out)
{
    (void)ctx;
    int a = gpio_get_level(DIANA_PIN_SELECTOR_A);
    int b = gpio_get_level(DIANA_PIN_SELECTOR_B);

    if (a == 0 && b == 1) {
        *out = DIANA_SELECTOR_SATELITE;
    } else if (a == 1 && b == 0) {
        *out = DIANA_SELECTOR_PRINCIPAL;
    } else if (a == 1 && b == 1) {
        *out = DIANA_SELECTOR_AUTO;   /* posicion central */
    } else {
        /* a==0 && b==0 es imposible con un selector sano: cortocircuito o
         * cableado mal. Se degrada a SATELITE (el rol menos peligroso: no toma
         * autoridad de partida) y se avisa. */
        ESP_LOGE(TAG, "selector en estado imposible (A=0,B=0): se asume SATELITE");
        *out = DIANA_SELECTOR_SATELITE;
        return DIANA_HAL_ERR_GENERIC;
    }
    return DIANA_HAL_OK;
}

bool diana_pf_button_pressed(void *ctx)
{
    (void)ctx;
    return gpio_get_level(DIANA_PIN_BUTTON_ID) == 0;   /* activo a nivel bajo */
}
