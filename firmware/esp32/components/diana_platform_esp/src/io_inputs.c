/**
 * @file io_inputs.c
 * @brief Selector fisico y boton IDENTIFY del prototipo DO-only.
 */
#include "platform_internal.h"

#include "diana/sensors.h"

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

    return 0;
}

int diana_pf_selector_read(void *ctx, int *out)
{
    (void)ctx;
    int a = gpio_get_level(DIANA_PIN_SELECTOR_A);
    int b = gpio_get_level(DIANA_PIN_SELECTOR_B);

    diana_selector_position pos = DIANA_SELECTOR_SATELITE;
    int rc = diana_selector_decode(a, b, DIANA_SELECTOR_PROFILE, &pos);
    if (rc != DIANA_HAL_OK) {
        ESP_LOGE(TAG, "INVALID_SELECTOR GPIO15=%d GPIO16=%d", a, b);
        return rc;
    }
    *out = (int)pos;
    return DIANA_HAL_OK;
}

bool diana_pf_button_pressed(void *ctx)
{
    (void)ctx;
    return gpio_get_level(DIANA_PIN_BUTTON_ID) == 0;   /* activo a nivel bajo */
}
