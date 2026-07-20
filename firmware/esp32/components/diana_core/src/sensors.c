#include "diana/sensors.h"

#include <stdio.h>
#include <string.h>

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
