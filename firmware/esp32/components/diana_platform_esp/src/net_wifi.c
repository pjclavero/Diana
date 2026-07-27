/**
 * @file net_wifi.c
 * @brief Transporte de red por WiFi para la fase de desarrollo.
 *
 * El dosier §8.3 exige Ethernet (W5500) en produccion, por latencia y
 * fiabilidad. Este fichero NO lo sustituye: existe para poder desarrollar y
 * probar todo el firmware mientras no hay modulo W5500 fisico.
 *
 * WiFi y Ethernet desembocan en la misma pila `esp_netif`, de modo que MQTT,
 * SNTP y OTA son identicos con uno u otro. Se elige en `idf.py menuconfig`.
 *
 * IDENTIDAD: la MAC que se publica en la telemetria se deriva SIEMPRE del MAC
 * base de eFuse, no de la interfaz activa. Si dependiera de la interfaz, el
 * mismo modulo cambiaria de identidad al pasar de WiFi a Ethernet y romperia
 * la NVS, la ACL del broker y su registro en el backend.
 */
#include "platform_internal.h"

#if CONFIG_DIANA_NET_WIFI

#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"

static const char *TAG = "diana.wifi";

/* Reconexion con retroceso exponencial acotado. Sin tope, una red caida deja
 * el modulo intentandolo cada pocos ms; sin retroceso, satura el log. */
#define WIFI_RETRY_MIN_MS   1000
#define WIFI_RETRY_MAX_MS   30000

static uint32_t s_retry_ms = WIFI_RETRY_MIN_MS;

/**
 * Arranca el cliente SNTP.
 *
 * No es un adorno: la caducidad de comandos se mide contra `issued_at_ms`, que
 * es hora de PARED (hallazgo H-05). Sin SNTP, epoch_ms() devuelve 0 y el modulo
 * cae permanentemente en el camino degradado, en el que la unica defensa contra
 * reproduccion es el nonce persistido.
 */
static void start_sntp(void)
{
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(CONFIG_DIANA_NTP_HOST);
    cfg.start = true;
    cfg.server_from_dhcp = true;
    cfg.renew_servers_after_new_IP = true;
    cfg.sync_cb = NULL;

    esp_err_t err = esp_netif_sntp_init(&cfg);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "SNTP no disponible: la caducidad de comandos no se "
                      "podra verificar (defensa por nonce persistido)");
        return;
    }
    ESP_LOGI(TAG, "SNTP arrancado contra %s", CONFIG_DIANA_NTP_HOST);
}

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id,
                               void *data)
{
    struct diana_platform *p = (struct diana_platform *)arg;
    (void)base; (void)data;

    switch (id) {
    case WIFI_EVENT_STA_START:
        esp_wifi_connect();
        break;

    case WIFI_EVENT_STA_CONNECTED:
        p->link_up = true;
        s_retry_ms = WIFI_RETRY_MIN_MS;
        ESP_LOGI(TAG, "asociado al punto de acceso");
        break;

    case WIFI_EVENT_STA_DISCONNECTED:
        /* El modulo NO deja de funcionar: sigue detectando impactos y
         * encolandolos localmente (dosier 14.3). */
        p->link_up = false;
        p->has_ip = false;
        ESP_LOGW(TAG, "desasociado; reintento en %u ms", (unsigned)s_retry_ms);
        vTaskDelay(pdMS_TO_TICKS(s_retry_ms));
        s_retry_ms = (s_retry_ms * 2 > WIFI_RETRY_MAX_MS) ? WIFI_RETRY_MAX_MS
                                                          : s_retry_ms * 2;
        esp_wifi_connect();
        break;

    default:
        break;
    }
}

static void got_ip_handler(void *arg, esp_event_base_t base, int32_t id,
                           void *data)
{
    struct diana_platform *p = (struct diana_platform *)arg;
    (void)base; (void)id;
    ip_event_got_ip_t *ev = (ip_event_got_ip_t *)data;
    snprintf(p->ip, sizeof(p->ip), IPSTR, IP2STR(&ev->ip_info.ip));
    p->has_ip = true;
    ESP_LOGI(TAG, "IP %s", p->ip);

    start_sntp();   /* la hora solo puede sincronizarse con IP */
}

int diana_pf_net_init(struct diana_platform *p)
{
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    p->netif = esp_netif_create_default_wifi_sta();
    if (!p->netif) return -1;

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                               wifi_event_handler, p));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                               got_ip_handler, p));

    wifi_config_t sta = {0};
    snprintf((char *)sta.sta.ssid, sizeof(sta.sta.ssid), "%s",
             CONFIG_DIANA_WIFI_SSID);
    snprintf((char *)sta.sta.password, sizeof(sta.sta.password), "%s",
             CONFIG_DIANA_WIFI_PASS);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta));
    /* Sin ahorro de energia: dormir la radio anade latencia variable a la
     * publicacion de impactos, que es justo lo que no se puede permitir. */
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

    ESP_LOGW(TAG, "TRANSPORTE WIFI (desarrollo). El dosier 8.3 exige Ethernet "
                  "W5500 en produccion");
    return 0;
}

int diana_platform_eth_start(struct diana_platform *p, bool use_static,
                             const char *ip, const char *netmask, const char *gw)
{
    if (use_static) {
        esp_netif_dhcpc_stop(p->netif);
        esp_netif_ip_info_t info = {0};
        info.ip.addr = esp_ip4addr_aton(ip);
        info.netmask.addr = esp_ip4addr_aton(netmask);
        info.gw.addr = esp_ip4addr_aton(gw);
        ESP_ERROR_CHECK(esp_netif_set_ip_info(p->netif, &info));
        snprintf(p->ip, sizeof(p->ip), "%s", ip);
        p->has_ip = true;
    }
    return esp_wifi_start() == ESP_OK ? 0 : -1;
}

int diana_pf_net_status(void *ctx, diana_hal_net_status *out)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    out->link_up = p->link_up;
    out->has_ip = p->has_ip;
    snprintf(out->ip, sizeof(out->ip), "%s", p->has_ip ? p->ip : "");
    snprintf(out->mac, sizeof(out->mac), "%s", p->mac);
    return DIANA_HAL_OK;
}

int diana_pf_net_reconnect(void *ctx)
{
    struct diana_platform *p = (struct diana_platform *)ctx;
    (void)p;
    esp_wifi_disconnect();
    return esp_wifi_connect() == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;
}

#endif /* CONFIG_DIANA_NET_WIFI */
