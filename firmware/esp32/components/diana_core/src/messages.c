#include "diana/messages.h"

#include <stdio.h>
#include <string.h>

#include "diana/ids.h"
#include "diana/json.h"

/* Tabla de topicos del contrato §1 y §2. */
static const char *const SUFFIX[DIANA_TOPIC_COUNT] = {
    "presence", "status", "telemetry", "config/reported", "config/desired",
    "command", "hit", "diagnostic", "ota",
};
static const int QOS[DIANA_TOPIC_COUNT] = {1, 1, 0, 1, 1, 1, 1, 1, 1};
static const bool RETAIN[DIANA_TOPIC_COUNT] = {
    true,  /* presence  */
    true,  /* status    */
    false, /* telemetry */
    true,  /* config/reported */
    true,  /* config/desired  */
    false, /* command   */
    false, /* hit: NUNCA retenido, reproduciria impactos al reconectar */
    false, /* diagnostic */
    false, /* ota */
};

size_t diana_topic_build(char *buf, size_t cap, diana_topic t,
                         const char *module_id)
{
    if ((int)t < 0 || t >= DIANA_TOPIC_COUNT || !module_id) return 0;
    int n = snprintf(buf, cap, "targets/v1/module/%s/%s", module_id, SUFFIX[t]);
    if (n < 0 || (size_t)n >= cap) return 0;
    return (size_t)n;
}

int diana_topic_qos(diana_topic t)
{
    if ((int)t < 0 || t >= DIANA_TOPIC_COUNT) return 1;
    return QOS[t];
}

bool diana_topic_retain(diana_topic t)
{
    if ((int)t < 0 || t >= DIANA_TOPIC_COUNT) return false;
    return RETAIN[t];
}

static const char *const SYS_SUFFIX[DIANA_SYS_TOPIC_COUNT] = {
    "game/event", "game/state", "command", "status",
};

size_t diana_system_topic_build(char *buf, size_t cap, diana_system_topic t,
                                const char *system_id)
{
    if ((int)t < 0 || t >= DIANA_SYS_TOPIC_COUNT || !system_id) return 0;
    int n = snprintf(buf, cap, "targets/v1/system/%s/%s", system_id, SYS_SUFFIX[t]);
    if (n < 0 || (size_t)n >= cap) return 0;
    return (size_t)n;
}

/* ------------------------------------------------------------- presencia */

size_t diana_presence_lwt_json(const char *module_id, char *buf, size_t cap)
{
    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "module_id", module_id);
    diana_json_bool(&j, "online", false);
    diana_json_str(&j, "reason", diana_presence_reason_str(DIANA_PRESENCE_LWT));
    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}

size_t diana_presence_json(const diana_identity *id, diana_presence_reason reason,
                           const diana_hal_net_status *net, char *buf, size_t cap)
{
    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "module_id", id->module_id);
    diana_json_bool(&j, "online", reason == DIANA_PRESENCE_CONNECT);
    diana_json_str(&j, "reason", diana_presence_reason_str(reason));
    diana_json_str(&j, "boot_id", id->boot_id);
    diana_json_str(&j, "firmware_version", id->firmware_version);
    if (id->hardware_revision[0])
        diana_json_str(&j, "hardware_revision", id->hardware_revision);
    else
        diana_json_null(&j, "hardware_revision");
    if (net && net->mac[0]) diana_json_str(&j, "mac", net->mac);
    else diana_json_null(&j, "mac");
    if (net && net->has_ip && net->ip[0]) diana_json_str(&j, "ip", net->ip);
    else diana_json_null(&j, "ip");
    if (id->serial[0]) diana_json_str(&j, "serial", id->serial);
    else diana_json_null(&j, "serial");
    /* Las credenciales MQTT NUNCA se publican. */
    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}

/* ----------------------------------------------------------------- estado */

size_t diana_status_json(const diana_status_input *in, char *buf, size_t cap)
{
    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "module_id", in->id->module_id);
    if (in->id->system_id[0]) diana_json_str(&j, "system_id", in->id->system_id);
    else diana_json_null(&j, "system_id");
    diana_json_str(&j, "state", diana_module_state_str(in->fsm->state));
    diana_json_str(&j, "selector", diana_selector_str(in->selector));
    diana_json_str(&j, "role", diana_role_str(in->role));

    if (in->cfg && in->cfg->has_position) {
        diana_json_key(&j, "position");
        diana_json_obj_open(&j);
        diana_json_int(&j, "x", in->cfg->position_x);
        diana_json_int(&j, "y", in->cfg->position_y);
        diana_json_obj_close(&j);
    } else {
        diana_json_null(&j, "position");
    }
    diana_json_int(&j, "rotation", in->cfg ? in->cfg->rotation : 0);

    diana_json_key(&j, "targets");
    diana_json_arr_open(&j);
    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
        const diana_target *tg = &in->targets->t[i];
        diana_json_arr_obj_open(&j);
        diana_json_int(&j, "target_index", tg->index);
        diana_json_str(&j, "state", diana_target_state_str(tg->state));
        diana_json_bool(&j, "enabled", tg->enabled);
        diana_json_obj_close(&j);
    }
    diana_json_arr_close(&j);

    diana_json_uint(&j, "queue_depth", (uint64_t)in->queue_depth);

    if (in->has_last_command && in->last_command_result) {
        diana_json_key(&j, "last_command");
        diana_json_obj_open(&j);
        diana_json_str(&j, "command_id", in->last_command_id);
        diana_json_str(&j, "result", in->last_command_result);
        if (in->last_command_detail && in->last_command_detail[0])
            diana_json_str(&j, "detail", in->last_command_detail);
        diana_json_obj_close(&j);
    } else {
        diana_json_null(&j, "last_command");
    }

    diana_json_str(&j, "firmware_version", in->id->firmware_version);
    diana_json_uint(&j, "uptime_s", in->uptime_s);
    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}

/* ------------------------------------------------------------- telemetria */

size_t diana_telemetry_json(const diana_telemetry_input *in, char *buf, size_t cap)
{
    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "module_id", in->id->module_id);
    diana_json_uint(&j, "uptime_s", in->uptime_s);
    diana_json_uint(&j, "free_heap_bytes", in->health.free_heap_bytes);
    diana_json_uint(&j, "min_free_heap_bytes", in->health.min_free_heap_bytes);
    diana_json_num(&j, "cpu_load_pct", in->health.cpu_load_pct, 1);
    if (in->health.has_temperature)
        diana_json_num(&j, "temperature_c", in->health.temperature_c, 1);
    else
        diana_json_null(&j, "temperature_c");
    if (in->health.has_voltage) {
        diana_json_uint(&j, "voltage_5v_mv", in->health.voltage_5v_mv);
        diana_json_uint(&j, "voltage_12v_mv", in->health.voltage_12v_mv);
    } else {
        diana_json_null(&j, "voltage_5v_mv");
        diana_json_null(&j, "voltage_12v_mv");
    }
    diana_json_bool(&j, "link_up", in->link_up);
    diana_json_uint(&j, "mqtt_reconnects", in->mqtt_reconnects);
    diana_json_uint(&j, "queue_depth", (uint64_t)in->queue_depth);

    diana_json_key(&j, "led_chains");
    diana_json_arr_open(&j);
    for (int c = 0; c < DIANA_LED_CHAINS; ++c) {
        diana_json_arr_obj_open(&j);
        diana_json_int(&j, "chain", c);
        diana_json_bool(&j, "ok", in->chain_ok[c]);
        if (in->has_chain_current)
            diana_json_uint(&j, "current_ma", in->chain_current_ma[c]);
        else
            diana_json_null(&j, "current_ma");
        diana_json_obj_close(&j);
    }
    diana_json_arr_close(&j);

    diana_json_key(&j, "device");
    diana_json_obj_open(&j);
    diana_json_str(&j, "boot_id", in->id->boot_id);
    diana_json_uint(&j, "uptime_us", in->uptime_us);
    diana_json_obj_close(&j);

    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}

/* ------------------------------------------------------------ diagnostico */

void diana_diagnostic_init(diana_diagnostic *d, const diana_hal *hal,
                           diana_diagnostic_kind kind, diana_severity sev,
                           const char *message)
{
    memset(d, 0, sizeof(*d));
    diana_uuid4(hal, d->event_id);
    d->kind = kind;
    d->severity = sev;
    if (message) {
        size_t n = strlen(message);
        if (n >= DIANA_MESSAGE_MAXLEN) n = DIANA_MESSAGE_MAXLEN - 1;
        memcpy(d->message, message, n);
        d->message[n] = '\0';
    }
}

size_t diana_diagnostic_json(const diana_diagnostic *d, const diana_identity *id,
                             uint64_t uptime_us, char *buf, size_t cap)
{
    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "module_id", id->module_id);
    diana_json_str(&j, "event_id", d->event_id);
    diana_json_str(&j, "kind", diana_diagnostic_kind_str(d->kind));
    diana_json_str(&j, "severity", diana_severity_str(d->severity));
    diana_json_str(&j, "message", d->message);

    diana_json_key(&j, "device");
    diana_json_obj_open(&j);
    diana_json_str(&j, "boot_id", id->boot_id);
    diana_json_uint(&j, "uptime_us", uptime_us);
    diana_json_uint(&j, "event_us", uptime_us);
    diana_json_obj_close(&j);

    if (d->detail_count > 0) {
        diana_json_key(&j, "detail");
        diana_json_obj_open(&j);
        for (uint8_t i = 0; i < d->detail_count && i < 8; ++i) {
            if (d->detail_str[i])
                diana_json_str(&j, d->detail_keys[i], d->detail_str[i]);
            else
                diana_json_int(&j, d->detail_keys[i], d->detail_num[i]);
        }
        diana_json_obj_close(&j);
    }

    diana_json_str(&j, "firmware_version", id->firmware_version);
    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}

/* -------------------------------------------------------- config reported */

size_t diana_config_reported_json(const diana_config *cfg, const char *module_id,
                                  const char *applied_at, char *buf, size_t cap)
{
    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "module_id", module_id);
    diana_json_uint(&j, "config_version", cfg->config_version);
    if (cfg->system_id[0]) diana_json_str(&j, "system_id", cfg->system_id);
    else diana_json_null(&j, "system_id");

    if (cfg->has_position) {
        diana_json_key(&j, "position");
        diana_json_obj_open(&j);
        diana_json_int(&j, "x", cfg->position_x);
        diana_json_int(&j, "y", cfg->position_y);
        diana_json_obj_close(&j);
    } else {
        diana_json_null(&j, "position");
    }
    diana_json_int(&j, "rotation", cfg->rotation);
    if (cfg->friendly_name[0])
        diana_json_str(&j, "friendly_name", cfg->friendly_name);
    diana_json_int(&j, "led_brightness_max", cfg->led_brightness_max);
    diana_json_uint(&j, "telemetry_interval_ms", cfg->telemetry_interval_ms);

    diana_json_key(&j, "network");
    diana_json_obj_open(&j);
    diana_json_str(&j, "mode", cfg->network.mode == DIANA_NET_STATIC ? "static" : "dhcp");
    if (cfg->network.ip[0]) diana_json_str(&j, "ip", cfg->network.ip);
    else diana_json_null(&j, "ip");
    if (cfg->network.netmask[0]) diana_json_str(&j, "netmask", cfg->network.netmask);
    else diana_json_null(&j, "netmask");
    if (cfg->network.gateway[0]) diana_json_str(&j, "gateway", cfg->network.gateway);
    else diana_json_null(&j, "gateway");
    diana_json_obj_close(&j);

    diana_json_key(&j, "calibration");
    diana_json_arr_open(&j);
    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
        const diana_target_calibration *c = &cfg->calibration[i];
        diana_json_arr_obj_open(&j);
        diana_json_int(&j, "target_index", c->target_index);
        diana_json_int(&j, "threshold", c->threshold);
        diana_json_int(&j, "hysteresis", c->hysteresis);
        diana_json_int(&j, "noise_floor", c->noise_floor);
        diana_json_uint(&j, "blanking_us", c->blanking_us);
        diana_json_uint(&j, "group_window_us", c->group_window_us);
        diana_json_num(&j, "neighbour_ratio", c->neighbour_ratio, 3);
        diana_json_bool(&j, "enabled", c->enabled);
        /* Sin calibrar => null. No se finge una fecha de calibracion. */
        if (c->has_calibrated_at && c->calibrated_at[0])
            diana_json_str(&j, "calibrated_at", c->calibrated_at);
        else
            diana_json_null(&j, "calibrated_at");
        diana_json_obj_close(&j);
    }
    diana_json_arr_close(&j);

    if (applied_at && applied_at[0]) diana_json_str(&j, "applied_at", applied_at);
    else diana_json_null(&j, "applied_at");

    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}

/* ------------------------------------------------------------- game-event */

size_t diana_game_event_target_hit(const diana_hal *hal,
                                   diana_module_role own_role,
                                   const diana_game_event_hit *in,
                                   char *buf, size_t cap)
{
    /* Solo el coordinador publica en system/…/game/event. */
    if (own_role != DIANA_ROLE_PRINCIPAL) return 0;
    /* Un target_hit sin enlace al hit original seria T2 huerfano: el backend no
     * podria unirlo con T1 y el tiempo de juego quedaria sin respaldo. */
    if (!in->hit_event_id || !in->hit_event_id[0]) return 0;
    if (!in->system_id || !in->coordinator_module_id) return 0;
    if (!in->game_id || !in->round_id) return 0;

    char event_id[DIANA_UUID_LEN];
    diana_uuid4(hal, event_id);

    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", DIANA_SCHEMA_VERSION);
    diana_json_str(&j, "system_id", in->system_id);
    /* event_id propio del coordinador: NO se reutiliza el del detector. */
    diana_json_str(&j, "event_id", event_id);
    diana_json_str(&j, "game_id", in->game_id);
    diana_json_str(&j, "round_id", in->round_id);
    diana_json_str(&j, "kind", "target_hit");
    diana_json_str(&j, "coordinator_module_id", in->coordinator_module_id);
    /* T2: el tiempo de juego que ve el jugador, calculado por el coordinador. */
    diana_json_uint(&j, "elapsed_us", in->elapsed_us);

    diana_json_key(&j, "device");
    diana_json_obj_open(&j);
    diana_json_str(&j, "boot_id", in->device.boot_id);
    diana_json_uint(&j, "uptime_us", in->device.uptime_us);
    diana_json_uint(&j, "event_us", in->device.event_us);
    diana_json_obj_close(&j);

    /* Enlace con T1 del detector. */
    diana_json_str(&j, "hit_event_id", in->hit_event_id);
    if (in->detector_module_id)
        diana_json_str(&j, "module_id", in->detector_module_id);
    diana_json_int(&j, "target_index", in->target_index);
    if (in->detail && in->detail[0]) diana_json_str(&j, "detail", in->detail);

    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}
