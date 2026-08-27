/**
 * @file net_w5500.c
 * @brief Driver Ethernet W5500 por SPI: DHCP, IP estatica, deteccion de enlace
 *        y reconexion (dosier 8.3, 12.2).
 */
#include "platform_internal.h"

#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_eth_driver.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif_sntp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "diana.eth";

static void eth_event_handler(void *arg, esp_event_base_t base, int32_t id,
                              void *data)
{
    struct diana_platform *p = (struct diana_platform *)arg;
    (void)base; (void)data;

    switch (id) {
    case ETHERNET_EVENT_CONNECTED:
        p->link_up = true;
        ESP_LOGI(TAG, "enlace arriba");
        break;
    case ETHERNET_EVENT_DISCONNECTED:
        /* El enlace fisico ha caido. NO se borra la IP hasta que el netif la
         * retire: el modulo sigue funcionando y encolando (dosier 14.3). */
        p->link_up = false;
        p->has_ip = false;
        ESP_LOGW(TAG, "enlace abajo");
        break;
    case ETHERNET_EVENT_START:
        ESP_LOGI(TAG, "driver arrancado");
        break;
    case ETHERNET_EVENT_STOP:
        p->link_up = false;
        p->has_ip = false;
        break;
    default:
        break;
    }
}

/**
 * Arranca el cliente SNTP.
 *
 * NO es un adorno: desde el hallazgo H-05, la caducidad de comandos se mide
 * contra `issued_at_ms`, que es hora de PARED. Sin SNTP, epoch_ms() devuelve
 * siempre 0 y el modulo cae permanentemente en el camino degradado ("caducidad
 * no verificada, defensa por nonce"). Es decir: sin esto, la comprobacion de
 * caducidad no se ejecutaria nunca.
 *
 * El servidor NTP es el propio backend en la red local: la instalacion no tiene
 * por que tener salida a Internet.
 */
static void start_sntp(void)
{
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(CONFIG_DIANA_NTP_HOST);
    cfg.start = true;
    cfg.server_from_dhcp = true;      /* si el DHCP ofrece NTP, se usa */
    cfg.renew_servers_after_new_IP = true;
    cfg.sync_cb = NULL;

    esp_err_t err = esp_netif_sntp_init(&cfg);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        /* Sin hora, el modulo SIGUE operando: la defensa contra reproduccion
         * pasa a ser el nonce persistido, y cada comando aceptado lo declara
         * en su veredicto. No se bloquea el arranque por esto. */
        ESP_LOGW(TAG, "SNTP no disponible: la caducidad de comandos no se "
                      "podra verificar (defensa por nonce persistido)");
        return;
    }
    ESP_LOGI(TAG, "SNTP arrancado contra %s", CONFIG_DIANA_NTP_HOST);
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

    /* La hora solo puede sincronizarse cuando hay IP. */
    start_sntp();
}

int diana_pf_net_init(struct diana_platform *p)
{
    p->eth_ready = false;

    gpio_config_t cs_cfg = {
        .pin_bit_mask = (1ULL << DIANA_PIN_ETH_CS),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&cs_cfg) != ESP_OK) return -4;
    gpio_set_level(DIANA_PIN_ETH_CS, 1);

    /* RSTn del W5500 esta cableado a DIANA_PIN_ETH_RST. Se conduce desde el
     * primer instante: si el pin quedase como entrada, RSTn colgaria de una
     * linea flotante y el chip podria arrancar retenido en reset. Ese es el
     * modo de fallo que se observaba como `w5500_reset: reset timeout` (MISO
     * sin conducir, MR leido con el bit RST siempre a 1) y que solo se
     * recuperaba cortando la alimentacion del modulo a mano. */
    gpio_config_t rst_cfg = {
        .pin_bit_mask = (1ULL << DIANA_PIN_ETH_RST),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    if (gpio_config(&rst_cfg) != ESP_OK) return -5;
    gpio_set_level(DIANA_PIN_ETH_RST, 1);

    /* Pulso de reset hardware con margen sobre el datasheet del W5500, que
     * exige RSTn bajo durante al menos 500 us. No se delega en el reset_hw de
     * ESP-IDF porque solo mantiene 100 us (por debajo del minimo) y libera el
     * reset sin esperar al bloqueo del PLL antes de `mac->init`. */
    gpio_set_level(DIANA_PIN_ETH_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(5));
    gpio_set_level(DIANA_PIN_ETH_RST, 1);

    /* El modulo puede compartir la secuencia de encendido con el ESP32 o usar
     * una fuente externa. Se deja margen antes del primer acceso SPI; tambien
     * cubre de sobra el bloqueo del PLL tras soltar RSTn. */
    vTaskDelay(pdMS_TO_TICKS(1500));

    esp_err_t err = esp_netif_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "esp_netif_init fallo: %s", esp_err_to_name(err));
        return -1;
    }

    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "event loop fallo: %s", esp_err_to_name(err));
        return -2;
    }

    esp_netif_config_t cfg = ESP_NETIF_DEFAULT_ETH();
    p->netif = esp_netif_new(&cfg);
    if (!p->netif) return -3;

    /* --- bus SPI del W5500 ------------------------------------------------- */
    spi_bus_config_t buscfg = {
        .miso_io_num = DIANA_PIN_ETH_MISO,
        .mosi_io_num = DIANA_PIN_ETH_MOSI,
        .sclk_io_num = DIANA_PIN_ETH_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    err = spi_bus_initialize(DIANA_ETH_SPI_HOST, &buscfg, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "SPI W5500 no inicializado: %s", esp_err_to_name(err));
        return -4;
    }

    spi_device_interface_config_t devcfg = {
        .mode = 0,
        .clock_speed_hz = DIANA_ETH_SPI_HZ,
        .spics_io_num = DIANA_PIN_ETH_CS,
        .queue_size = 20,
    };

    eth_w5500_config_t w5500_cfg = ETH_W5500_DEFAULT_CONFIG(DIANA_ETH_SPI_HOST, &devcfg);
    /* En este modulo se usa sondeo: evita depender de la forma electrica de
     * INT y coincide con el modo estable validado contra el ejemplo oficial. */
    w5500_cfg.int_gpio_num = -1;
    w5500_cfg.poll_period_ms = 10;

    eth_mac_config_t mac_cfg = ETH_MAC_DEFAULT_CONFIG();
    eth_phy_config_t phy_cfg = ETH_PHY_DEFAULT_CONFIG();
    /* RSTn ya se ha pulsado arriba con la temporizacion del datasheet, asi que
     * el PHY no debe volver a tocarlo: el reset_hw de ESP-IDF reasertaria el
     * pin solo 100 us justo antes de `mac->init`, sin margen para el PLL. */
    phy_cfg.reset_gpio_num = -1;
    phy_cfg.autonego_timeout_ms = 5000;

    esp_eth_mac_t *mac = esp_eth_mac_new_w5500(&w5500_cfg, &mac_cfg);
    esp_eth_phy_t *phy = esp_eth_phy_new_w5500(&phy_cfg);
    if (!mac || !phy) return -8;

    esp_eth_config_t eth_cfg = ETH_DEFAULT_CONFIG(mac, phy);
    err = esp_eth_driver_install(&eth_cfg, &p->eth);
    if (err != ESP_OK) {
        p->eth = NULL;
        ESP_LOGE(TAG, "W5500 no detectado: %s", esp_err_to_name(err));
        return -9;
    }

    /* El W5500 no trae MAC de fabrica utilizable: se deriva de la eFuse del
     * ESP32-S3, que si es unica por chip (dosier 8.3 "direccion MAC unica"). */
    uint8_t mac_addr[6];
    err = esp_read_mac(mac_addr, ESP_MAC_ETH);
    if (err != ESP_OK) return -10;
    err = esp_eth_ioctl(p->eth, ETH_CMD_S_MAC_ADDR, mac_addr);
    if (err != ESP_OK) return -11;

    p->glue = esp_eth_new_netif_glue(p->eth);
    if (!p->glue) return -12;
    err = esp_netif_attach(p->netif, p->glue);
    if (err != ESP_OK) return -13;

    err = esp_event_handler_register(ETH_EVENT, ESP_EVENT_ANY_ID,
                                     eth_event_handler, p);
    if (err != ESP_OK) return -14;
    err = esp_event_handler_register(IP_EVENT, IP_EVENT_ETH_GOT_IP,
                                     got_ip_handler, p);
    if (err != ESP_OK) return -15;
    p->eth_ready = true;
    return 0;
}

int diana_platform_eth_start(struct diana_platform *p, bool use_static,
                             const char *ip, const char *netmask, const char *gw)
{
    if (!p || !p->eth_ready || !p->eth || !p->netif) return -1;

    if (use_static) {
        /* IP fija opcional (dosier 12.2). Se para el DHCP ANTES de fijarla. */
        esp_netif_dhcpc_stop(p->netif);
        esp_netif_ip_info_t info = {0};
        info.ip.addr = esp_ip4addr_aton(ip);
        info.netmask.addr = esp_ip4addr_aton(netmask);
        info.gw.addr = esp_ip4addr_aton(gw);
        if (esp_netif_set_ip_info(p->netif, &info) != ESP_OK) return -1;
        snprintf(p->ip, sizeof(p->ip), "%s", ip);
        p->has_ip = true;
    }
    return esp_eth_start(p->eth) == ESP_OK ? 0 : -1;
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
    if (!p || !p->eth_ready || !p->eth) return DIANA_HAL_ERR_GENERIC;
    /* Reconexion automatica: parar y arrancar el driver renegocia el enlace.
     * El W5500 no siempre recupera solo tras un desconectado largo. */
    esp_eth_stop(p->eth);
    return esp_eth_start(p->eth) == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;
}

bool diana_platform_eth_available(diana_platform *p)
{
    return p && p->eth_ready && p->eth;
}
