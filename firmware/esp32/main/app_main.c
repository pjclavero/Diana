/**
 * @file app_main.c
 * @brief Arranque del modulo Diana. NO COMPILADO (falta ESP-IDF).
 *
 * Sigue la maquina de estados del dosier 13.3:
 *   ARRANQUE -> AUTODIAGNOSTICO -> RED -> REGISTRO -> LISTO
 */
#include "app.h"

#include <string.h>

#include "esp_log.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "diana";

diana_app g_app;

extern int diana_pf_ota_mark_valid(void);

static void build_topics(diana_app *a)
{
    const char *m = a->id.module_id;
    diana_topic_build(a->topic_hit, sizeof(a->topic_hit), DIANA_TOPIC_HIT, m);
    diana_topic_build(a->topic_presence, sizeof(a->topic_presence),
                      DIANA_TOPIC_PRESENCE, m);
    diana_topic_build(a->topic_status, sizeof(a->topic_status),
                      DIANA_TOPIC_STATUS, m);
    diana_topic_build(a->topic_telemetry, sizeof(a->topic_telemetry),
                      DIANA_TOPIC_TELEMETRY, m);
    diana_topic_build(a->topic_diagnostic, sizeof(a->topic_diagnostic),
                      DIANA_TOPIC_DIAGNOSTIC, m);
    diana_topic_build(a->topic_config_reported, sizeof(a->topic_config_reported),
                      DIANA_TOPIC_CONFIG_REPORTED, m);
}

/** Autodiagnostico: comprueba lo que se puede comprobar sin disparar. */
static bool selftest(diana_app *a)
{
    bool ok = true;

    /* Selector: si devuelve error, el cableado esta mal. */
    int sel = 0;
    if (a->hal.selector_read(a->hal.ctx, &sel) != DIANA_HAL_OK) {
        diana_publish_diagnostic(a, DIANA_DIAG_SELF_TEST_RESULT, DIANA_SEV_ERROR,
                                 "selector en estado imposible");
        ok = false;
    }
    a->selector = (diana_selector_position)sel;
    a->role = diana_role_from_selector(a->selector);

    /* Piezos: la envolvente en reposo debe estar cerca del ruido base. Una
     * lectura saturada indica canal averiado o piezo desconectado. */
    for (uint8_t ch = 0; ch < DIANA_TARGET_COUNT; ++ch) {
        uint16_t amp = 0;
        if (a->hal.piezo_amplitude(a->hal.ctx, ch, &amp) != DIANA_HAL_OK) {
            diana_target_apply(&a->targets.t[ch], DIANA_TEV_SENSOR_FAULT, 0);
            ok = false;
            continue;
        }
        const diana_target_calibration *cal =
            diana_config_cal(&a->cfg, (uint8_t)(ch + 1));
        if (cal && amp > cal->threshold) {
            /* En reposo no deberia superarse el umbral. */
            char msg[DIANA_MESSAGE_MAXLEN];
            snprintf(msg, sizeof(msg),
                     "canal %u en reposo lee %u, por encima del umbral %u",
                     (unsigned)(ch + 1), (unsigned)amp, (unsigned)cal->threshold);
            diana_publish_diagnostic(a, DIANA_DIAG_SENSOR_ERROR,
                                     DIANA_SEV_WARNING, msg);
            diana_target_apply(&a->targets.t[ch], DIANA_TEV_SENSOR_FAULT, 0);
            ok = false;
        }
    }

    /* Tension de alimentacion. */
    diana_hal_health h;
    if (a->hal.health(a->hal.ctx, &h) == DIANA_HAL_OK && h.has_voltage) {
        if (h.voltage_5v_mv < 4600) {
            char msg[DIANA_MESSAGE_MAXLEN];
            snprintf(msg, sizeof(msg), "5V bajo en arranque: %u mV",
                     (unsigned)h.voltage_5v_mv);
            diana_publish_diagnostic(a, DIANA_DIAG_LOW_VOLTAGE, DIANA_SEV_WARNING,
                                     msg);
        }
    }
    return ok;
}

void app_main(void)
{
    diana_app *a = &g_app;
    memset(a, 0, sizeof(*a));

    ESP_LOGI(TAG, "Diana firmware %s arrancando", DIANA_FIRMWARE_VERSION);

    if (diana_platform_init(&a->pf, &a->hal) != 0) {
        ESP_LOGE(TAG, "fallo al inicializar la plataforma");
        vTaskDelay(pdMS_TO_TICKS(5000));
        esp_restart();
    }

    a->boot_us = a->hal.now_us(a->hal.ctx);
    diana_module_fsm_init(&a->fsm, a->boot_us);
    diana_target_set_init(&a->targets, a->boot_us);
    diana_sensor_state_init(&a->sensors);
    /* El guardian carga de NVS el ultimo nonce por emisor: sin eso, cada
     * reinicio reabriria la ventana de reproduccion (H-05 b). */
    diana_command_guard_init(&a->guard, &a->hal);

    /* Identidad: boot_id nuevo, local_sequence reservada (ADR-0003). */
    if (diana_identity_load(&a->id, &a->hal, DIANA_FIRMWARE_VERSION) != DIANA_HAL_OK) {
        /* Sin aprovisionar: no se inventa un module_id. El modulo se queda en
         * error visible y espera aprovisionamiento por consola. */
        ESP_LOGE(TAG, "modulo SIN aprovisionar: falta module_id en NVS");
        diana_module_fsm_apply(&a->fsm, DIANA_EV_ERROR_RAISED,
                               a->hal.now_us(a->hal.ctx));
    }
    diana_config_load(&a->cfg, &a->hal);
    diana_queue_init(&a->queue, &a->hal, DIANA_QUEUE_DROP_OLDEST);
    diana_ota_init(&a->ota, &a->hal, DIANA_BOARD_NAME, DIANA_FIRMWARE_VERSION,
                   DIANA_OTA_CONFIRM_WINDOW_MS);
    build_topics(a);

    /* Causa del reinicio anterior, siempre registrada (dosier 8.2). */
    {
        char msg[DIANA_MESSAGE_MAXLEN];
        snprintf(msg, sizeof(msg), "arranque; causa del reinicio anterior: %s",
                 diana_reset_reason_str(a->id.reset_reason));
        ESP_LOGI(TAG, "%s", msg);
    }

    /* --- AUTODIAGNOSTICO --- */
    diana_module_fsm_apply(&a->fsm, DIANA_EV_SELFTEST_START,
                           a->hal.now_us(a->hal.ctx));
    bool st_ok = selftest(a);
    diana_module_fsm_apply(&a->fsm,
                           st_ok ? DIANA_EV_SELFTEST_OK : DIANA_EV_SELFTEST_FAIL,
                           a->hal.now_us(a->hal.ctx));

    /* --- RED --- */
    bool use_static = (a->cfg.network.mode == DIANA_NET_STATIC);
    diana_platform_eth_start(a->pf, use_static, a->cfg.network.ip,
                             a->cfg.network.netmask, a->cfg.network.gateway);

    /* Last Will registrado ANTES de conectar (contrato §3). */
    char lwt[256];
    diana_presence_lwt_json(a->id.module_id, lwt, sizeof(lwt));

    char uri[128], user[80];
    snprintf(uri, sizeof(uri), "mqtt://%s:1883", CONFIG_DIANA_BROKER_HOST);
    /* Usuario 'module-{id}', client_id '{id}' a secas: son cosas distintas y el
     * contrato §8 fija ambas. La ACL depende de la segunda. */
    snprintf(user, sizeof(user), "module-%s", a->id.module_id);
    diana_platform_mqtt_start(a->pf, a->id.module_id, uri, user, a->id.mqtt_pass,
                              a->topic_presence, lwt);
    diana_platform_mqtt_subscribe(a->pf, a->id.module_id);

    /* --- Tareas (dosier 13.2) --- */
    xTaskCreatePinnedToCore(diana_task_sensors,   "diana_sens", 4096, a, 10, NULL, 1);
    xTaskCreatePinnedToCore(diana_task_leds,      "diana_led",  4096, a,  4, NULL, 1);
    xTaskCreatePinnedToCore(diana_task_network,   "diana_net",  8192, a,  6, NULL, 0);
    xTaskCreatePinnedToCore(diana_task_telemetry, "diana_tlm",  4096, a,  3, NULL, 0);

    /* Si esta imagen viene de una OTA, se marca valida solo despues de que las
     * tareas hayan arrancado: si algo falla antes, el bootloader revierte. */
    vTaskDelay(pdMS_TO_TICKS(5000));
    if (diana_pf_ota_mark_valid() == DIANA_HAL_OK)
        ESP_LOGI(TAG, "imagen confirmada: rollback automatico cancelado");
}
