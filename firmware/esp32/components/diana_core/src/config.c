#include "diana/config.h"

#include <string.h>

#include "diana/identity.h"
#include "diana/ids.h"

void diana_config_defaults(diana_config *cfg)
{
    memset(cfg, 0, sizeof(*cfg));
    cfg->config_version = 0;
    cfg->rotation = 0;
    cfg->led_brightness_max = DIANA_DEFAULT_BRIGHTNESS_MAX;
    cfg->telemetry_interval_ms = DIANA_DEFAULT_TELEMETRY_MS;
    cfg->network.mode = DIANA_NET_DHCP;

    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
        diana_target_calibration *c = &cfg->calibration[i];
        c->target_index = (uint8_t)(i + 1);
        c->threshold = DIANA_DEFAULT_THRESHOLD;
        c->hysteresis = DIANA_DEFAULT_HYSTERESIS;
        c->noise_floor = DIANA_DEFAULT_NOISE_FLOOR;
        c->blanking_us = DIANA_DEFAULT_BLANKING_US;
        c->group_window_us = DIANA_DEFAULT_GROUP_WINDOW_US;
        c->neighbour_ratio = DIANA_DEFAULT_NEIGHBOUR_RATIO;
        c->enabled = true;
        /* Sin calibrar: calibrated_at queda vacio a proposito. Un canal sin
         * calibrated_at NO debe considerarse validado. */
        c->has_calibrated_at = false;
        c->calibrated_at[0] = '\0';
    }
}

int diana_config_validate(const diana_config *cfg)
{
    if (cfg->system_id[0] && !diana_is_identifier(cfg->system_id))
        return DIANA_HAL_ERR_INVALID;
    if (cfg->has_position) {
        if (cfg->position_x < -1 || cfg->position_x > 1) return DIANA_HAL_ERR_INVALID;
        if (cfg->position_y < -1 || cfg->position_y > 1) return DIANA_HAL_ERR_INVALID;
    }
    if (cfg->rotation != 0 && cfg->rotation != 90 && cfg->rotation != 180 &&
        cfg->rotation != 270)
        return DIANA_HAL_ERR_INVALID;
    if (cfg->led_brightness_max < 1) return DIANA_HAL_ERR_INVALID;
    if (cfg->telemetry_interval_ms < 200 || cfg->telemetry_interval_ms > 60000)
        return DIANA_HAL_ERR_INVALID;

    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
        const diana_target_calibration *c = &cfg->calibration[i];
        if (c->target_index != (uint8_t)(i + 1)) return DIANA_HAL_ERR_INVALID;
        if (c->blanking_us > 500000) return DIANA_HAL_ERR_INVALID;
        if (c->group_window_us > 50000) return DIANA_HAL_ERR_INVALID;
        if (c->neighbour_ratio < 0.0f || c->neighbour_ratio > 1.0f)
            return DIANA_HAL_ERR_INVALID;
    }
    return DIANA_HAL_OK;
}

int diana_config_apply(diana_config *current, const diana_config *incoming)
{
    /* El contrato: "El modulo ignora una config con version menor a la
     * aplicada". Se rechaza tambien la igual para no reaplicar en bucle. */
    if (incoming->config_version <= current->config_version && current->config_version != 0)
        return DIANA_HAL_ERR_INVALID;
    int rc = diana_config_validate(incoming);
    if (rc != DIANA_HAL_OK) return rc;
    *current = *incoming;
    return DIANA_HAL_OK;
}

int diana_config_save(const diana_config *cfg, const diana_hal *hal)
{
    if (!hal || !hal->kv_set) return DIANA_HAL_ERR_GENERIC;
    return hal->kv_set(hal->ctx, DIANA_NVS_NS_CONFIG, "blob", cfg,
                       sizeof(*cfg));
}

int diana_config_load(diana_config *cfg, const diana_hal *hal)
{
    size_t len = 0;
    if (!hal || !hal->kv_get) return DIANA_HAL_ERR_GENERIC;
    int rc = hal->kv_get(hal->ctx, DIANA_NVS_NS_CONFIG, "blob", cfg,
                         sizeof(*cfg), &len);
    if (rc != DIANA_HAL_OK || len != sizeof(*cfg)) {
        diana_config_defaults(cfg);
        return DIANA_HAL_ERR_NOT_FOUND;
    }
    return DIANA_HAL_OK;
}

const diana_target_calibration *diana_config_cal(const diana_config *cfg,
                                                 uint8_t target_index)
{
    if (target_index < 1 || target_index > DIANA_TARGET_COUNT) return NULL;
    return &cfg->calibration[target_index - 1];
}
