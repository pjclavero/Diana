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
    /* Por defecto, coordinator=null. Solo el coordinador puede rellenarlo, y
     * solo sobre SU PROPIO impacto: diana_hit_event_attach_coordinator(). */
    ev->has_coordinator = false;
    ev->replay = false;
}

bool diana_hit_event_attach_coordinator(diana_hit_event *ev,
                                        diana_module_role own_role,
                                        const char *own_module_id,
                                        const diana_coordinator_time *t2)
{
    /* H-01: ningun modulo escribe en el topico de otro. Un coordinador que
     * quisiera "enriquecer" el hit de un satelite tendria que republicarlo bajo
     * module/{satelite}/hit, cosa que la ACL prohibe y que aqui se impide. */
    if (own_role != DIANA_ROLE_PRINCIPAL) return false;
    if (!own_module_id || strcmp(ev->module_id, own_module_id) != 0) return false;
    if (!t2) return false;

    ev->coordinator = *t2;
    ev->has_coordinator = true;
    return true;
}

void diana_hit_event_build(diana_hit_event *ev, const diana_hal *hal,
                           diana_identity *id, const diana_hit_group *group,
                           diana_target_state state_before, uint64_t now_us)
{
    fill_common(ev, hal, id, now_us, group->t_us);

    ev->target_index = group->target_index;
    /* ADR-0007: el perfil viene de la RUTA que detecto, no de una constante. */
    ev->detection_method = group->detection_method;
    ev->has_amplitude = group->has_amplitude;
    ev->amplitude = group->amplitude;
    ev->has_threshold = group->has_threshold;
    ev->threshold = group->threshold;
    ev->has_noise_floor = group->has_noise_floor;
    ev->noise_floor = group->noise_floor;
    if (ev->detection_method == DIANA_DETECT_DIGITAL_THRESHOLD) {
        /* En el perfil digital estas medidas NO EXISTEN. No se copian aunque
         * el grupo las traiga por un error aguas arriba: el evento no puede
         * nacer incoherente. Y no se sustituyen por 0: eso seria un dato
         * falso, no una ausencia. */
        ev->has_amplitude = false;
        ev->amplitude = 0;
        ev->has_threshold = false;
        ev->threshold = 0;
        ev->has_noise_floor = false;
        ev->noise_floor = 0;
    }
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
    ev->has_amplitude = group->has_amplitude;
    ev->amplitude = self->amplitude;
    ev->has_threshold = group->has_threshold;
    ev->threshold = group->threshold;
    ev->has_noise_floor = group->has_noise_floor;
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
    /* ADR-0007. Se comprueba AL FINAL y con codigo propio: un evento
     * incoherente con su perfil no es "invalido", es un productor que se
     * contradice, y el operador tiene que poder distinguir los dos casos. */
    if (!diana_hit_event_profile_coherent(ev))
        return DIANA_ERR_CONTRACT_PROFILE_MISMATCH;
    return DIANA_HAL_OK;
}

bool diana_hit_event_profile_coherent(const diana_hit_event *ev)
{
    if (!ev) return false;
    if (ev->detection_method == DIANA_DETECT_DIGITAL_THRESHOLD) {
        return !ev->has_amplitude && !ev->has_threshold && !ev->has_noise_floor;
    }
    if (ev->detection_method != DIANA_DETECT_ANALOG_ENVELOPE) return false;
    return ev->has_amplitude && ev->has_threshold;
}

size_t diana_hit_event_to_json(const diana_hit_event *ev, char *buf, size_t cap)
{
    /* ADR-0007: un payload incoherente con su perfil no llega a existir. */
    if (!diana_hit_event_profile_coherent(ev)) return 0;

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

    /* ADR-0007. El literal sale de diana_detection_method_str(), que el test
     * de conformidad compara contra el enum del esquema. Se omite en el perfil
     * analogico: la ausencia equivale a analog_envelope y asi los payloads v1
     * anteriores al ADR siguen siendo byte a byte los mismos. */
    if (ev->detection_method == DIANA_DETECT_DIGITAL_THRESHOLD) {
        diana_json_str(&j, "detection_method",
                       diana_detection_method_str(ev->detection_method));
    }

    if (ev->has_amplitude) diana_json_int(&j, "amplitude", ev->amplitude);
    if (ev->has_threshold) diana_json_int(&j, "threshold", ev->threshold);
    if (ev->has_noise_floor) diana_json_int(&j, "noise_floor", ev->noise_floor);

    if (ev->neighbour_count > 0) {
        diana_json_key(&j, "neighbours");
        diana_json_arr_open(&j);
        for (uint8_t i = 0; i < ev->neighbour_count; ++i) {
            diana_json_arr_obj_open(&j);
            diana_json_int(&j, "target_index", ev->neighbours[i].target_index);
            /* ADR-0007: en el perfil digital la amplitud del vecino esta
             * PROHIBIDA. Sin ADC no hay intensidad que comparar; solo tiempo. */
            if (ev->detection_method != DIANA_DETECT_DIGITAL_THRESHOLD) {
                diana_json_int(&j, "amplitude", ev->neighbours[i].amplitude);
            }
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
