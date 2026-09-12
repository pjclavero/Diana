/**
 * @file app_tasks.c
 * @brief Tareas principales del modulo (dosier 13.2).
 */
#include "app.h"

/* diana_is_uuid(): el resultado de mantenimiento no se publica sin un
 * request_id valido con que correlarlo. */
#include <stdatomic.h>

#include "diana/ids.h"
#include "diana/selector_track.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "esp_task_wdt.h"
#include "esp32s3_proto_do_w5500.h"
#include "driver/gpio.h"
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

/* --------------------------------------------------------------- entradas */

void diana_task_inputs(void *arg)
{
    diana_app *a = (diana_app *)arg;
    esp_task_wdt_add(NULL);

    /* El antirrebote y la deteccion de cambio viven en el nucleo
     * (diana/selector_track.h): asi la cadena selector -> status -> backend se
     * prueba por EJECUCION en la suite de host, con la secuencia real medida en
     * el banco, en vez de por encontrar una llamada en este fichero. */
    diana_selector_tracker selector;
    diana_selector_tracker_reset(&selector);
    bool button_candidate = a->hal.button_pressed(a->hal.ctx);
    bool button_stable = button_candidate;
    uint8_t button_samples = 0;
    a->identify_button_active = button_stable;

    for (;;) {
        esp_task_wdt_reset();

        int s1 = gpio_get_level(DIANA_PIN_SELECTOR_A);
        int s2 = gpio_get_level(DIANA_PIN_SELECTOR_B);
        diana_selector_position sel = a->selector;
        diana_selector_event ev = diana_selector_track(
            &selector, s1, s2, DIANA_SELECTOR_PROFILE,
            a->hal.now_us(a->hal.ctx), &sel);

        if (ev == DIANA_SEL_EV_INVALIDO) {
            /* TRANSITO, no averia: un SPDT pasa por 1,1 mientras el comun
             * viaja entre contactos (180-420 ms medidos en el banco). No
             * cambia el rol ni publica nada. La politica de SELECTOR_FAULT
             * --- invalido PERSISTENTE --- se decide en el paso 3;
             * diana_selector_invalid_for() ya da la cifra que hara falta. */
            ESP_LOGW(TAG, "SELECTOR GPIO15=%d GPIO16=%d en transito", s1, s2);
        }
        if (ev == DIANA_SEL_EV_CAMBIO) {
            {
                a->selector = sel;
                a->role = diana_role_from_selector(sel);
                ESP_LOGI(TAG, "SELECTOR GPIO15=%d GPIO16=%d mode=%s", s1, s2,
                         diana_selector_str(sel));

                /* ROL DE COORDINADOR, atado al selector ESTABLE (tres muestras
                 * iguales). El transito entre contactos de un SPDT pasa por
                 * 1,1 durante 180-420 ms --- medido en el banco --- y NO
                 * concede autoridad: `diana_selector_decode` lo rechaza y esta
                 * rama no se ejecuta.
                 *
                 * Al salir de PRINCIPAL se DESUSCRIBE y se olvida la partida:
                 * dejar de coordinar tiene que ser inmediato, no "dejar de
                 * atender pero seguir escuchando". */
                bool principal = (sel == DIANA_SELECTOR_PRINCIPAL);
                if (!principal) diana_coordinator_reset(&a->coord);
                diana_platform_mqtt_set_coordinator(a->pf, principal,
                                                    a->id.system_id);

                /* PROPAGACION INMEDIATA (paso 2.5). `module-status` lleva el
                 * selector y el rol, y es lo que el backend usara para elegir
                 * coordinador. Sin publicar aqui, el cambio no se conoceria
                 * hasta el siguiente status espontaneo --- y `status` es
                 * RETENIDO, no periodico ---, con lo que la eleccion
                 * automatica no reaccionaria a mover el interruptor. */
                /* Se SOLICITA la publicacion; la hace diana_net. Publicar
                 * aqui tumbo la conexion MQTT en el banco. */
                atomic_store(&a->status_dirty, true);
            }
        }

        bool button = a->hal.button_pressed(a->hal.ctx);
        if (button != button_candidate) {
            button_candidate = button;
            button_samples = 1;
        } else if (button_samples < 3) {
            button_samples++;
        }
        if (button_samples == 3 && button_stable != button_candidate) {
            button_stable = button_candidate;
            a->identify_button_active = button_stable;
            ESP_LOGI(TAG, "IDENTIFY GPIO17=%s",
                     button_stable ? "LOW" : "HIGH");
        }

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

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

static char *alloc_message_buffer(void)
{
    char *buf = malloc(DIANA_MSG_JSON_MAX);
    if (!buf) ESP_LOGE(TAG, "sin memoria para serializar mensaje JSON");
    return buf;
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

    char *buf = alloc_message_buffer();
    if (!buf) return;
    size_t n = diana_status_json(&in, buf, DIANA_MSG_JSON_MAX);
    if (n) publish(a, a->topic_status, buf, n, DIANA_TOPIC_STATUS);
    free(buf);
}

void diana_publish_command_rejected(diana_app *a, const char *command_id,
                                    diana_command_reject_reason reason,
                                    const char *message)
{
    diana_diagnostic d;
    if (!diana_diagnostic_command_rejected(&d, &a->hal, command_id, reason,
                                           message)) {
        /* Sin UUID con que correlar esto no es un rechazo de comando, es un
         * sobre mal formado. Se dice lo que es en vez de inventar un
         * request_id para que el validador se ponga verde. */
        diana_publish_diagnostic(a, DIANA_DIAG_SCHEMA_REJECTED,
                                 DIANA_SEV_WARNING,
                                 "comando rechazado sin command_id valido: "
                                 "incorrelable");
        return;
    }
    /* Buffer en heap, como el resto de publicadores tras el fix de
     * desbordamiento de pila del banco 2026-08-24. */
    char *buf = alloc_message_buffer();
    if (!buf) return;
    size_t n = diana_diagnostic_json(&d, &a->id,
                                     a->hal.now_us(a->hal.ctx) - a->boot_us,
                                     buf, DIANA_MSG_JSON_MAX);
    if (n) publish(a, a->topic_diagnostic, buf, n, DIANA_TOPIC_DIAGNOSTIC);
    else   ESP_LOGE(TAG, "diagnostico '%s' NO serializado: se descarta",
                    diana_diagnostic_kind_str(d.kind));
    free(buf);
}

void diana_publish_module_command(diana_app *a, const diana_coord_plan *plan)
{
    if (!a || !plan || !plan->emit_command) return;

    char command_id[DIANA_UUID_LEN];
    diana_uuid4(&a->hal, command_id);

    char *buf = alloc_message_buffer();
    if (!buf) return;
    /* TTL corto: una orden de juego que llega tarde ya no sirve, y el receptor
     * la rechazaria por 6-bis. 5 s cubre de sobra la red del banco. */
    size_t n = diana_coord_module_command_json(
        plan, command_id, a->hal.epoch_ms ? a->hal.epoch_ms(a->hal.ctx) : 0,
        5000, buf, DIANA_MSG_JSON_MAX);
    if (n) {
        char topic[DIANA_TOPIC_MAXLEN];
        diana_topic_build(topic, sizeof(topic), DIANA_TOPIC_COMMAND,
                          plan->command_module_id);
        publish(a, topic, buf, n, DIANA_TOPIC_COMMAND);
        ESP_LOGI(TAG, "COORDINADOR -> %s: diana %u activa",
                 plan->command_module_id, (unsigned)plan->active_target_index);
    } else {
        ESP_LOGE(TAG, "comando de coordinador NO serializado: se descarta");
    }
    free(buf);
}

void diana_publish_game_state(diana_app *a, const diana_coord_plan *plan)
{
    if (!a || !plan || !plan->emit_state) return;

    char *buf = alloc_message_buffer();
    if (!buf) return;
    uint64_t ahora = a->hal.now_us(a->hal.ctx);
    size_t n = diana_coord_game_state_json(
        &a->coord, plan, a->id.system_id, a->id.module_id,
        ahora - a->boot_us, ahora, ahora - a->boot_us,
        a->id.boot_id, buf, DIANA_MSG_JSON_MAX);
    if (n) {
        char topic[DIANA_TOPIC_MAXLEN];
        diana_system_topic_build(topic, sizeof(topic), DIANA_SYS_TOPIC_GAME_STATE,
                                 a->id.system_id);
        /* QoS 1 y RETENIDO por contrato (game-state.schema.json). No pasa por
         * diana_topic_retain() porque ese enum describe los topicos de MODULO:
         * meter game/state alli permitiria construir `module/x/game/state`, que
         * no existe. */
        diana_hal_mqtt_msg msg = {
            .topic = topic, .payload = buf, .payload_len = n,
            .qos = 1, .retain = true,
        };
        a->hal.mqtt_publish(a->hal.ctx, &msg);
    } else {
        ESP_LOGE(TAG, "game/state NO serializado: se descarta");
    }
    free(buf);
}

void diana_publish_maintenance_result(diana_app *a, const char *request_id,
                                      const char *component, int target_index,
                                      uint32_t duration_ms)
{
    diana_diagnostic d;
    diana_diagnostic_init(&d, &a->hal, DIANA_DIAG_SELF_TEST_RESULT,
                          DIANA_SEV_INFO, "orden de mantenimiento ejecutada");

    /* Sin UUID con que correlar, este resultado no sirve para nada: el panel no
     * podria distinguirlo de la respuesta a otra orden. Se calla en vez de
     * publicar algo incorrelable, igual que hace el rechazo. */
    if (!request_id || !diana_is_uuid(request_id)) {
        ESP_LOGW(TAG, "resultado de mantenimiento sin request_id valido: "
                      "no se publica (seria incorrelable)");
        return;
    }
    d.has_request_id = true;
    snprintf(d.request_id, sizeof(d.request_id), "%s", request_id);

    d.detail_keys[d.detail_count] = "result";
    d.detail_str[d.detail_count++] = "ok";
    d.detail_keys[d.detail_count] = "component";
    d.detail_str[d.detail_count++] = component;
    if (target_index > 0) {
        d.detail_keys[d.detail_count] = "target_index";
        d.detail_str[d.detail_count] = NULL;
        d.detail_num[d.detail_count++] = target_index;
    }
    if (duration_ms > 0) {
        d.detail_keys[d.detail_count] = "duration_ms";
        d.detail_str[d.detail_count] = NULL;
        d.detail_num[d.detail_count++] = (int64_t)duration_ms;
    }

    char *buf = alloc_message_buffer();
    if (!buf) return;
    size_t n = diana_diagnostic_json(&d, &a->id,
                                     a->hal.now_us(a->hal.ctx) - a->boot_us,
                                     buf, DIANA_MSG_JSON_MAX);
    /* Un diagnostico que no serializa se DICE. El silencio de este camino es
     * lo que oculto durante toda una tanda que los rechazos de mantenimiento
     * no salian del modulo: el serializador los rechazaba por incorrelables
     * --- con razon --- y aqui se tiraban sin dejar rastro. */
    if (n) publish(a, a->topic_diagnostic, buf, n, DIANA_TOPIC_DIAGNOSTIC);
    else   ESP_LOGE(TAG, "diagnostico '%s' NO serializado: se descarta",
                    diana_diagnostic_kind_str(d.kind));
    free(buf);
}

void diana_publish_diagnostic(diana_app *a, diana_diagnostic_kind kind,
                              diana_severity sev, const char *message)
{
    diana_diagnostic d;
    diana_diagnostic_init(&d, &a->hal, kind, sev, message);
    char *buf = alloc_message_buffer();
    if (!buf) return;
    size_t n = diana_diagnostic_json(&d, &a->id,
                                     a->hal.now_us(a->hal.ctx) - a->boot_us,
                                     buf, DIANA_MSG_JSON_MAX);
    /* Un diagnostico que no serializa se DICE. El silencio de este camino es
     * lo que oculto durante toda una tanda que los rechazos de mantenimiento
     * no salian del modulo: el serializador los rechazaba por incorrelables
     * --- con razon --- y aqui se tiraban sin dejar rastro. */
    if (n) publish(a, a->topic_diagnostic, buf, n, DIANA_TOPIC_DIAGNOSTIC);
    else   ESP_LOGE(TAG, "diagnostico '%s' NO serializado: se descarta",
                    diana_diagnostic_kind_str(d.kind));
    free(buf);
}

void diana_publish_config_reported(diana_app *a)
{
    char *buf = alloc_message_buffer();
    if (!buf) return;
    size_t n = diana_config_reported_json(&a->cfg, a->id.module_id, NULL, buf,
                                          DIANA_MSG_JSON_MAX);
    if (n) publish(a, a->topic_config_reported, buf, n,
                   DIANA_TOPIC_CONFIG_REPORTED);
    free(buf);
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
        /* Cada diana caduca por su cuenta: el vencimiento de una no puede
         * apagar a otra. Se construye aqui la mascara que consume el render. */
        uint16_t test_mask = 0;
        for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
            if (a->led_test_until_us[i] == 0) continue;
            if (now > a->led_test_until_us[i]) {
                a->led_test_until_us[i] = 0;
                continue;
            }
            test_mask |= (uint16_t)(1u << i);
        }

#if CONFIG_DIANA_BENCH_HIT_LED_TEST
        for (uint8_t i = 0; i < 3; ++i) {
            diana_target *tg = &a->targets.t[i];
            if (tg->state == DIANA_TARGET_HIT &&
                now - tg->entered_at_us >= 1000000ULL) {
                diana_target_apply(tg, DIANA_TEV_HIT_CLEARED, now);
                diana_target_apply(tg, DIANA_TEV_ARM, now);
                ESP_LOGI(TAG, "BANCO D%u rearmada", (unsigned)(i + 1u));
            }
        }
#endif

        diana_target_state states[DIANA_TARGET_COUNT];
        for (int i = 0; i < DIANA_TARGET_COUNT; ++i)
            states[i] = a->targets.t[i].state;

        diana_hal_rgb px[DIANA_LED_CHAINS][DIANA_LEDS_PER_CHAIN];
        for (uint8_t c = 0; c < DIANA_LED_CHAINS; ++c)
            diana_led_render_chain(c, states,
                                   a->identify_active || a->identify_button_active,
                                   test_mask,
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
            /* v1.2 · ADR-0008: al (re)conectar se declara el estado de
             * autoridad si hay algo que declarar. Es reported state
             * observacional, jamas una orden. */
            diana_prov_app_announce(a);
            ESP_LOGI(TAG, "reconectado: vaciando %u eventos pendientes",
                     (unsigned)diana_queue_depth(&a->queue));
            /* La cola persistente se liga a la identidad ACTUAL en cada
             * conexion: si el modulo se reaprovisiono, lo que quedo dentro es
             * de otro y no puede salir en su nombre. */
            diana_queue_bind_identity(&a->queue, a->id.module_id, a->id.system_id);
        } else if (!connected && was_connected) {
            diana_module_fsm_apply(&a->fsm, DIANA_EV_MQTT_DISCONNECTED,
                                   a->hal.now_us(a->hal.ctx));
        }
        was_connected = connected;

        if (connected && diana_queue_depth(&a->queue) > 0) {
            /* Vaciado por lotes: no monopoliza la red ni el watchdog. */
            diana_queue_flush(&a->queue, a->topic_hit, 8);
            /* Diagnostico UNA sola vez: si se registrara en cada vaciado, una
             * cola con eventos de otra identidad llenaria el log para siempre
             * --- que es exactamente el sintoma que esto viene a cerrar. */
            if (a->queue.stale_identity > 0 && !a->queue.stale_reported) {
                a->queue.stale_reported = true;
                ESP_LOGW(TAG,
                         "cola: %u evento(s) retirados por pertenecer a OTRA "
                         "identidad; la actual es '%s'/'%s'",
                         (unsigned)a->queue.stale_identity, a->id.module_id,
                         a->id.system_id);
            }
        }

        /* FUERA DE LA PILA. Un diana_platform_rx son ~4.3 KB desde que el
         * buffer de recepcion se dimensiono contra el contrato, y la pila de
         * diana_net son 8 KB: en la placa esto desbordo con
         * "A stack overflow in task diana_net has been detected" justo despues
         * de las suscripciones, en cuanto llego el primer mensaje. `static` es
         * seguro porque diana_task_network es la UNICA tarea que ejecuta esta
         * funcion; si algun dia deja de serlo, hay que volver aqui. */
        /* PUBLICACION DIFERIDA del estado. `atomic_exchange` lee y limpia en
         * un solo paso: si llega otro cambio de selector justo despues, la
         * bandera se vuelve a marcar y se publicara en la siguiente vuelta, sin
         * perderse ni duplicarse. */
        if (atomic_exchange(&a->status_dirty, false)) {
            diana_publish_status(a);
            ESP_LOGI(TAG, "module-status publicado por cambio de selector");
        }

        static diana_platform_rx rx;
        while (diana_platform_rx_pop(a->pf, &rx, 20))
            diana_handle_message(a, &rx);

        /* Rollback automatico si la OTA no se confirma a tiempo. */
        diana_ota_tick(&a->ota, a->hal.now_us(a->hal.ctx));

        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

/* ------------------------------------------------------------- telemetria */

/* Cadencia de la lectura diagnostica de VERSIONR: 30 s. Ni se acopla a la
 * telemetria (1 s por defecto) ni necesita un bucle propio. */
#define DIANA_VERSIONR_PERIOD_US (30ULL * 1000ULL * 1000ULL)

void diana_task_telemetry(void *arg)
{
    diana_app *a = (diana_app *)arg;
    esp_task_wdt_add(NULL);
    uint64_t last_versionr_us = 0;
    /* Arranca en true para que el PRIMER paso por el bucle anuncie el estado
     * real: el modulo arranca siempre sin hora, y un "false -> false" silencioso
     * dejaria el caso normal sin registrar. */
    bool clock_valido_anterior = true;

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

        char *buf = alloc_message_buffer();
        size_t n = buf ? diana_telemetry_json(&in, buf, DIANA_MSG_JSON_MAX) : 0;
        if (n) publish(a, a->topic_telemetry, buf, n, DIANA_TOPIC_TELEMETRY);
        free(buf);

        if (in.health.has_voltage && in.health.voltage_5v_mv < 4600) {
            diana_publish_diagnostic(a, DIANA_DIAG_LOW_VOLTAGE, DIANA_SEV_WARNING,
                                     "5V por debajo de 4,6 V");
        }

        /* VERSIONR con cadencia PROPIA y lenta, decimada dentro de la tarea de
         * telemetria. Deliberadamente NO se ata a telemetry_interval_ms, que
         * por defecto es 1000 ms: leer un registro por SPI una vez por segundo
         * seria sondeo agresivo y competiria con el trafico del driver. Es UNA
         * lectura cada DIANA_VERSIONR_PERIOD_US, por el mismo camino SPI y bajo
         * el mismo mutex. Sirve para detectar en caliente una degradacion
         * 0x04 -> 0x00 durante la endurance, invisible de otro modo. */
        /* CLOCK_VALID observable. Sin esto, "el modulo no tiene hora" solo se
         * podia deducir de que los comandos 'act' se rechazaban --- es decir,
         * por su consecuencia y no por su causa. La transicion se anuncia UNA
         * vez, para no convertir el log en un goteo. */
        {
            uint64_t epoch = a->hal.epoch_ms ? a->hal.epoch_ms(a->hal.ctx) : 0;
            bool valido = (epoch > 0);
            if (valido != clock_valido_anterior) {
                clock_valido_anterior = valido;
                if (valido)
                    ESP_LOGI(TAG, "CLOCK_VALID=true (epoch_ms=%llu): la caducidad "
                                  "de comandos ya se verifica",
                             (unsigned long long)epoch);
                else
                    ESP_LOGW(TAG, "CLOCK_VALID=false: sin hora de pared; el "
                                  "repertorio 'act' de mantenimiento se rechaza");
            }
        }

        if (now - last_versionr_us >= DIANA_VERSIONR_PERIOD_US) {
            last_versionr_us = now;
            uint8_t vr = 0;
            diana_w5500_version_class vcls = DIANA_W5500_VERSION_READ_ERROR;
            int vrc = diana_platform_eth_versionr(a->pf, &vr, &vcls);
            if (vrc == 0 && vcls == DIANA_W5500_VERSION_OK) {
                ESP_LOGI(TAG, "W5500 VERSIONR=0x%02x (%s)", (unsigned)vr,
                         diana_w5500_version_class_str(vcls));
            } else if (vrc != -1) {
                ESP_LOGW(TAG, "W5500 VERSIONR=0x%02x (%s)", (unsigned)vr,
                         diana_w5500_version_class_str(vcls));
            }
        }

        vTaskDelay(pdMS_TO_TICKS(a->cfg.telemetry_interval_ms));
    }
}
