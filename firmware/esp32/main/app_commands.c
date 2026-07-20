/**
 * @file app_commands.c
 * @brief Recepcion y ejecucion de comandos, config y OTA. NO COMPILADO.
 *
 * TODA orden pasa antes por diana_command_validate(): caducidad, command_id
 * repetido y nonce no monotonico (contrato §6). Esa logica esta probada en host
 * (test_command.c); aqui solo se conecta al parser JSON y a las acciones.
 */
#include "app.h"

#include <string.h>

#include "cJSON.h"
#include "esp_log.h"

static const char *TAG = "diana.cmd";

static void remember_verdict(diana_app *a, const char *command_id,
                             diana_command_verdict v)
{
    a->has_last_command = true;
    snprintf(a->last_command_id, sizeof(a->last_command_id), "%s", command_id);
    a->last_command_result = v.result;
    snprintf(a->last_command_detail, sizeof(a->last_command_detail), "%s", v.detail);
    diana_publish_status(a);
}

static bool parse_envelope(const cJSON *root, diana_command *out)
{
    memset(out, 0, sizeof(*out));

    const cJSON *sv = cJSON_GetObjectItemCaseSensitive(root, "schema_version");
    const cJSON *ci = cJSON_GetObjectItemCaseSensitive(root, "command_id");
    const cJSON *ia = cJSON_GetObjectItemCaseSensitive(root, "issued_at_ms");
    const cJSON *ex = cJSON_GetObjectItemCaseSensitive(root, "expires_in_ms");
    const cJSON *no = cJSON_GetObjectItemCaseSensitive(root, "nonce");
    const cJSON *is = cJSON_GetObjectItemCaseSensitive(root, "issuer");
    const cJSON *mi = cJSON_GetObjectItemCaseSensitive(root, "module_id");
    const cJSON *ac = cJSON_GetObjectItemCaseSensitive(root, "action");

    if (!cJSON_IsNumber(sv) || !cJSON_IsString(ci) || !cJSON_IsNumber(ia) ||
        !cJSON_IsNumber(ex) || !cJSON_IsNumber(no) || !cJSON_IsString(is) ||
        !cJSON_IsString(mi) || !cJSON_IsString(ac))
        return false;

    out->schema_version = (uint32_t)sv->valuedouble;
    snprintf(out->command_id, sizeof(out->command_id), "%s", ci->valuestring);
    out->issued_at_ms = (uint64_t)ia->valuedouble;
    out->expires_in_ms = (uint32_t)ex->valuedouble;
    out->nonce = (uint64_t)no->valuedouble;
    snprintf(out->module_id, sizeof(out->module_id), "%s", mi->valuestring);

    if (diana_issuer_parse(is->valuestring, &out->issuer) != 0) return false;
    if (diana_command_action_parse(ac->valuestring, &out->action) != 0) return false;

    /* Presencia de params, para que el core valide lo obligatorio de cada
     * accion (H-07). El core no parsea JSON: se le entregan los indicadores. */
    const cJSON *pr = cJSON_GetObjectItemCaseSensitive(root, "params");
    if (cJSON_IsObject(pr)) {
        out->has_params = true;
        const cJSON *tg = cJSON_GetObjectItemCaseSensitive(pr, "targets");
        if (cJSON_IsArray(tg)) {
            out->param_targets = true;
            int n = cJSON_GetArraySize(tg);
            out->param_targets_count = (uint8_t)(n < 0 ? 0 : (n > 255 ? 255 : n));
        }
        out->param_state = cJSON_IsString(
            cJSON_GetObjectItemCaseSensitive(pr, "state"));
        out->param_duration_ms = cJSON_IsNumber(
            cJSON_GetObjectItemCaseSensitive(pr, "duration_ms"));
        out->param_enabled = cJSON_IsBool(
            cJSON_GetObjectItemCaseSensitive(pr, "enabled"));
    }
    return true;
}

/** Reloj para la caducidad: monotónico + hora de pared si la hay (H-05). */
static diana_command_clock clock_now(diana_app *a, uint64_t recv_us)
{
    diana_command_clock c;
    c.recv_us = recv_us;
    c.now_us = a->hal.now_us(a->hal.ctx);
    /* 0 si el modulo no ha sincronizado hora: el core lo trata explicitamente
     * y lo dice en el veredicto, en vez de fingir la comprobacion. */
    c.epoch_ms = a->hal.epoch_ms ? a->hal.epoch_ms(a->hal.ctx) : 0;
    return c;
}

static void apply_set_targets(diana_app *a, const cJSON *params)
{
    const cJSON *arr = cJSON_GetObjectItemCaseSensitive(params, "targets");
    if (!cJSON_IsArray(arr)) return;

    uint64_t now = a->hal.now_us(a->hal.ctx);
    const cJSON *item = NULL;
    cJSON_ArrayForEach(item, arr) {
        const cJSON *ti = cJSON_GetObjectItemCaseSensitive(item, "target_index");
        const cJSON *st = cJSON_GetObjectItemCaseSensitive(item, "state");
        if (!cJSON_IsNumber(ti) || !cJSON_IsString(st)) continue;

        diana_target_state want;
        if (diana_target_state_parse(st->valuestring, &want) != 0) continue;

        diana_target *tg = diana_target_at(&a->targets, (uint8_t)ti->valueint);
        if (!tg) continue;

        /* Se traduce el estado deseado a un EVENTO de la maquina de estados: no
         * se asigna el estado a pelo. Asi una transicion imposible se rechaza
         * en vez de dejar la diana en un estado incoherente. */
        diana_target_event ev;
        switch (want) {
        case DIANA_TARGET_ACTIVE:      ev = DIANA_TEV_ARM; break;
        case DIANA_TARGET_SAFE:        ev = DIANA_TEV_DISARM; break;
        case DIANA_TARGET_COUNTDOWN:   ev = DIANA_TEV_COUNTDOWN; break;
        case DIANA_TARGET_LOCKED:      ev = DIANA_TEV_LOCK; break;
        case DIANA_TARGET_OFF:         ev = DIANA_TEV_DISABLE; break;
        case DIANA_TARGET_DISABLED:    ev = DIANA_TEV_ADMIN_DISABLE; break;
        case DIANA_TARGET_MAINTENANCE: ev = DIANA_TEV_MAINTENANCE_ON; break;
        default:                       continue;
        }
        if (!diana_target_apply(tg, ev, now)) {
            ESP_LOGW(TAG, "transicion %s->%s rechazada en la diana %d",
                     diana_target_state_str(tg->state),
                     diana_target_state_str(want), (int)ti->valueint);
        }
    }
}

static void execute(diana_app *a, const diana_command *cmd, const cJSON *root)
{
    const cJSON *params = cJSON_GetObjectItemCaseSensitive(root, "params");
    uint64_t now = a->hal.now_us(a->hal.ctx);

    switch (cmd->action) {
    case DIANA_CMD_IDENTIFY: {
        uint32_t ms = 4000;
        const cJSON *d = params ? cJSON_GetObjectItemCaseSensitive(params,
                                                                  "duration_ms")
                                : NULL;
        if (cJSON_IsNumber(d)) ms = (uint32_t)d->valuedouble;
        a->identify_active = true;
        a->identify_until_us = now + (uint64_t)ms * 1000ULL;
        break;
    }
    case DIANA_CMD_SET_TARGETS:
        if (params) apply_set_targets(a, params);
        break;

    case DIANA_CMD_SET_ALL_TARGETS: {
        const cJSON *st = params ? cJSON_GetObjectItemCaseSensitive(params, "state")
                                 : NULL;
        diana_target_state want;
        if (cJSON_IsString(st) &&
            diana_target_state_parse(st->valuestring, &want) == 0) {
            for (uint8_t i = 1; i <= DIANA_TARGET_COUNT; ++i) {
                diana_target *tg = diana_target_at(&a->targets, i);
                diana_target_event ev = (want == DIANA_TARGET_ACTIVE)
                                            ? DIANA_TEV_ARM
                                            : DIANA_TEV_DISARM;
                diana_target_apply(tg, ev, now);
            }
        }
        break;
    }
    case DIANA_CMD_REBOOT:
        diana_publish_presence(a, DIANA_PRESENCE_SHUTDOWN);
        a->hal.reboot(a->hal.ctx);
        break;

    case DIANA_CMD_START_CALIBRATION:
        diana_module_fsm_apply(&a->fsm, DIANA_EV_CALIBRATION_START, now);
        break;
    case DIANA_CMD_ABORT_CALIBRATION:
        diana_module_fsm_apply(&a->fsm, DIANA_EV_CALIBRATION_END, now);
        break;
    case DIANA_CMD_SET_MAINTENANCE: {
        const cJSON *en = params ? cJSON_GetObjectItemCaseSensitive(params,
                                                                   "enabled")
                                 : NULL;
        bool on = cJSON_IsBool(en) ? cJSON_IsTrue(en) : true;
        diana_module_fsm_apply(&a->fsm,
                               on ? DIANA_EV_MAINTENANCE_ON : DIANA_EV_MAINTENANCE_OFF,
                               now);
        break;
    }
    case DIANA_CMD_CLEAR_ERROR:
        diana_module_fsm_apply(&a->fsm, DIANA_EV_ERROR_CLEARED, now);
        break;

    case DIANA_CMD_FLUSH_QUEUE:
        diana_queue_flush(&a->queue, a->topic_hit, 64);
        break;

    case DIANA_CMD_SELF_TEST:
        diana_publish_diagnostic(a, DIANA_DIAG_SELF_TEST_RESULT, DIANA_SEV_INFO,
                                 "autodiagnostico solicitado por comando");
        break;
    case DIANA_CMD_LED_TEST:
        a->identify_active = true;
        a->identify_until_us = now + 5000000ULL;
        break;
    default:
        break;
    }
    diana_publish_status(a);
}

static void handle_ota(diana_app *a, const cJSON *root, uint64_t recv_us)
{
    diana_command cmd;
    if (!parse_envelope(root, &cmd)) {
        /* La orden OTA usa el mismo sobre; 'action' es otro enum. */
        const cJSON *ac = cJSON_GetObjectItemCaseSensitive(root, "action");
        (void)ac;
    }
    /* La validacion de sobre (caducidad/nonce/duplicado) se aplica igual. */
    diana_command_clock clk = clock_now(a, recv_us);
    diana_command_verdict v =
        diana_command_validate(&a->guard, &cmd, a->id.module_id, &clk);
    if (v.result != DIANA_CMD_RESULT_ACCEPTED) {
        remember_verdict(a, cmd.command_id, v);
        return;
    }

    /* La descarga real de la imagen y la llamada a diana_ota_apply() quedan
     * PENDIENTES de implementar contra esp_https_ota: no se ha podido probar
     * sin hardware ni servidor de firmware. La prohibicion durante partida ya
     * la garantiza diana_ota_apply(), que es lo que se ha probado en host. */
    if (diana_module_fsm_game_in_progress(&a->fsm)) {
        diana_publish_diagnostic(a, DIANA_DIAG_OTA_RESULT, DIANA_SEV_WARNING,
                                 "OTA rechazada: partida en curso");
        return;
    }
    ESP_LOGW(TAG, "orden OTA aceptada; descarga pendiente de implementar");
}

void diana_handle_message(diana_app *a, const diana_platform_rx *rx)
{
    cJSON *root = cJSON_ParseWithLength(rx->payload, rx->payload_len);
    if (!root) {
        diana_publish_diagnostic(a, DIANA_DIAG_SCHEMA_REJECTED, DIANA_SEV_WARNING,
                                 "payload no es JSON valido");
        return;
    }

    if (strstr(rx->topic, "/ota")) {
        handle_ota(a, root, rx->recv_us);
        cJSON_Delete(root);
        return;
    }

    if (strstr(rx->topic, "/config/desired")) {
        /* La config no lleva sobre de comando: se protege con config_version
         * monotonica, como manda el contrato. */
        const cJSON *cv = cJSON_GetObjectItemCaseSensitive(root, "config_version");
        if (cJSON_IsNumber(cv) && (uint32_t)cv->valuedouble > a->cfg.config_version) {
            a->cfg.config_version = (uint32_t)cv->valuedouble;
            /* El resto de campos se aplicarian aqui; pendiente de completar. */
            diana_config_save(&a->cfg, &a->hal);
            diana_publish_config_reported(a);
        }
        cJSON_Delete(root);
        return;
    }

    if (strstr(rx->topic, "/command")) {
        diana_command cmd;
        if (!parse_envelope(root, &cmd)) {
            diana_publish_diagnostic(a, DIANA_DIAG_SCHEMA_REJECTED,
                                     DIANA_SEV_WARNING,
                                     "comando con sobre incompleto");
            cJSON_Delete(root);
            return;
        }
        diana_command_clock clk = clock_now(a, rx->recv_us);
        diana_command_verdict v =
            diana_command_validate(&a->guard, &cmd, a->id.module_id, &clk);

        if (v.result == DIANA_CMD_RESULT_ACCEPTED) {
            execute(a, &cmd, root);
        } else {
            char msg[DIANA_MESSAGE_MAXLEN];
            snprintf(msg, sizeof(msg), "comando %s rechazado: %s",
                     diana_command_action_str(cmd.action), v.detail);
            diana_publish_diagnostic(a, DIANA_DIAG_COMMAND_REJECTED,
                                     DIANA_SEV_WARNING, msg);
        }
        remember_verdict(a, cmd.command_id, v);
    }

    cJSON_Delete(root);
}
