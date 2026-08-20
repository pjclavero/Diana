#include "diana/sensors.h"

#include <stdio.h>
#include <string.h>

#define DIANA_DO_MASK 0x01ffu

void diana_sensor_state_init(diana_sensor_state *st)
{
    memset(st, 0, sizeof(*st));
}

bool diana_sensor_admit(diana_sensor_state *st, const diana_config *cfg,
                        const diana_piezo_trigger *trig, const char **why)
{
    static const char *w_range = "indice de diana fuera de rango";
    static const char *w_disabled = "canal deshabilitado por configuracion";
    static const char *w_blank = "canal en blanking tras impacto valido";
    static const char *w_debounce = "rebote dentro de la ventana de agrupacion";

    if (why) *why = NULL;
    const diana_target_calibration *c = diana_config_cal(cfg, trig->target_index);
    if (!c) {
        if (why) *why = w_range;
        return false;
    }
    if (!c->enabled) {
        if (why) *why = w_disabled;
        return false;
    }

    /* NO se filtra por umbral aqui: un disparo de baja amplitud debe entrar en
     * el grupo para poder auditarse como vecino y emitirse como
     * crosstalk_rejected. El umbral se aplica al canal PRINCIPAL en
     * diana_sensor_classify(). */

    uint8_t i = (uint8_t)(trig->target_index - 1);
    if (trig->t_us < st->blanking_until_us[i]) {
        st->suppressed_blanking[i]++;
        if (why) *why = w_blank;
        return false;
    }
    if (st->last_trigger_us[i] != 0 &&
        trig->t_us - st->last_trigger_us[i] < c->group_window_us) {
        st->suppressed_debounce[i]++;
        if (why) *why = w_debounce;
        return false;
    }

    st->last_trigger_us[i] = trig->t_us;
    return true;
}

void diana_sensor_mark_hit(diana_sensor_state *st, const diana_config *cfg,
                           uint8_t target_index, uint64_t now_us)
{
    const diana_target_calibration *c = diana_config_cal(cfg, target_index);
    if (!c) return;
    st->blanking_until_us[target_index - 1] = now_us + c->blanking_us;
}

void diana_sensor_classify(const diana_config *cfg,
                           const diana_piezo_trigger *trigs, uint8_t count,
                           diana_hit_group *out)
{
    memset(out, 0, sizeof(*out));
    if (count == 0) {
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason), "grupo vacio");
        return;
    }

    /* 1. Canal principal: mayor amplitud, desempate por el mas temprano. */
    uint8_t best = 0;
    for (uint8_t i = 1; i < count; ++i) {
        if (trigs[i].amplitude > trigs[best].amplitude ||
            (trigs[i].amplitude == trigs[best].amplitude &&
             trigs[i].t_us < trigs[best].t_us)) {
            best = i;
        }
    }

    const diana_piezo_trigger *main_t = &trigs[best];
    const diana_target_calibration *cal = diana_config_cal(cfg, main_t->target_index);
    if (!cal) {
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "canal principal %u sin calibracion", (unsigned)main_t->target_index);
        return;
    }

    out->target_index = main_t->target_index;
    out->t_us = main_t->t_us;
    out->amplitude = main_t->amplitude;
    out->threshold = cal->threshold;
    out->noise_floor = cal->noise_floor;
    out->has_amplitude = true;
    out->has_threshold = true;
    out->has_noise_floor = true;

    /* Umbral: solo el canal principal debe superarlo. Si no, todo el grupo es
     * ruido y no se emite impacto. */
    if ((uint32_t)main_t->amplitude < (uint32_t)cal->threshold + cal->hysteresis) {
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "amplitud %u por debajo de umbral %u + histeresis %u",
                 (unsigned)main_t->amplitude, (unsigned)cal->threshold,
                 (unsigned)cal->hysteresis);
        return;
    }

    /* 2. Vecinos dentro de la ventana de agrupacion. */
    bool ambiguous = false;
    uint8_t ambiguous_idx = 0;
    float ambiguous_ratio = 0.0f;

    for (uint8_t i = 0; i < count; ++i) {
        if (i == best) continue;
        const diana_piezo_trigger *n = &trigs[i];

        int64_t delta = (int64_t)n->t_us - (int64_t)main_t->t_us;
        int64_t abs_delta = delta < 0 ? -delta : delta;
        if ((uint64_t)abs_delta > cal->group_window_us) continue; /* fuera del grupo */

        if (out->neighbour_count < DIANA_MAX_NEIGHBOURS) {
            diana_neighbour *nb = &out->neighbours[out->neighbour_count++];
            nb->target_index = n->target_index;
            nb->amplitude = n->amplitude;
            nb->delta_us = (int32_t)delta;
        }

        float ratio = (main_t->amplitude > 0)
                          ? (float)n->amplitude / (float)main_t->amplitude
                          : 1.0f;

        if (ratio < cal->neighbour_ratio) {
            /* Vibracion cruzada: se descarta el vecino, con motivo auditable. */
            if (out->rejected_count < DIANA_MAX_NEIGHBOURS) {
                uint8_t k = out->rejected_count++;
                out->rejected_index[k] = n->target_index;
                snprintf(out->rejected_reason[k], DIANA_REASON_MAXLEN,
                         "amplitud %.2fx del canal %u dentro de ventana %uus",
                         (double)ratio, (unsigned)main_t->target_index,
                         (unsigned)cal->group_window_us);
            }
        } else {
            /* Por encima del ratio no se puede decidir: dos impactos reales y
             * una transmision mecanica fuerte son indistinguibles. */
            ambiguous = true;
            ambiguous_idx = n->target_index;
            ambiguous_ratio = ratio;
        }
    }

    if (ambiguous) {
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "canal %u a %.2fx del principal %u: por encima del ratio %.2f",
                 (unsigned)ambiguous_idx, (double)ambiguous_ratio,
                 (unsigned)main_t->target_index, (double)cal->neighbour_ratio);
        return;
    }

    out->accepted = true;
    out->classification = DIANA_HIT_VALID;
    out->reason[0] = '\0';
}

void diana_sensor_diag_reset(diana_sensor_state *st)
{
    if (!st) return;
    memset(&st->diag, 0, sizeof(st->diag));
}

uint16_t diana_do_active_bitmap(uint16_t raw_bitmap, diana_do_polarity polarity)
{
    uint16_t v = raw_bitmap & DIANA_DO_MASK;
    if (polarity == DIANA_DO_ACTIVE_LOW) v = (uint16_t)(~v);
    return (uint16_t)(v & DIANA_DO_MASK);
}

void diana_do_decode(uint16_t raw_bitmap, diana_do_polarity polarity,
                     diana_do_snapshot *out)
{
    memset(out, 0, sizeof(*out));
    out->raw_bitmap = raw_bitmap;
    out->active_bitmap = diana_do_active_bitmap(raw_bitmap, polarity);
    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
        if ((out->active_bitmap & (uint16_t)(1u << i)) != 0u) {
            out->active_channels[out->active_count++] = (uint8_t)(i + 1u);
        }
    }
}

static void do_empty_group(diana_hit_group *out, uint16_t raw, uint16_t active)
{
    memset(out, 0, sizeof(*out));
    out->raw_bitmap = raw;
    out->active_bitmap = active;
    out->classification = DIANA_HIT_AMBIGUOUS;
}

void diana_do_process_snapshot(diana_sensor_state *st, const diana_config *cfg,
                               uint16_t raw_bitmap, diana_do_polarity polarity,
                               uint64_t now_us, diana_hit_group *out)
{
    diana_do_snapshot snap;
    diana_do_decode(raw_bitmap, polarity, &snap);
    do_empty_group(out, snap.raw_bitmap, snap.active_bitmap);
    out->active_count = snap.active_count;

    /* Contadores de calibracion: se actualizan SIEMPRE, tambien cuando no hay
     * impacto. capture_count es el denominador. */
    st->diag.capture_count++;
    st->diag.last_active_bitmap = snap.active_bitmap;

    if (snap.active_count == 0u) {
        st->do_last_active_bitmap = 0;
        snprintf(out->reason, sizeof(out->reason), "ningun DO activo");
        return;
    }

    if (snap.active_count > 1u) {
        st->diag.multi_trigger_count++;
        st->diag.last_multi_trigger_us = now_us;
        st->do_last_active_bitmap = snap.active_bitmap;
        int n = snprintf(out->reason, sizeof(out->reason),
                         "MULTI_TRIGGER bitmap=0x%03x canales=",
                         (unsigned)snap.active_bitmap);
        size_t used = n > 0 ? (size_t)n : 0u;
        for (uint8_t k = 0; k < snap.active_count && used < sizeof(out->reason); ++k) {
            n = snprintf(out->reason + used, sizeof(out->reason) - used,
                         "%sD%u", k == 0u ? "" : ",",
                         (unsigned)snap.active_channels[k]);
            if (n <= 0) break;
            used += (size_t)n;
        }
        return;
    }

    uint8_t target = snap.active_channels[0];
    uint8_t i = (uint8_t)(target - 1u);
    uint16_t bit = (uint16_t)(1u << i);
    const diana_target_calibration *cal = diana_config_cal(cfg, target);

    out->target_index = target;
    out->t_us = now_us;
    out->classification = DIANA_HIT_VALID;

    if (!cal) {
        out->target_index = 0;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "canal DO %u fuera de rango", (unsigned)target);
        st->do_last_active_bitmap = snap.active_bitmap;
        return;
    }
    if (!cal->enabled) {
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "canal DO %u deshabilitado", (unsigned)target);
        st->do_last_active_bitmap = snap.active_bitmap;
        return;
    }
    if ((st->do_last_active_bitmap & bit) != 0u) {
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "DO%u sigue activo: sin nueva transicion", (unsigned)target);
        st->do_last_active_bitmap = snap.active_bitmap;
        return;
    }
    if (st->last_trigger_us[i] != 0u &&
        now_us - st->last_trigger_us[i] < cal->group_window_us) {
        st->suppressed_debounce[i]++;
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "rebote DO%u dentro de %uus PENDING_PHYSICAL_TUNING",
                 (unsigned)target, (unsigned)cal->group_window_us);
        st->do_last_active_bitmap = snap.active_bitmap;
        return;
    }
    if (now_us < st->blanking_until_us[i]) {
        st->suppressed_blanking[i]++;
        out->accepted = false;
        out->classification = DIANA_HIT_AMBIGUOUS;
        snprintf(out->reason, sizeof(out->reason),
                 "refractory DO%u hasta %llu PENDING_PHYSICAL_TUNING",
                 (unsigned)target, (unsigned long long)st->blanking_until_us[i]);
        st->do_last_active_bitmap = snap.active_bitmap;
        return;
    }

    st->last_trigger_us[i] = now_us;
    st->blanking_until_us[i] = now_us + cal->blanking_us;
    st->do_last_active_bitmap = snap.active_bitmap;
    st->diag.trigger_count[i]++;
    st->diag.last_target = target;
    st->diag.last_trigger_us = now_us;

    out->accepted = true;
    out->reason[0] = '\0';
}

int diana_selector_decode(int gpio15_level, int gpio16_level,
                          diana_selector_profile profile,
                          diana_selector_position *out)
{
    if (!out) return DIANA_HAL_ERR_INVALID;

    if (gpio15_level == 0 && gpio16_level == 1) {
        *out = DIANA_SELECTOR_PRINCIPAL;
        return DIANA_HAL_OK;
    }
    if (gpio15_level == 1 && gpio16_level == 0) {
        *out = DIANA_SELECTOR_SATELITE;
        return DIANA_HAL_OK;
    }
    if (gpio15_level == 1 && gpio16_level == 1 &&
        profile == DIANA_SELECTOR_3_POSITION) {
        *out = DIANA_SELECTOR_AUTO;
        return DIANA_HAL_OK;
    }

    return DIANA_HAL_ERR_INVALID;
}
