/**
 * @file app_main.c
 * @brief Arranque del modulo Diana sobre ESP-IDF.
 *
 * Sigue la maquina de estados del dosier 13.3:
 *   ARRANQUE -> AUTODIAGNOSTICO -> RED -> REGISTRO -> LISTO
 */
#include "app.h"

#include <stdio.h>
#include <string.h>

#include "diana/mqtt_endpoint.h"
#include "esp_log.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "driver/gpio.h"
#include "esp32s3_proto_do_w5500.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "diana";

/* CA del broker, empotrada por EMBED_TXTFILES (main/CMakeLists.txt). El
 * enlazador anade el NUL final en la variante _txt, que es lo que esp-mqtt
 * espera en broker.verification.certificate.
 *
 * Se accede SOLO por estas dos funciones: no hay ninguna otra fuente de CA, y
 * por tanto no hay ningun camino que sustituya una CA ausente por otra cosa. */
extern const char broker_ca_pem_start[] asm("_binary_broker_ca_pem_start");
extern const char broker_ca_pem_end[]   asm("_binary_broker_ca_pem_end");

static const char *broker_ca_pem(void) { return broker_ca_pem_start; }
static size_t broker_ca_len(void)
{
    return (size_t)(broker_ca_pem_end - broker_ca_pem_start);
}

#define BYTE_TO_BINARY_PATTERN "%c%c%c%c%c%c%c%c"
#define BYTE_TO_BINARY(byte) \
    ((byte) & 0x80u ? '1' : '0'), ((byte) & 0x40u ? '1' : '0'), \
    ((byte) & 0x20u ? '1' : '0'), ((byte) & 0x10u ? '1' : '0'), \
    ((byte) & 0x08u ? '1' : '0'), ((byte) & 0x04u ? '1' : '0'), \
    ((byte) & 0x02u ? '1' : '0'), ((byte) & 0x01u ? '1' : '0')

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
    /* v1.2 · ADR-0008. Cierra CONTRACT_GAP-PROVISION-STATE-TOPIC: el estado de
     * autoridad ya tiene topico contractual y deja de quedarse sin emitir. */
    diana_topic_build(a->topic_provision_state, sizeof(a->topic_provision_state),
                      DIANA_TOPIC_PROVISION_STATE, m);
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

    /* Tension de alimentacion: no hay ADC de supervision en el perfil actual. */
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

static void print_bringup(diana_app *a)
{
    int s1 = gpio_get_level(DIANA_PIN_SELECTOR_A);
    int s2 = gpio_get_level(DIANA_PIN_SELECTOR_B);
    diana_selector_position sel = DIANA_SELECTOR_SATELITE;
    int sel_rc = diana_selector_decode(s1, s2, DIANA_SELECTOR_PROFILE, &sel);

    uint16_t raw = 0;
    diana_platform_hc165_read_raw(a->pf, &raw);
    diana_do_snapshot snap;
    diana_do_decode(raw, DIANA_DO_POLARITY, &snap);

    diana_hal_net_status net;
    a->hal.net_status(a->hal.ctx, &net);

    ESP_LOGI(TAG, "");
    ESP_LOGI(TAG, "DIANA HARDWARE BRING-UP");
    ESP_LOGI(TAG, "board: %s", DIANA_HARDWARE_REV);
    ESP_LOGI(TAG, "selector:");
    ESP_LOGI(TAG, "  GPIO15=%d", s1);
    ESP_LOGI(TAG, "  GPIO16=%d", s2);
    ESP_LOGI(TAG, "  mode=%s", sel_rc == DIANA_HAL_OK ? diana_selector_str(sel)
                                                       : "INVALID_SELECTOR");
    ESP_LOGI(TAG, "identify: %s", a->hal.button_pressed(a->hal.ctx) ? "LOW" : "HIGH");
    ESP_LOGI(TAG, "HC165 RAW: 0b" BYTE_TO_BINARY_PATTERN BYTE_TO_BINARY_PATTERN,
             BYTE_TO_BINARY((uint8_t)(raw >> 8)), BYTE_TO_BINARY((uint8_t)raw));
    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
        ESP_LOGI(TAG, "D%u: %u", (unsigned)(i + 1u),
                 (unsigned)((snap.active_bitmap >> i) & 1u));
    }
    ESP_LOGI(TAG, "Ethernet:");
    ESP_LOGI(TAG, "  W5500 SPI=%s",
             diana_platform_eth_available(a->pf) ? "OK" : "FAIL");
    ESP_LOGI(TAG, "  LINK=%s", net.link_up ? "UP" : "DOWN");
    ESP_LOGI(TAG, "  IP=%s", net.has_ip ? net.ip : "0.0.0.0");
    ESP_LOGI(TAG, "LED:");
    ESP_LOGI(TAG, "  ROW1=NOT_TESTED");
    ESP_LOGI(TAG, "  ROW2=NOT_TESTED");
    ESP_LOGI(TAG, "  ROW3=NOT_TESTED");
}

static void fill_leds(diana_app *a, uint8_t r, uint8_t g, uint8_t b)
{
    diana_hal_rgb px[DIANA_LEDS_PER_CHAIN];
    for (uint8_t i = 0; i < DIANA_LEDS_PER_CHAIN; ++i)
        px[i] = (diana_hal_rgb){r, g, b};
    for (uint8_t c = 0; c < DIANA_LED_CHAINS; ++c)
        a->hal.led_write(a->hal.ctx, c, px, DIANA_LEDS_PER_CHAIN);
    diana_platform_led_refresh(a->pf);
}

static void fill_led_target(diana_app *a, uint8_t target, uint8_t r, uint8_t g,
                            uint8_t b)
{
    if (target >= DIANA_TARGET_COUNT) return;

    diana_hal_rgb px[DIANA_LEDS_PER_CHAIN];
    for (uint8_t i = 0; i < DIANA_LEDS_PER_CHAIN; ++i)
        px[i] = (diana_hal_rgb){0, 0, 0};

    for (uint8_t c = 0; c < DIANA_LED_CHAINS; ++c)
        a->hal.led_write(a->hal.ctx, c, px, DIANA_LEDS_PER_CHAIN);

    uint8_t chain = target / 3u;
    uint8_t slot = target % 3u;
    size_t first = (size_t)slot * DIANA_LEDS_PER_TARGET;
    size_t last = first + DIANA_LEDS_PER_TARGET;
    if (last > DIANA_LEDS_PER_CHAIN) last = DIANA_LEDS_PER_CHAIN;
    for (size_t i = first; i < last; ++i)
        px[i] = (diana_hal_rgb){r, g, b};

    a->hal.led_write(a->hal.ctx, chain, px, DIANA_LEDS_PER_CHAIN);
    diana_platform_led_refresh(a->pf);
}

static void bringup_led_test(diana_app *a)
{
    fill_leds(a, 0, 0, 0);
    static const diana_hal_rgb colors[3] = {
        {32, 0, 0},
        {0, 0, 32},
        {0, 32, 0},
    };
    for (uint8_t target = 0; target < DIANA_TARGET_COUNT; ++target) {
        diana_hal_rgb color = colors[target % 3u];
        ESP_LOGI(TAG, "LED TEST: D%u", (unsigned)(target + 1u));
        fill_led_target(a, target, color.r, color.g, color.b);
        vTaskDelay(pdMS_TO_TICKS(700));
    }
    fill_leds(a, 0, 0, 0);
    ESP_LOGI(TAG, "LED TEST: fin");
}

static void enable_bench_hit_led_test(diana_app *a)
{
#if CONFIG_DIANA_BENCH_HIT_LED_TEST
    uint64_t now = a->hal.now_us(a->hal.ctx);
    for (uint8_t i = 0; i < 3; ++i) {
        diana_target_apply(&a->targets.t[i], DIANA_TEV_ENABLE, now);
        diana_target_apply(&a->targets.t[i], DIANA_TEV_ARM, now);
    }
    ESP_LOGW(TAG, "MODO BANCO: D1-D3 activas; golpe aceptado -> aro verde");
#else
    (void)a;
#endif
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
    bool identity_ready =
        diana_identity_load(&a->id, &a->hal, DIANA_FIRMWARE_VERSION) == DIANA_HAL_OK;
    if (!identity_ready) {
        /* Sin aprovisionar: no se inventa un module_id. El modulo se queda en
         * error visible y espera aprovisionamiento por consola. */
        ESP_LOGE(TAG, "modulo SIN aprovisionar: falta module_id en NVS");
        diana_module_fsm_apply(&a->fsm, DIANA_EV_ERROR_RAISED,
                               a->hal.now_us(a->hal.ctx));
    }
    diana_config_load(&a->cfg, &a->hal);

    /* D1b · autoridad DEVICE_MANAGEMENT. Va DESPUES de cargar identidad y
     * configuracion porque necesita module_id y system_id. Sin root_key en NVS
     * el contexto queda en FALLO CERRADO y toda credencial se rechaza: es el
     * comportamiento correcto mientras no exista el utillaje de fabrica. */
    diana_prov_app_init(a);
    diana_queue_init(&a->queue, &a->hal, DIANA_QUEUE_DROP_OLDEST);
    diana_ota_init(&a->ota, &a->hal, DIANA_BOARD_NAME, DIANA_FIRMWARE_VERSION,
                   DIANA_OTA_CONFIRM_WINDOW_MS);
    build_topics(a);
    print_bringup(a);
    bringup_led_test(a);

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
    enable_bench_hit_led_test(a);

    /* --- RED --- */
    bool use_static = (a->cfg.network.mode == DIANA_NET_STATIC);
    if (diana_platform_eth_available(a->pf)) {
        diana_platform_eth_start(a->pf, use_static, a->cfg.network.ip,
                                 a->cfg.network.netmask, a->cfg.network.gateway);

        if (identity_ready) {
            /* Last Will registrado ANTES de conectar (contrato §3). */
            char lwt[256];
            diana_presence_lwt_json(a->id.module_id, lwt, sizeof(lwt));

            /* ===============================================================
             * IDENTIDAD (contrato mqtt/README §8, hallazgo F-02 CERRADO)
             * ===============================================================
             * El usuario MQTT es EXACTAMENTE el module_id, literal. El
             * client_id tambien lo es, y ademas el broker lo reescribe con el
             * usuario autenticado (use_username_as_clientid), de modo que la
             * ACL no depende de un valor que elija el cliente.
             *
             * Aqui habia un `snprintf(user, ..., "module-%s", module_id)` con
             * un comentario que afirmaba que el contrato fijaba ese prefijo.
             * Era falso: los module_id reales YA son "module-01".."module-09"
             * (infrastructure/mosquitto/identities.json), asi que aquello
             * producia "module-module-01", un usuario que no existe ni en
             * users.generated.txt ni en el acl. El modulo no habria podido
             * autenticarse nunca. El prefijo se retiro al cerrar F-02 y NO se
             * revierte: el sintoma no avisa.
             *
             * La construccion vive ahora en diana_core (diana_mqtt_username)
             * porque este fichero no lo compila ninguna prueba. La coherencia
             * con identities.json y con el acl la comprueba, ejecutandola,
             * test_host/tests/test_mqtt_endpoint.c. */
            char user[DIANA_MQTT_USER_MAXLEN];
            int uid_rc = diana_mqtt_username(a->id.module_id, user, sizeof(user));

            /* ===============================================================
             * TRANSPORTE (P0-2) · TLS, puerto configurable, FALLO CERRADO
             * ===============================================================
             * El esquema lo decide SOLO el perfil de compilacion. No existe
             * ninguna rama que lleve a mqtt:// por un error en ejecucion: si la
             * CA falta o no es valida, el modulo se queda sin MQTT y lo dice.
             * Sustituir esto por un reintento en claro reabre P0-2. */
            diana_mqtt_transport transport = DIANA_MQTT_TRANSPORT_TLS;
#if CONFIG_DIANA_MQTT_INSECURE_LAB
            transport = DIANA_MQTT_TRANSPORT_INSECURE_LAB;
            ESP_LOGW(TAG, "############################################################");
            ESP_LOGW(TAG, "# PERFIL DE LABORATORIO: MQTT EN CLARO, SIN TLS Y SIN      #");
            ESP_LOGW(TAG, "# VERIFICAR AL BROKER. Credenciales y trafico expuestos.   #");
            ESP_LOGW(TAG, "# Desactiva DIANA_MQTT_INSECURE_LAB para operar de verdad. #");
            ESP_LOGW(TAG, "############################################################");
#endif
            const char *ca_pem = broker_ca_pem();
            size_t ca_len = broker_ca_len();

            char uri[DIANA_MQTT_URI_MAXLEN];
            int uri_rc = diana_mqtt_uri(CONFIG_DIANA_BROKER_HOST,
                                        (uint16_t)CONFIG_DIANA_BROKER_PORT,
                                        transport, uri, sizeof(uri));

            if (uid_rc != DIANA_MQTT_OK) {
                ESP_LOGE(TAG, "module_id no utilizable como usuario MQTT: sin conexion");
            } else if (uri_rc != DIANA_MQTT_OK) {
                ESP_LOGE(TAG, "host/puerto del broker invalidos: sin conexion");
            } else if (!diana_mqtt_may_connect(transport, ca_pem, ca_len,
                                               a->id.module_id)) {
                /* Unica salida cuando falta la CA. Sin alternativa por diseno. */
                ESP_LOGE(TAG, "CA del broker ausente o invalida: MQTT NO se arranca");
                ESP_LOGE(TAG, "revisa main/certs/broker_ca.pem (P0-2)");
                diana_module_fsm_apply(&a->fsm, DIANA_EV_ERROR_RAISED,
                                       a->hal.now_us(a->hal.ctx));
            } else {
                ESP_LOGI(TAG, "broker %s, usuario '%s'", uri, user);
                diana_platform_mqtt_start(a->pf, a->id.module_id, uri, user,
                                          a->id.mqtt_pass, ca_pem, ca_len,
                                          a->topic_presence, lwt);
                diana_platform_mqtt_subscribe(a->pf, a->id.module_id);
            }
        } else {
            ESP_LOGW(TAG, "MQTT deshabilitado hasta aprovisionar module_id");
        }
    } else {
        ESP_LOGW(TAG, "red deshabilitada: W5500 no responde");
    }

    /* --- Tareas (dosier 13.2) --- */
    xTaskCreatePinnedToCore(diana_task_sensors,   "diana_sens", 16384, a, 10, NULL, 1);
    xTaskCreatePinnedToCore(diana_task_inputs,    "diana_in",    3072, a,  5, NULL, 1);
    xTaskCreatePinnedToCore(diana_task_leds,      "diana_led",  4096, a,  4, NULL, 1);
    xTaskCreatePinnedToCore(diana_task_network,   "diana_net",  8192, a,  6, NULL, 0);
    xTaskCreatePinnedToCore(diana_task_telemetry, "diana_tlm",  8192, a,  3, NULL, 0);

    /* Si esta imagen viene de una OTA, se marca valida solo despues de que las
     * tareas hayan arrancado: si algo falla antes, el bootloader revierte. */
    vTaskDelay(pdMS_TO_TICKS(5000));
    if (diana_pf_ota_mark_valid() == DIANA_HAL_OK)
        ESP_LOGI(TAG, "imagen confirmada: rollback automatico cancelado");
}
