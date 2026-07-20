/**
 * @file mqtt_client.c
 * @brief Cliente MQTT con Last Will EXACTAMENTE como manda el contrato §3.
 *        NO COMPILADO.
 */
#include "platform_internal.h"

#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "diana.mqtt";

static void mqtt_event_handler(void *arg, esp_event_base_t base, int32_t id,
                               void *data)
{
    struct diana_platform *p = (struct diana_platform *)arg;
    esp_mqtt_event_handle_t ev = (esp_mqtt_event_handle_t)data;
    (void)base; (void)id;

    switch (ev->event_id) {
    case MQTT_EVENT_CONNECTED:
        p->mqtt_connected = true;
        p->mqtt_reconnects++;
        ESP_LOGI(TAG, "conectado al broker");
        break;

    case MQTT_EVENT_DISCONNECTED:
        p->mqtt_connected = false;
        ESP_LOGW(TAG, "desconectado del broker");
        break;

    case MQTT_EVENT_DATA: {
        /* El instante de recepcion se toma con el reloj MONOTONICO: es la base
         * de la caducidad por expires_in_ms (contrato §6). No se usa la hora de
         * pared, que puede no estar sincronizada. */
        diana_platform_rx rx;
        memset(&rx, 0, sizeof(rx));
        rx.recv_us = (uint64_t)esp_timer_get_time();

        size_t tlen = (size_t)ev->topic_len;
        if (tlen >= sizeof(rx.topic)) tlen = sizeof(rx.topic) - 1;
        memcpy(rx.topic, ev->topic, tlen);
        rx.topic[tlen] = '\0';

        /* Un payload que no cabe se DESCARTA y se registra: truncarlo produciria
         * JSON invalido y un rechazo confuso aguas abajo. */
        if ((size_t)ev->total_data_len >= sizeof(rx.payload)) {
            ESP_LOGE(TAG, "payload de %d bytes descartado en %s",
                     ev->total_data_len, rx.topic);
            break;
        }
        memcpy(rx.payload, ev->data, (size_t)ev->data_len);
        rx.payload[ev->data_len] = '\0';
        rx.payload_len = (size_t)ev->data_len;

        if (xQueueSend(p->rx_queue, &rx, 0) != pdTRUE)
            ESP_LOGW(TAG, "cola de recepcion llena: mensaje perdido");
        break;
    }

    case MQTT_EVENT_ERROR:
        ESP_LOGE(TAG, "error de transporte MQTT");
        break;

    default:
        break;
    }
}

int diana_platform_mqtt_start(struct diana_platform *p, const char *client_id,
                              const char *uri, const char *user, const char *pass,
                              const char *lwt_topic, const char *lwt_payload)
{
    p->rx_queue = xQueueCreate(16, sizeof(diana_platform_rx));
    if (!p->rx_queue) return -1;

    esp_mqtt_client_config_t cfg = {0};
    cfg.broker.address.uri = uri;
    cfg.credentials.username = user;
    cfg.credentials.authentication.password = pass;

    /* client_id == module_id, sin prefijo (contrato §8). La ACL de Mosquitto
     * usa el patron %c para acotar cada modulo a su propio subarbol: si el
     * client_id no coincide exactamente con el module_id, el broker denegara
     * todas las publicaciones del modulo. NO se deja el valor por defecto de
     * esp-mqtt ('ESP32_xxxxxx'), que rompería la ACL. */
    cfg.credentials.client_id = client_id;
    cfg.credentials.set_null_client_id = false;

    /* Last Will: contrato §3. QoS 1, retain=true, payload con online=false y
     * reason=lwt. Se registra en CONNECT, antes de cualquier publicacion. */
    cfg.session.last_will.topic = lwt_topic;
    cfg.session.last_will.msg = lwt_payload;
    cfg.session.last_will.msg_len = (int)strlen(lwt_payload);
    cfg.session.last_will.qos = 1;
    cfg.session.last_will.retain = 1;

    /* Sesion persistente: el broker conserva las suscripciones y los mensajes
     * QoS 1 pendientes entre reconexiones. */
    cfg.session.disable_clean_session = true;
    cfg.session.keepalive = 30;
    cfg.network.reconnect_timeout_ms = 2000;
    cfg.network.disable_auto_reconnect = false;

    p->mqtt = esp_mqtt_client_init(&cfg);
    if (!p->mqtt) return -2;

    ESP_ERROR_CHECK(esp_mqtt_client_register_event(p->mqtt, ESP_EVENT_ANY_ID,
                                                   mqtt_event_handler, p));
    return esp_mqtt_client_start(p->mqtt) == ESP_OK ? 0 : -3;
}

int diana_platform_mqtt_subscribe(struct diana_platform *p, const char *module_id)
{
    char topic[DIANA_TOPIC_MAXLEN];
    static const char *const suffixes[] = {
        "command", "config/desired", "ota",
    };
    for (size_t i = 0; i < sizeof(suffixes) / sizeof(suffixes[0]); ++i) {
        snprintf(topic, sizeof(topic), "targets/v1/module/%s/%s", module_id,
                 suffixes[i]);
        if (esp_mqtt_client_subscribe(p->mqtt, topic, 1) < 0) return -1;
    }
    /* Estado de partida publicado por el principal (ACL: solo lectura). */
    if (esp_mqtt_client_subscribe(p->mqtt, "targets/v1/system/+/game/state", 1) < 0)
        return -1;
    return 0;
}

bool diana_platform_rx_pop(struct diana_platform *p, diana_platform_rx *out,
                           uint32_t timeout_ms)
{
    if (!p->rx_queue) return false;
    return xQueueReceive(p->rx_queue, out, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}

int diana_pf_mqtt_publish(void *ctx, const diana_hal_mqtt_msg *msg)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    if (!p->mqtt || !p->mqtt_connected) return DIANA_HAL_ERR_GENERIC;

    int id = esp_mqtt_client_publish(p->mqtt, msg->topic, (const char *)msg->payload,
                                     (int)msg->payload_len, msg->qos,
                                     msg->retain ? 1 : 0);
    /* Un id negativo significa que el cliente no lo ha aceptado: el core lo
     * encolara localmente. Con QoS 1 un id >= 0 significa entregado al cliente,
     * no confirmado por el broker; la confirmacion real la da el PUBACK. */
    return id < 0 ? DIANA_HAL_ERR_GENERIC : id;
}

bool diana_pf_mqtt_connected(void *ctx)
{
    return ((struct diana_platform *)ctx)->mqtt_connected;
}
