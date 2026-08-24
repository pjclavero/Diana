/**
 * @file app_tasks.c
 * @brief Tareas principales del modulo (dosier 13.2). NO COMPILADO.
 */
#include "app.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_task_wdt.h"
#include "esp32s3_proto_do_w5500.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "diana.task";

#define SENSOR9_BITS_PATTERN "%c%c%c%c%c%c%c%c%c"
#define SENSOR9_BITS(bitmap) \
    ((bitmap) & (1u << 8) ? '1' : '0'), \
    ((bitmap) & (1u << 7) ? '1' : '0'), \
    ((bitmap) & (1u << 6) ? '1' : '0'), \
    ((bitmap) & (1u << 5) ? '1' : '0'), \
    ((bitmap) & (1u << 4) ? '1' : '0'), \
    ((bitmap) & (1u << 3) ? '1' : '0'), \
    ((bitmap) & (1u << 2) ? '1' : '0'), \
    ((bitmap) & (1u << 1) ? '1' : '0'), \
    ((bitmap) & (1u << 0) ? '1' : '0')

#define SENSOR16_BITS_PATTERN "%c%c%c%c%c%c%c%c%c%c%c%c%c%c%c%c"
#define SENSOR16_BITS(bitmap) \
    ((bitmap) & (1u << 15) ? '1' : '0'), \
    ((bitmap) & (1u << 14) ? '1' : '0'), \
    ((bitmap) & (1u << 13) ? '1' : '0'), \
    ((bitmap) & (1u << 12) ? '1' : '0'), \
    ((bitmap) & (1u << 11) ? '1' : '0'), \
    ((bitmap) & (1u << 10) ? '1' : '0'), \
    ((bitmap) & (1u << 9) ? '1' : '0'), \
    ((bitmap) & (1u << 8) ? '1' : '0'), \
    ((bitmap) & (1u << 7) ? '1' : '0'), \
    ((bitmap) & (1u << 6) ? '1' : '0'), \
    ((bitmap) & (1u << 5) ? '1' : '0'), \
    ((bitmap) & (1u << 4) ? '1' : '0'), \
    ((bitmap) & (1u << 3) ? '1' : '0'), \
    ((bitmap) & (1u << 2) ? '1' : '0'), \
    ((bitmap) & (1u << 1) ? '1' : '0'), \
    ((bitmap) & (1u << 0) ? '1' : '0')

/* --------------------------------------------------------------- publicacion */

static void publish(diana_app *a, const char *topic, const char *json,
                    size_t len, diana_topic t)
{
    diana_hal_mqtt_msg msg = {
        .topic = topic,
        .payload = json,
        .payload_len = len,
        .qos = diana_topic_qos(t),
        .retain = diana_topic_retain(t),
    };
    a->hal.mqtt_publish(a->hal.ctx, &msg);
}

void diana_publish_presence(diana_app *a, diana_presence_reason reason)
{
    diana_hal_net_status net;
    a->hal.net_status(a->hal.ctx, &net);
    char buf[1024];
    size_t n = diana_presence_json(&a->id, reason, &net, buf, sizeof(buf));
    if (n) publish(a, a->topic_presence, buf, n, DIANA_TOPIC_PRESENCE);
}

void diana_publish_status(diana_app *a)
{
    diana_status_input in;
    memset(&in, 0, sizeof(in));
    in.id = &a->id;
    in.fsm = &a->fsm;
    in.targets = &a->targets;
    in.cfg = &a->cfg;
    in.selector = a->selector;
    in.role = a->role;
    in.queue_depth = diana_queue_depth(&a->queue);
    in.uptime_s = (a->hal.now_us(a->hal.ctx) - a->boot_us) / 1000000ULL;
    in.has_last_command = a->has_last_command;
    memcpy(in.last_command_id, a->last_command_id, sizeof(in.last_command_id));
    in.last_command_result = diana_command_result_str(a->last_command_result);
    in.last_command_detail = a->last_command_detail;

    char buf[DIANA_MSG_JSON_MAX];
    size_t n = diana_status_json(&in, buf, sizeof(buf));
    if (n) publish(a, a->topic_status, buf, n, DIANA_TOPIC_STATUS);
}

void diana_publish_diagnostic(diana_app *a, diana_diagnostic_kind kind,
                              diana_severity sev, const char *message)
{
    diana_diagnostic d;
    diana_diagnostic_init(&d, &a->hal, kind, sev, message);
    char buf[DIANA_MSG_JSON_MAX];
    size_t n = diana_diagnostic_json(&d, &a->id,
                                     a->hal.now_us(a->hal.ctx) - a->boot_us,
                                     buf, sizeof(buf));
    if (n) publish(a, a->topic_diagnostic, buf, n, DIANA_TOPIC_DIAGNOSTIC);
}

void diana_publish_config_reported(diana_app *a)
{
    char buf[DIANA_MSG_JSON_MAX];
    size_t n = diana_config_reported_json(&a->cfg, a->id.module_id, NULL, buf,
                                          sizeof(buf));
    if (n) publish(a, a->topic_config_reported, buf, n,
                   DIANA_TOPIC_CONFIG_REPORTED);
}

/* ------------------------------------------------------------------ sensores */

/** Publica el evento, o lo encola si no hay red (dosier 14.3). */
static void emit_hit(diana_app *a, const diana_hit_event *ev)
{
    if (diana_hit_event_check(ev) != DIANA_HAL_OK) {
        /* Un evento que no cumple el contrato NO se envia: se registra. */
        diana_publish_diagnostic(a, DIANA_DIAG_SCHEMA_REJECTED, DIANA_SEV_ERROR,
                                 "evento propio no conforme: descartado");
        return;
    }

    char json[DIANA_HIT_JSON_MAX];
    size_t n = diana_hit_event_to_json(ev, json, sizeof(json));
    if (n == 0) return;

    if (a->hal.mqtt_connected(a->hal.ctx)) {
        diana_hal_mqtt_msg msg = {a->topic_hit, json, n, 1, false};
        if (a->hal.mqtt_publish(a->hal.ctx, &msg) >= 0) {
            diana_queue_remember(&a->queue, ev->event_id);
            return;
        }
    }
    int rc = diana_queue_push(&a->queue, ev);
    if (rc == DIANA_HAL_ERR_NO_SPACE) {
        diana_publish_diagnostic(a, DIANA_DIAG_QUEUE_OVERFLOW, DIANA_SEV_ERROR,
                                 "cola local llena: evento perdido");
    }
}

void diana_task_sensors(void *arg)
{
    diana_app *a = (diana_app *)arg;
    esp_task_wdt_add(NULL);
    uint16_t last_logged_raw = 0xffffu;
    uint16_t last_logged_used = 0xffffu;
    uint64_t last_diag_us = 0;

    for (;;) {
        esp_task_wdt_reset();

        diana_platform_trigger t;
        bool got = diana_platform_trigger_pop(a->pf, &t, DIANA_HC165_POLL_MS);
        if (!got) continue;

        uint16_t used_raw = (uint16_t)(t.raw_bitmap & 0x01ffu);
        bool used_changed = used_raw != last_logged_used;
        bool raw_changed = t.raw_bitmap != last_logged_raw;
        bool diag_due = (t.t_us - last_diag_us) >= 250000ULL;
        if (used_changed || (raw_changed && diag_due)) {
            diana_do_snapshot snap;
            diana_do_decode(t.raw_bitmap, DIANA_DO_POLARITY, &snap);
            uint16_t active_high = diana_do_active_bitmap(t.raw_bitmap,
                                                          DIANA_DO_ACTIVE_HIGH);
            uint16_t active_low = diana_do_active_bitmap(t.raw_bitmap,
                                                         DIANA_DO_ACTIVE_LOW);
            ESP_LOGI(TAG, "SENSORES raw=0x%04x bits16=" SENSOR16_BITS_PATTERN
                     " raw D9..D1=" SENSOR9_BITS_PATTERN
                     " AH=" SENSOR9_BITS_PATTERN
                     " AL=" SENSOR9_BITS_PATTERN
                     " cfg=%s count=%u",
                     (unsigned)t.raw_bitmap, SENSOR16_BITS(t.raw_bitmap),
                     SENSOR9_BITS(used_raw),
                     SENSOR9_BITS(active_high),
                     SENSOR9_BITS(active_low),
                     DIANA_DO_POLARITY == DIANA_DO_ACTIVE_HIGH ? "AH" : "AL",
                     (unsigned)snap.active_count);
            last_logged_raw = t.raw_bitmap;
            last_logged_used = used_raw;
            last_diag_us = t.t_us;
        }

        diana_hit_group grp;
        diana_do_process_snapshot(&a->sensors, &a->cfg, t.raw_bitmap,
                                  DIANA_DO_POLARITY, t.t_us, &grp);

        if (!grp.accepted) {
            if (grp.target_index == 0 && strstr(grp.reason, "MULTI_TRIGGER") != NULL)
                diana_publish_diagnostic(a, DIANA_DIAG_SENSOR_ERROR,
                                         DIANA_SEV_WARNING, grp.reason);
            continue;
        }

        diana_target *tg = diana_target_at(&a->targets, grp.target_index);
        if (!tg) continue;
        diana_target_state before = tg->state;
        uint64_t now = a->hal.now_us(a->hal.ctx);

        /* Clasificacion segun el estado de la diana y de la partida. */
        if (a->fsm.state == DIANA_MODULE_GAME_PAUSED) {
            grp.classification = DIANA_HIT_DURING_PAUSE;
            snprintf(grp.reason, sizeof(grp.reason), "partida en pausa");
        } else if (a->fsm.state == DIANA_MODULE_CALIBRATION) {
            grp.classification = DIANA_HIT_CALIBRATION;
            snprintf(grp.reason, sizeof(grp.reason), "impacto de calibracion");
        } else if (before == DIANA_TARGET_SAFE) {
            grp.classification = DIANA_HIT_ON_SAFE;
            snprintf(grp.reason, sizeof(grp.reason), "diana en estado seguro");
            diana_target_apply(tg, DIANA_TEV_HIT_PENALTY, now);
        } else if (before == DIANA_TARGET_HIT) {
            grp.classification = DIANA_HIT_ON_ALREADY_HIT;
            snprintf(grp.reason, sizeof(grp.reason), "diana ya alcanzada");
        } else if (!diana_target_is_scorable(tg)) {
            grp.classification = DIANA_HIT_OUT_OF_ORDER;
            snprintf(grp.reason, sizeof(grp.reason), "diana no activa (%s)",
                     diana_target_state_str(before));
        } else {
            diana_target_apply(tg, DIANA_TEV_HIT_VALID, now);
        }

        diana_hit_event ev;
        diana_hit_event_build(&ev, &a->hal, &a->id, &grp, before, now);
        if (a->cfg.has_position) {
            ev.has_position = true;
            ev.position_x = a->cfg.position_x;
            ev.position_y = a->cfg.position_y;
        }
        ev.has_rotation = true;
        ev.rotation = a->cfg.rotation;
        emit_hit(a, &ev);

        /* Los vecinos descartados se publican para poder auditar la decision. */
        for (uint8_t i = 0; i < grp.rejected_count; ++i) {
            diana_hit_event rej;
            const diana_target *rtg =
                diana_target_at_const(&a->targets, grp.rejected_index[i]);
            if (diana_hit_event_build_rejected(&rej, &a->hal, &a->id, &grp, i,
                                               rtg ? rtg->state : DIANA_TARGET_OFF,
                                               now))
                emit_hit(a, &rej);
        }
    }
}

/* ---------------------------------------------------------------------- LED */

void diana_task_leds(void *arg)
{
    diana_app *a = (diana_app *)arg;
    esp_task_wdt_add(NULL);

    for (;;) {
        esp_task_wdt_reset();
        uint64_t now = a->hal.now_us(a->hal.ctx);
        uint64_t t_ms = now / 1000ULL;

        if (a->identify_active && now > a->identify_until_us)
            a->identify_active = false;

        diana_target_state states[DIANA_TARGET_COUNT];
        for (int i = 0; i < DIANA_TARGET_COUNT; ++i)
            states[i] = a->targets.t[i].state;

        diana_hal_rgb px[DIANA_LED_CHAINS][DIANA_LEDS_PER_CHAIN];
        for (uint8_t c = 0; c < DIANA_LED_CHAINS; ++c)
            diana_led_render_chain(c, states, a->identify_active,
                                   a->cfg.led_brightness_max, t_ms, px[c]);

        /* Presupuesto de potencia ANTES de escribir: nunca se envia al hardware
         * un fotograma que exceda la corriente disponible (dosier 10.4). */
        diana_hal_rgb *chains[DIANA_LED_CHAINS] = {px[0], px[1], px[2]};
        diana_led_apply_budget(chains, DIANA_LEDS_PER_CHAIN, DIANA_LED_BUDGET_MA);

        for (uint8_t c = 0; c < DIANA_LED_CHAINS; ++c)
            a->hal.led_write(a->hal.ctx, c, px[c], DIANA_LEDS_PER_CHAIN);
        diana_platform_led_refresh(a->pf);

        vTaskDelay(pdMS_TO_TICKS(20));   /* 50 fps */
    }
}

/* ------------------------------------------------------------------- red */

void diana_task_network(void *arg)
{
    diana_app *a = (diana_app *)arg;
    esp_task_wdt_add(NULL);

    bool was_connected = false;

    for (;;) {
        esp_task_wdt_reset();
        bool connected = a->hal.mqtt_connected(a->hal.ctx);

        if (connected && !was_connected) {
            /* Reconexion: presencia, estado, config y vaciado de la cola. */
            a->mqtt_reconnects++;
            diana_module_fsm_apply(&a->fsm, DIANA_EV_MQTT_CONNECTED,
                                   a->hal.now_us(a->hal.ctx));
            diana_publish_presence(a, DIANA_PRESENCE_CONNECT);
            diana_module_fsm_apply(&a->fsm, DIANA_EV_REGISTERED,
                                   a->hal.now_us(a->hal.ctx));
            diana_publish_status(a);
            diana_publish_config_reported(a);
            ESP_LOGI(TAG, "reconectado: vaciando %u eventos pendientes",
                     (unsigned)diana_queue_depth(&a->queue));
        } else if (!connected && was_connected) {
            diana_module_fsm_apply(&a->fsm, DIANA_EV_MQTT_DISCONNECTED,
                                   a->hal.now_us(a->hal.ctx));
        }
        was_connected = connected;

        if (connected && diana_queue_depth(&a->queue) > 0) {
            /* Vaciado por lotes: no monopoliza la red ni el watchdog. */
            diana_queue_flush(&a->queue, a->topic_hit, 8);
        }

        diana_platform_rx rx;
        while (diana_platform_rx_pop(a->pf, &rx, 20))
            diana_handle_message(a, &rx);

        /* Rollback automatico si la OTA no se confirma a tiempo. */
        diana_ota_tick(&a->ota, a->hal.now_us(a->hal.ctx));

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

/* ------------------------------------------------------------- telemetria */

void diana_task_telemetry(void *arg)
{
    diana_app *a = (diana_app *)arg;
    esp_task_wdt_add(NULL);

    for (;;) {
        esp_task_wdt_reset();

        diana_telemetry_input in;
        memset(&in, 0, sizeof(in));
        in.id = &a->id;
        uint64_t now = a->hal.now_us(a->hal.ctx);
        in.uptime_us = now - a->boot_us;
        in.uptime_s = in.uptime_us / 1000000ULL;
        a->hal.health(a->hal.ctx, &in.health);

        diana_hal_net_status net;
        a->hal.net_status(a->hal.ctx, &net);
        in.link_up = net.link_up;
        in.mqtt_reconnects = a->mqtt_reconnects;
        in.queue_depth = diana_queue_depth(&a->queue);
        for (int c = 0; c < DIANA_LED_CHAINS; ++c) in.chain_ok[c] = true;
        in.has_chain_current = false;   /* sin medida real de corriente por cadena */

        char buf[DIANA_MSG_JSON_MAX];
        size_t n = diana_telemetry_json(&in, buf, sizeof(buf));
        if (n) publish(a, a->topic_telemetry, buf, n, DIANA_TOPIC_TELEMETRY);

        if (in.health.has_voltage && in.health.voltage_5v_mv < 4600) {
            diana_publish_diagnostic(a, DIANA_DIAG_LOW_VOLTAGE, DIANA_SEV_WARNING,
                                     "5V por debajo de 4,6 V");
        }

        vTaskDelay(pdMS_TO_TICKS(a->cfg.telemetry_interval_ms));
    }
}
