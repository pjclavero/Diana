#include "diana/event.h"

#include <string.h>

#include "diana/ids.h"
#include "diana/json.h"

static void copyz(char *dst, size_t cap, const char *src)
{
    if (!src) { dst[0] = '\0'; return; }
    size_t n = strlen(src);
    if (n >= cap) n = cap - 1;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

static void fill_common(diana_hit_event *ev, const diana_hal *hal,
                        diana_identity *id, uint64_t now_us, uint64_t event_us)
{
    memset(ev, 0, sizeof(*ev));
    diana_uuid4(hal, ev->event_id);
    copyz(ev->system_id, sizeof(ev->system_id), id->system_id);
    copyz(ev->module_id, sizeof(ev->module_id), id->module_id);
    copyz(ev->firmware_version, sizeof(ev->firmware_version), id->firmware_version);
    ev->local_sequence = diana_identity_next_sequence(id, hal);

    copyz(ev->device.boot_id, sizeof(ev->device.boot_id), id->boot_id);
    ev->device.uptime_us = now_us;
    ev->device.event_us = event_us;

    if (hal && hal->epoch_ms) {
        uint64_t e = hal->epoch_ms(hal->ctx);
        if (e > 0) {
            ev->device.has_epoch_ms = true;
            ev->device.epoch_ms = e;
        }
    }
    /* Un satelite publica coordinator=null: T2 no es suyo (ADR-0002). */
    ev->has_coordinator = false;
    ev->replay = false;
}

void diana_hit_event_build(diana_hit_event *ev, const diana_hal *hal,
                           diana_identity *id, const diana_hit_group *group,
                           diana_target_state state_before, uint64_t now_us)
{
    fill_common(ev, hal, id, now_us, group->t_us);

    ev->target_index = group->target_index;
    ev->amplitude = group->amplitude;
    ev->threshold = group->threshold;
    ev->has_noise_floor = true;
    ev->noise_floor = group->noise_floor;
    ev->target_state_before = state_before;
    ev->classification = group->classification;
    copyz(ev->classification_reason, sizeof(ev->classification_reason),
          group->reason);

    ev->neighbour_count = group->neighbour_count;
    for (uint8_t i = 0; i < group->neighbour_count && i < DIANA_MAX_NEIGHBOURS; ++i)
        ev->neighbours[i] = group->neighbours[i];
}

bool diana_hit_event_build_rejected(diana_hit_event *ev, const diana_hal *hal,
                                    diana_identity *id,
                                    const diana_hit_group *group, uint8_t nth,
                                    diana_target_state state_before,
                                    uint64_t now_us)
{
    if (nth >= group->rejected_count) return false;

    uint8_t idx = group->rejected_index[nth];

    /* Localiza el vecino correspondiente para copiar amplitud y delta. */
    const diana_neighbour *self = NULL;
    for (uint8_t i = 0; i < group->neighbour_count; ++i) {
        if (group->neighbours[i].target_index == idx) {
            self = &group->neighbours[i];
            break;
        }
    }
    if (!self) return false;

    uint64_t event_us = (self->delta_us >= 0)
                            ? group->t_us + (uint64_t)self->delta_us
                            : group->t_us - (uint64_t)(-self->delta_us);

    fill_common(ev, hal, id, now_us, event_us);

    ev->target_index = idx;
    ev->amplitude = self->amplitude;
    ev->threshold = group->threshold;
    ev->has_noise_floor = true;
    ev->noise_floor = group->noise_floor;
    ev->target_state_before = state_before;
    ev->classification = DIANA_HIT_CROSSTALK_REJECTED;
    copyz(ev->classification_reason, sizeof(ev->classification_reason),
          group->rejected_reason[nth]);

    /* El vecino auditable es el canal principal, con el delta invertido. */
    ev->neighbour_count = 1;
    ev->neighbours[0].target_index = group->target_index;
    ev->neighbours[0].amplitude = group->amplitude;
    ev->neighbours[0].delta_us = -self->delta_us;
    return true;
}

int diana_hit_event_check(const diana_hit_event *ev)
{
    if (!diana_is_event_id(ev->event_id)) return DIANA_HAL_ERR_INVALID;
    if (!diana_is_identifier(ev->system_id)) return DIANA_HAL_ERR_INVALID;
    if (!diana_is_identifier(ev->module_id)) return DIANA_HAL_ERR_INVALID;
    if (ev->target_index < 1 || ev->target_index > DIANA_TARGET_COUNT)
        return DIANA_HAL_ERR_INVALID;
    if (!diana_is_uuid(ev->device.boot_id)) return DIANA_HAL_ERR_INVALID;
    if (!diana_is_semver(ev->firmware_version)) return DIANA_HAL_ERR_INVALID;
    if (ev->has_game && !diana_is_uuid(ev->game_id)) return DIANA_HAL_ERR_INVALID;
    if (ev->has_round && !diana_is_uuid(ev->round_id)) return DIANA_HAL_ERR_INVALID;
    if (ev->neighbour_count > DIANA_MAX_NEIGHBOURS) return DIANA_HAL_ERR_INVALID;
    /* El esquema exige classification_reason si no es valid_hit. */
    if (ev->classification != DIANA_HIT_VALID && ev->classification_reason[0] == '\0')
        return DIANA_HAL_ERR_INVALID;
    if (ev->has_position) {
        if (ev->position_x < -1 || ev->position_x > 1) return DIANA_HAL_ERR_INVALID;
        if (ev->position_y < -1 || ev->position_y > 1) return DIANA_HAL_ERR_INVALID;
    }
    return DIANA_HAL_OK;
}

size_t diana_hit_event_to_json(const diana_hit_event *ev, char *buf, size_t cap)
{
    diana_json j;
    diana_json_init(&j, buf, cap);

    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "event_id", ev->event_id);
    diana_json_str(&j, "system_id", ev->system_id);
    diana_json_str(&j, "module_id", ev->module_id);
    if (ev->has_game) diana_json_str(&j, "game_id", ev->game_id);
    if (ev->has_round) diana_json_str(&j, "round_id", ev->round_id);
    diana_json_int(&j, "target_index", ev->target_index);

    if (ev->has_position) {
        diana_json_key(&j, "module_position");
        diana_json_obj_open(&j);
        diana_json_int(&j, "x", ev->position_x);
        diana_json_int(&j, "y", ev->position_y);
        diana_json_obj_close(&j);
    }
    if (ev->has_rotation) diana_json_int(&j, "module_rotation", ev->rotation);

    diana_json_uint(&j, "local_sequence", ev->local_sequence);

    diana_json_key(&j, "device");
    diana_json_obj_open(&j);
    diana_json_str(&j, "boot_id", ev->device.boot_id);
    diana_json_uint(&j, "uptime_us", ev->device.uptime_us);
    diana_json_uint(&j, "event_us", ev->device.event_us);
    if (ev->device.has_epoch_ms) diana_json_uint(&j, "epoch_ms", ev->device.epoch_ms);
    diana_json_obj_close(&j);

    if (ev->has_coordinator) {
        diana_json_key(&j, "coordinator");
        diana_json_obj_open(&j);
        diana_json_uint(&j, "recv_us", ev->coordinator.recv_us);
        diana_json_uint(&j, "elapsed_us", ev->coordinator.elapsed_us);
        diana_json_int(&j, "clock_offset_us", ev->coordinator.clock_offset_us);
        if (ev->coordinator.has_uncertainty)
            diana_json_uint(&j, "offset_uncertainty_us",
                            ev->coordinator.offset_uncertainty_us);
        diana_json_obj_close(&j);
    } else {
        diana_json_null(&j, "coordinator");
    }

    diana_json_int(&j, "amplitude", ev->amplitude);
    diana_json_int(&j, "threshold", ev->threshold);
    if (ev->has_noise_floor) diana_json_int(&j, "noise_floor", ev->noise_floor);

    if (ev->neighbour_count > 0) {
        diana_json_key(&j, "neighbours");
        diana_json_arr_open(&j);
        for (uint8_t i = 0; i < ev->neighbour_count; ++i) {
            diana_json_arr_obj_open(&j);
            diana_json_int(&j, "target_index", ev->neighbours[i].target_index);
            diana_json_int(&j, "amplitude", ev->neighbours[i].amplitude);
            diana_json_int(&j, "delta_us", ev->neighbours[i].delta_us);
            diana_json_obj_close(&j);
        }
        diana_json_arr_close(&j);
    }

    diana_json_str(&j, "target_state_before",
                   diana_target_state_str(ev->target_state_before));
    diana_json_str(&j, "classification",
                   diana_hit_classification_str(ev->classification));
    if (ev->classification_reason[0])
        diana_json_str(&j, "classification_reason", ev->classification_reason);
    diana_json_str(&j, "firmware_version", ev->firmware_version);
    diana_json_bool(&j, "replay", ev->replay);
    diana_json_obj_close(&j);

    if (!diana_json_ok(&j)) return 0;
    return diana_json_len(&j);
}
