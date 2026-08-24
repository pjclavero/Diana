#include <inttypes.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_eth_driver.h"
#include "esp_eth_mac_spi.h"
#include "esp_eth_netif_glue.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define ETH_CS_GPIO      10
#define ETH_MOSI_GPIO    11
#define ETH_SCLK_GPIO    12
#define ETH_MISO_GPIO    13
#define ETH_SPI_HOST     SPI2_HOST
#define ETH_SPI_CLOCK_HZ (5 * 1000 * 1000)
#define ETH_POLL_MS      10

static const char *TAG = "w5500.diag";

static void eth_event_handler(void *arg, esp_event_base_t base, int32_t id,
                              void *data)
{
    (void)arg;
    (void)base;
    (void)data;

    switch (id) {
    case ETHERNET_EVENT_START:
        ESP_LOGI(TAG, "driver START");
        break;
    case ETHERNET_EVENT_CONNECTED:
        ESP_LOGI(TAG, "LINK=UP");
        break;
    case ETHERNET_EVENT_DISCONNECTED:
        ESP_LOGI(TAG, "LINK=DOWN");
        break;
    case ETHERNET_EVENT_STOP:
        ESP_LOGI(TAG, "driver STOP");
        break;
    default:
        break;
    }
}

static void got_ip_handler(void *arg, esp_event_base_t base, int32_t id,
                           void *data)
{
    (void)arg;
    (void)base;
    (void)id;
    ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
    ESP_LOGI(TAG, "DHCP IP=" IPSTR " MASK=" IPSTR " GW=" IPSTR,
             IP2STR(&event->ip_info.ip), IP2STR(&event->ip_info.netmask),
             IP2STR(&event->ip_info.gw));
}

void app_main(void)
{
    ESP_LOGI(TAG, "DIAGNOSTICO W5500 MINIMO");
    ESP_LOGI(TAG, "CS=%d MOSI=%d SCLK=%d MISO=%d RST=NC INT=NC",
             ETH_CS_GPIO, ETH_MOSI_GPIO, ETH_SCLK_GPIO, ETH_MISO_GPIO);
    ESP_LOGI(TAG, "SPI mode=0 clock=%dHz polling=%dms",
             ETH_SPI_CLOCK_HZ, ETH_POLL_MS);

    gpio_config_t cs_config = {
        .pin_bit_mask = 1ULL << ETH_CS_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&cs_config));
    ESP_ERROR_CHECK(gpio_set_level(ETH_CS_GPIO, 1));
    vTaskDelay(pdMS_TO_TICKS(1500));

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    esp_netif_config_t netif_config = ESP_NETIF_DEFAULT_ETH();
    esp_netif_t *netif = esp_netif_new(&netif_config);
    ESP_ERROR_CHECK(netif == NULL ? ESP_ERR_NO_MEM : ESP_OK);

    spi_bus_config_t bus_config = {
        .miso_io_num = ETH_MISO_GPIO,
        .mosi_io_num = ETH_MOSI_GPIO,
        .sclk_io_num = ETH_SCLK_GPIO,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(ETH_SPI_HOST, &bus_config,
                                       SPI_DMA_CH_AUTO));

    spi_device_interface_config_t device_config = {
        .mode = 0,
        .clock_speed_hz = ETH_SPI_CLOCK_HZ,
        .spics_io_num = ETH_CS_GPIO,
        .queue_size = 20,
    };
    eth_w5500_config_t w5500_config =
        ETH_W5500_DEFAULT_CONFIG(ETH_SPI_HOST, &device_config);
    w5500_config.int_gpio_num = -1;
    w5500_config.poll_period_ms = ETH_POLL_MS;

    eth_mac_config_t mac_config = ETH_MAC_DEFAULT_CONFIG();
    eth_phy_config_t phy_config = ETH_PHY_DEFAULT_CONFIG();
    phy_config.reset_gpio_num = -1;

    esp_eth_mac_t *mac = esp_eth_mac_new_w5500(&w5500_config, &mac_config);
    esp_eth_phy_t *phy = esp_eth_phy_new_w5500(&phy_config);
    ESP_ERROR_CHECK((mac == NULL || phy == NULL) ? ESP_ERR_NO_MEM : ESP_OK);

    esp_eth_config_t eth_config = ETH_DEFAULT_CONFIG(mac, phy);
    esp_eth_handle_t eth_handle = NULL;
    ESP_ERROR_CHECK(esp_eth_driver_install(&eth_config, &eth_handle));

    uint8_t mac_address[6];
    ESP_ERROR_CHECK(esp_read_mac(mac_address, ESP_MAC_ETH));
    ESP_ERROR_CHECK(esp_eth_ioctl(eth_handle, ETH_CMD_S_MAC_ADDR, mac_address));

    esp_eth_netif_glue_handle_t glue = esp_eth_new_netif_glue(eth_handle);
    ESP_ERROR_CHECK(glue == NULL ? ESP_ERR_NO_MEM : ESP_OK);
    ESP_ERROR_CHECK(esp_netif_attach(netif, glue));
    ESP_ERROR_CHECK(esp_event_handler_register(ETH_EVENT, ESP_EVENT_ANY_ID,
                                               eth_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_ETH_GOT_IP,
                                               got_ip_handler, NULL));

    esp_err_t start_result = esp_eth_start(eth_handle);
    ESP_LOGI(TAG, "esp_eth_start: %s", esp_err_to_name(start_result));
    ESP_ERROR_CHECK(start_result);

    uint32_t seconds = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        ESP_LOGI(TAG, "estable: %" PRIu32 "s", ++seconds);
    }
}
