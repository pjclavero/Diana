/**
 * @file hal_esp32.c
 * @brief Cableado de la tabla del HAL a la implementacion ESP-IDF.
 *        NO COMPILADO: ver diana/platform_esp.h.
 */
#include "platform_internal.h"

#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include <sys/time.h>

static const char *TAG = "diana.hal";

static struct diana_platform s_platform;

/* --- tiempo ---------------------------------------------------------------- */

/* esp_timer_get_time() es monotonico desde el arranque y tiene resolucion de
 * 1 us: es la unica fuente valida para T1 (ADR-0002). No se usan ticks de
 * FreeRTOS (resolucion de 1 ms) ni hora de pared. */
static uint64_t pf_now_us(void *ctx)
{
    (void)ctx;
    return (uint64_t)esp_timer_get_time();
}

/* Hora de pared: solo si se ha sincronizado por SNTP. 0 = no disponible.
 * Nunca sustituye a event_us. */
static uint64_t pf_epoch_ms(void *ctx)
{
    (void)ctx;
    struct timeval tv;
    if (gettimeofday(&tv, NULL) != 0) return 0;
    if (tv.tv_sec < 1600000000) return 0;   /* reloj sin sincronizar */
    return (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)(tv.tv_usec / 1000);
}

static void pf_random(void *ctx, uint8_t *buf, size_t len)
{
    (void)ctx;
    esp_fill_random(buf, len);   /* RNG hardware */
}

/* --- diagnostico ----------------------------------------------------------- */

static int pf_reset_reason(void *ctx)
{
    (void)ctx;
    switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return DIANA_RESET_POWERON;
    case ESP_RST_SW:       return DIANA_RESET_SOFTWARE;
    case ESP_RST_PANIC:    return DIANA_RESET_PANIC;
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return DIANA_RESET_WATCHDOG;
    case ESP_RST_BROWNOUT: return DIANA_RESET_BROWNOUT;
    default:               return DIANA_RESET_UNKNOWN;
    }
}

static int pf_watchdog_feed(void *ctx)
{
    (void)ctx;
    return esp_task_wdt_reset() == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;
}

static int pf_reboot(void *ctx)
{
    (void)ctx;
    ESP_LOGW(TAG, "reinicio solicitado");
    esp_restart();
    return DIANA_HAL_OK;   /* inalcanzable */
}

static int pf_health(void *ctx, diana_hal_health *out)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    memset(out, 0, sizeof(*out));
    out->free_heap_bytes = (uint32_t)esp_get_free_heap_size();
    out->min_free_heap_bytes = (uint32_t)esp_get_minimum_free_heap_size();
    /* Sin contador de ociosidad instrumentado todavia: se reporta 0 en vez de
     * inventar una cifra. */
    out->cpu_load_pct = 0.0f;

    /* El ESP32-S3 tiene sensor de temperatura interno; mide el DIE, no el
     * ambiente del modulo. Se marca como disponible pero su interpretacion
     * queda pendiente de correlacion en banco. */
    out->has_temperature = false;

    int mv5 = 0, mv12 = 0;
    if (diana_pf_adc_read_mv(p, DIANA_ADC_CH_V5, &mv5) == DIANA_HAL_OK &&
        diana_pf_adc_read_mv(p, DIANA_ADC_CH_V12, &mv12) == DIANA_HAL_OK) {
        out->has_voltage = true;
        out->voltage_5v_mv = (uint32_t)mv5 * DIANA_VDIV_5V_NUM / DIANA_VDIV_5V_DEN;
        out->voltage_12v_mv = (uint32_t)mv12 * DIANA_VDIV_12V_NUM / DIANA_VDIV_12V_DEN;
    }
    return DIANA_HAL_OK;
}

static void pf_log(void *ctx, int level, const char *tag, const char *msg)
{
    (void)ctx;
    switch (level) {
    case 0:  ESP_LOGE(tag, "%s", msg); break;
    case 1:  ESP_LOGW(tag, "%s", msg); break;
    default: ESP_LOGI(tag, "%s", msg); break;
    }
}

/* --- init ------------------------------------------------------------------ */

int diana_platform_init(diana_platform **out, diana_hal *hal)
{
    struct diana_platform *p = &s_platform;
    memset(p, 0, sizeof(*p));
    p->reset_reason = pf_reset_reason(NULL);

    if (diana_pf_nvs_init() != 0) return -1;
    if (diana_pf_queue_init(p) != 0) return -2;
    if (diana_pf_piezo_init(p) != 0) return -3;
    if (diana_pf_leds_init(p) != 0) return -4;
    if (diana_pf_inputs_init() != 0) return -5;
    if (diana_pf_net_init(p) != 0) return -6;

    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_ETH);
    snprintf(p->mac, sizeof(p->mac), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    memset(hal, 0, sizeof(*hal));
    hal->ctx = p;
    hal->now_us = pf_now_us;
    hal->epoch_ms = pf_epoch_ms;
    hal->random_bytes = pf_random;

    hal->kv_get = diana_pf_kv_get;
    hal->kv_set = diana_pf_kv_set;
    hal->kv_erase = diana_pf_kv_erase;

    hal->q_push = diana_pf_q_push;
    hal->q_peek = diana_pf_q_peek;
    hal->q_pop = diana_pf_q_pop;
    hal->q_count = diana_pf_q_count;
    hal->q_capacity = diana_pf_q_capacity;

    hal->net_status = diana_pf_net_status;
    hal->net_reconnect = diana_pf_net_reconnect;
    hal->mqtt_publish = diana_pf_mqtt_publish;
    hal->mqtt_connected = diana_pf_mqtt_connected;

    hal->piezo_amplitude = diana_pf_piezo_amplitude;
    hal->led_write = diana_pf_led_write;
    hal->selector_read = diana_pf_selector_read;
    hal->button_pressed = diana_pf_button_pressed;

    hal->reset_reason = pf_reset_reason;
    hal->watchdog_feed = pf_watchdog_feed;
    hal->reboot = pf_reboot;
    hal->health = pf_health;

    hal->ota_verify_signature = diana_pf_ota_verify_signature;
    hal->ota_activate = diana_pf_ota_activate;
    hal->ota_rollback = diana_pf_ota_rollback;

    hal->log = pf_log;

    *out = p;
    return 0;
}
