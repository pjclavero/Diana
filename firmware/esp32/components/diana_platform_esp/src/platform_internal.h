/**
 * @file platform_internal.h
 * @brief Estado compartido entre los ficheros de la plataforma ESP.
 */
#ifndef DIANA_PLATFORM_INTERNAL_H
#define DIANA_PLATFORM_INTERNAL_H

#include "diana/platform_esp.h"

#include "esp_adc/adc_oneshot.h"
#include "esp_netif.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "led_strip.h"
#include "mqtt_client.h"

#if CONFIG_DIANA_NET_ETH_W5500
#include "esp_eth.h"
#endif

/* Selecciona el pinout segun la placa configurada. Ningun fichero incluye un
 * header de placa concreto. */
#include "diana_board.h"

struct diana_platform {
    /* red */
#if CONFIG_DIANA_NET_ETH_W5500
    esp_eth_handle_t   eth;
    esp_eth_netif_glue_handle_t glue;
#endif
    esp_netif_t       *netif;
    volatile bool      link_up;
    volatile bool      has_ip;
    char               ip[16];
    char               mac[18];

    /* mqtt */
    esp_mqtt_client_handle_t mqtt;
    volatile bool      mqtt_connected;
    volatile uint32_t  mqtt_reconnects;
    QueueHandle_t      rx_queue;

    /* piezo */
    QueueHandle_t      trigger_queue;
    adc_oneshot_unit_handle_t adc;
    SemaphoreHandle_t  adc_lock;

    /* led */
    led_strip_handle_t strip[DIANA_LED_CHAINS];
    diana_hal_rgb      pixels[DIANA_LED_CHAINS][DIANA_LEDS_PER_CHAIN];

    /* cola de eventos en la particion 'evtqueue' */
    const void        *evt_partition;   /* esp_partition_t* */
    SemaphoreHandle_t  evt_lock;
    uint32_t           evt_head_off;
    uint32_t           evt_tail_off;
    size_t             evt_count;
    size_t             evt_capacity;

    /* diagnostico */
    int                reset_reason;
    uint32_t           min_free_heap;
};

/* Inicializadores por subsistema. Todos devuelven 0 en exito. */
int diana_pf_nvs_init(void);
int diana_pf_queue_init(struct diana_platform *p);
int diana_pf_piezo_init(struct diana_platform *p);
int diana_pf_leds_init(struct diana_platform *p);
int diana_pf_inputs_init(void);
int diana_pf_net_init(struct diana_platform *p);

/* Operaciones del HAL implementadas en cada fichero. */
int  diana_pf_kv_get(void *ctx, const char *ns, const char *key, void *out,
                     size_t out_size, size_t *out_len);
int  diana_pf_kv_set(void *ctx, const char *ns, const char *key,
                     const void *data, size_t len);
int  diana_pf_kv_erase(void *ctx, const char *ns, const char *key);

int    diana_pf_q_push(void *ctx, const void *data, size_t len);
int    diana_pf_q_peek(void *ctx, size_t index, void *out, size_t out_size,
                       size_t *out_len);
int    diana_pf_q_pop(void *ctx);
size_t diana_pf_q_count(void *ctx);
size_t diana_pf_q_capacity(void *ctx);

int  diana_pf_piezo_amplitude(void *ctx, uint8_t channel, uint16_t *out);
int  diana_pf_led_write(void *ctx, uint8_t chain, const diana_hal_rgb *px,
                        size_t count);
int  diana_pf_selector_read(void *ctx, int *out);
bool diana_pf_button_pressed(void *ctx);

int  diana_pf_net_status(void *ctx, diana_hal_net_status *out);
int  diana_pf_net_reconnect(void *ctx);
int  diana_pf_mqtt_publish(void *ctx, const diana_hal_mqtt_msg *msg);
bool diana_pf_mqtt_connected(void *ctx);

int  diana_pf_ota_verify_signature(void *ctx, const uint8_t *image, size_t len,
                                   const char *signature_b64);
int  diana_pf_ota_activate(void *ctx);
int  diana_pf_ota_rollback(void *ctx);

int  diana_pf_adc_read_mv(struct diana_platform *p, int channel, int *out_mv);

#endif /* DIANA_PLATFORM_INTERNAL_H */
