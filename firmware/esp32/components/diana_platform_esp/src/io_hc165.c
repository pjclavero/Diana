/**
 * @file io_hc165.c
 * @brief Lectura DO-only de 9 sensores mediante 2 x SN74HC165.
 */
#include "platform_internal.h"

#include "diana/sensors.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/task.h"

static const char *TAG = "diana.hc165";

int diana_pf_hc165_init(struct diana_platform *p)
{
    p->trigger_queue = xQueueCreate(8, sizeof(diana_platform_trigger));
    if (!p->trigger_queue) return -1;

    gpio_config_t data = {
        .pin_bit_mask = (1ULL << DIANA_PIN_HC165_DATA),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&data) != ESP_OK) return -2;

    gpio_config_t ctrl = {
        .pin_bit_mask = (1ULL << DIANA_PIN_HC165_LOAD) |
                        (1ULL << DIANA_PIN_HC165_CLK),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&ctrl) != ESP_OK) return -3;

    gpio_set_level(DIANA_PIN_HC165_LOAD, 1);
    gpio_set_level(DIANA_PIN_HC165_CLK, 0);
    p->hc165_last_raw = 0xffffu;
    ESP_LOGI(TAG, "HC165 DO-only inicializado: DATA=%d LOAD=%d CLK=%d",
             DIANA_PIN_HC165_DATA, DIANA_PIN_HC165_LOAD, DIANA_PIN_HC165_CLK);
    return 0;
}

int diana_platform_hc165_read_raw(diana_platform *p, uint16_t *out_raw)
{
    (void)p;
    uint16_t raw = 0;

    gpio_set_level(DIANA_PIN_HC165_CLK, 0);
    gpio_set_level(DIANA_PIN_HC165_LOAD, 0);
    esp_rom_delay_us(2);
    gpio_set_level(DIANA_PIN_HC165_LOAD, 1);
    esp_rom_delay_us(2);

    for (uint8_t i = 0; i < DIANA_HC165_BITS; ++i) {
        raw = (uint16_t)((raw << 1) | (uint16_t)gpio_get_level(DIANA_PIN_HC165_DATA));
        gpio_set_level(DIANA_PIN_HC165_CLK, 1);
        esp_rom_delay_us(1);
        gpio_set_level(DIANA_PIN_HC165_CLK, 0);
        esp_rom_delay_us(1);
    }

    *out_raw = raw;
    return DIANA_HAL_OK;
}

bool diana_platform_trigger_pop(diana_platform *p, diana_platform_trigger *out,
                                uint32_t timeout_ms)
{
    if (!p || !out) return false;

    if (timeout_ms > 0) vTaskDelay(pdMS_TO_TICKS(timeout_ms));

    uint16_t raw = 0;
    if (diana_platform_hc165_read_raw(p, &raw) != DIANA_HAL_OK) return false;

    uint16_t active = diana_do_active_bitmap(raw, DIANA_DO_POLARITY);
    bool changed = raw != p->hc165_last_raw;
    p->hc165_last_raw = raw;
    if (!changed && active == 0u) return false;

    out->raw_bitmap = raw;
    out->t_us = (uint64_t)esp_timer_get_time();
    return true;
}
