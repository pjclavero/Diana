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
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char *TAG = "diana.eth";

/* ===========================================================================
 * Camino SPI propio del W5500 (enganche `custom_spi_driver` de ESP-IDF).
 *
 * NO es un driver nuevo ni un segundo camino: es una REPLICA FIEL del driver
 * SPI por defecto de la version instalada --- ESP-IDF v5.5, checkout
 * 8c750b088c7cd857d079c0eeb495da199b359461, fichero
 * components/esp_eth/src/spi/w5500/esp_eth_mac_w5500.c --- con el mismo
 * framing, el mismo mutex, la misma transaccion por sondeo y el mismo trato de
 * errores. Al pasarse por `custom_spi_driver`, el driver usa EXCLUSIVAMENTE
 * estas funciones: sigue existiendo UN UNICO dispositivo SPI para el W5500.
 *
 * Existe por una sola razon. El driver por defecto no expone ningun acceso a
 * registros, y su `w5500_verify_id()` sondea VERSIONR en bucle hasta obtener
 * 0x04 --- su propio comentario reconoce que algunos W5500 devuelven 0 justo
 * tras el reset ---. Solo registra el valor si agota el timeout. Consecuencia:
 * la incidencia historica `VERSIONR=0x00` puede estar ocurriendo en cada
 * arranque sin dejar rastro alguno. Aqui se lee UNA vez, antes de ese bucle, y
 * el valor se conserva aunque despues el chip responda 0x04.
 * =========================================================================== */

/* Mismo valor que W5500_SPI_LOCK_TIMEOUT_MS en ESP-IDF. */
#define DIANA_W5500_SPI_LOCK_TIMEOUT_MS 50

/* Trama del W5500 tal y como la construye `w5500_read()` de ESP-IDF:
 *   cmd  = direccion >> 16               -> fase de DIRECCION (command_bits=16)
 *   addr = offset | RWB | modo operacion -> fase de CONTROL   (address_bits=8)
 * Los nombres van invertidos respecto a lo intuitivo; se conservan tal cual
 * para que la equivalencia con el original sea comprobable linea a linea. */
#define DIANA_W5500_ADDR_OFFSET   16
#define DIANA_W5500_RWB_OFFSET     2
#define DIANA_W5500_BSB_OFFSET     3
#define DIANA_W5500_BSB_COM_REG    0x00
#define DIANA_W5500_ACCESS_READ    0
#define DIANA_W5500_OP_MODE_VDM    0x00
#define DIANA_W5500_CHIP_VERSION   0x04
#define DIANA_W5500_REG_VERSIONR \
    (((uint32_t)0x0039 << DIANA_W5500_ADDR_OFFSET) | \
     ((uint32_t)DIANA_W5500_BSB_COM_REG << DIANA_W5500_BSB_OFFSET))

typedef struct {
    spi_device_handle_t hdl;
    SemaphoreHandle_t   lock;
    /* Diagnostico. `first_*` se toma antes del bucle de ESP-IDF y NO se
     * sobrescribe nunca: es la unica prueba de un 0x00 recuperado despues. */
    bool                      first_done;
    uint8_t                   first_value;
    diana_w5500_version_class first_class;
    uint8_t                   last_value;
    diana_w5500_version_class last_class;
} diana_w5500_spi_info;

/* Un unico W5500 por modulo. El callback `init` de ESP-IDF no recibe el
 * contexto de plataforma, asi que el puntero al contexto se guarda aqui. */
static diana_w5500_spi_info *s_w5500_spi;

const char *diana_w5500_version_class_str(diana_w5500_version_class c)
{
    switch (c) {
    case DIANA_W5500_VERSION_OK:         return "VERSION_OK";
    case DIANA_W5500_VERSION_INVALID:    return "VERSION_INVALID";
    case DIANA_W5500_VERSION_UNEXPECTED: return "VERSION_UNEXPECTED";
    default:                             return "VERSION_READ_ERROR";
    }
}

static diana_w5500_version_class classify_versionr(uint8_t v)
{
    if (v == DIANA_W5500_CHIP_VERSION) return DIANA_W5500_VERSION_OK;
    if (v == 0x00)                     return DIANA_W5500_VERSION_INVALID;
    return DIANA_W5500_VERSION_UNEXPECTED;
}

static inline bool w5500_spi_lock(diana_w5500_spi_info *spi)
{
    return xSemaphoreTake(spi->lock,
                          pdMS_TO_TICKS(DIANA_W5500_SPI_LOCK_TIMEOUT_MS)) == pdTRUE;
}

static inline bool w5500_spi_unlock(diana_w5500_spi_info *spi)
{
    return xSemaphoreGive(spi->lock) == pdTRUE;
}

static esp_err_t diana_w5500_spi_read(void *spi_ctx, uint32_t cmd, uint32_t addr,
                                      void *value, uint32_t len)
{
    esp_err_t ret = ESP_OK;
    diana_w5500_spi_info *spi = (diana_w5500_spi_info *)spi_ctx;

    spi_transaction_t trans = {
        .flags = len <= 4 ? SPI_TRANS_USE_RXDATA : 0,
        .cmd = cmd,
        .addr = addr,
        .length = 8 * len,
        .rx_buffer = value
    };
    if (w5500_spi_lock(spi)) {
        if (spi_device_polling_transmit(spi->hdl, &trans) != ESP_OK) {
            ESP_LOGE(TAG, "transaccion SPI de lectura fallida");
            ret = ESP_FAIL;
        }
        w5500_spi_unlock(spi);
    } else {
        ret = ESP_ERR_TIMEOUT;
    }
    if ((trans.flags & SPI_TRANS_USE_RXDATA) && len <= 4) {
        memcpy(value, trans.rx_data, len);
    }
    return ret;
}

static esp_err_t diana_w5500_spi_write(void *spi_ctx, uint32_t cmd, uint32_t addr,
                                       const void *value, uint32_t len)
{
    esp_err_t ret = ESP_OK;
    diana_w5500_spi_info *spi = (diana_w5500_spi_info *)spi_ctx;

    spi_transaction_t trans = {
        .cmd = cmd,
        .addr = addr,
        .length = 8 * len,
        .tx_buffer = value
    };
    if (w5500_spi_lock(spi)) {
        if (spi_device_polling_transmit(spi->hdl, &trans) != ESP_OK) {
            ESP_LOGE(TAG, "transaccion SPI de escritura fallida");
            ret = ESP_FAIL;
        }
        w5500_spi_unlock(spi);
    } else {
        ret = ESP_ERR_TIMEOUT;
    }
    return ret;
}

/* UNA lectura de VERSIONR. Sin bucle, sin reintento, sin espera. */
static esp_err_t w5500_read_versionr(diana_w5500_spi_info *spi, uint8_t *out)
{
    uint32_t cmd  = DIANA_W5500_REG_VERSIONR >> DIANA_W5500_ADDR_OFFSET;
    uint32_t addr = (DIANA_W5500_REG_VERSIONR & 0xFFFFu)
                    | ((uint32_t)DIANA_W5500_ACCESS_READ << DIANA_W5500_RWB_OFFSET)
                    | DIANA_W5500_OP_MODE_VDM;
    return diana_w5500_spi_read(spi, cmd, addr, out, 1);
}

static void *diana_w5500_spi_init(const void *spi_config)
{
    const eth_w5500_config_t *w5500_config = (const eth_w5500_config_t *)spi_config;
    diana_w5500_spi_info *spi = calloc(1, sizeof(diana_w5500_spi_info));
    if (!spi) {
        ESP_LOGE(TAG, "sin memoria para el contexto SPI del W5500");
        return NULL;
    }

    spi_device_interface_config_t spi_devcfg = *(w5500_config->spi_devcfg);
    if (spi_devcfg.command_bits == 0 && spi_devcfg.address_bits == 0) {
        spi_devcfg.command_bits = 16;  /* fase de direccion en la trama W5500 */
        spi_devcfg.address_bits = 8;   /* fase de control  en la trama W5500 */
    } else if (spi_devcfg.command_bits != 16 || spi_devcfg.address_bits != 8) {
        ESP_LOGE(TAG, "formato de trama SPI incorrecto para el W5500");
        free(spi);
        return NULL;
    }

    if (spi_bus_add_device(w5500_config->spi_host_id, &spi_devcfg, &spi->hdl) != ESP_OK) {
        ESP_LOGE(TAG, "spi_bus_add_device fallo para el W5500");
        free(spi);
        return NULL;
    }
    spi->lock = xSemaphoreCreateMutex();
    if (!spi->lock) {
        ESP_LOGE(TAG, "no se pudo crear el mutex del SPI del W5500");
        spi_bus_remove_device(spi->hdl);
        free(spi);
        return NULL;
    }

    /* PRIMERA lectura de VERSIONR. Este es el unico instante en que puede
     * observarse sin enmascarar: el dispositivo SPI ya existe, pero el driver
     * todavia no ha ejecutado su `w5500_verify_id()` con reintentos. */
    uint8_t v = 0;
    if (w5500_read_versionr(spi, &v) == ESP_OK) {
        spi->first_value = v;
        spi->first_class = classify_versionr(v);
    } else {
        spi->first_value = 0;
        spi->first_class = DIANA_W5500_VERSION_READ_ERROR;
    }
    spi->first_done = true;
    spi->last_value = spi->first_value;
    spi->last_class = spi->first_class;

    if (spi->first_class == DIANA_W5500_VERSION_OK) {
        ESP_LOGI(TAG, "W5500 first VERSIONR=0x%02x (%s)",
                 (unsigned)spi->first_value,
                 diana_w5500_version_class_str(spi->first_class));
    } else {
        /* Se registra UNA vez y con nivel alto: es la incidencia historica.
         * No se reintenta aqui para "arreglarlo". */
        ESP_LOGW(TAG, "W5500 first VERSIONR=0x%02x (%s) --- esperado 0x%02x",
                 (unsigned)spi->first_value,
                 diana_w5500_version_class_str(spi->first_class),
                 DIANA_W5500_CHIP_VERSION);
    }

    s_w5500_spi = spi;
    return spi;
}

static esp_err_t diana_w5500_spi_deinit(void *spi_ctx)
{
    diana_w5500_spi_info *spi = (diana_w5500_spi_info *)spi_ctx;
    if (!spi) return ESP_OK;
    if (s_w5500_spi == spi) s_w5500_spi = NULL;
    spi_bus_remove_device(spi->hdl);
    vSemaphoreDelete(spi->lock);
    free(spi);
    return ESP_OK;
}

int diana_platform_eth_versionr(diana_platform *p, uint8_t *out_value,
                                diana_w5500_version_class *out_class)
{
    (void)p;
    diana_w5500_spi_info *spi = s_w5500_spi;
    if (!spi) return -1;

    uint8_t v = 0;
    diana_w5500_version_class cls;
    if (w5500_read_versionr(spi, &v) != ESP_OK) {
        cls = DIANA_W5500_VERSION_READ_ERROR;
        v = 0;
    } else {
        cls = classify_versionr(v);
    }
    spi->last_value = v;
    spi->last_class = cls;
    if (out_value) *out_value = v;
    if (out_class) *out_class = cls;
    return cls == DIANA_W5500_VERSION_READ_ERROR ? -2 : 0;
}

bool diana_platform_eth_versionr_first(diana_platform *p, uint8_t *out_value,
                                       diana_w5500_version_class *out_class)
{
    (void)p;
    diana_w5500_spi_info *spi = s_w5500_spi;
    if (!spi || !spi->first_done) return false;
    if (out_value) *out_value = spi->first_value;
    if (out_class) *out_class = spi->first_class;
    return true;
}


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
    cfg.sync_cb = NULL;

    /* El servidor del DHCP es un EXTRA, nunca el requisito.
     *
     * Estaba puesto a true incondicionalmente, y esa opcion exige
     * CONFIG_LWIP_DHCP_GET_NTP_SRV en lwIP. Sin ella, esp_netif_sntp_init()
     * falla ENTERO --- no "ignora el extra": se lleva por delante tambien el
     * servidor explicito --- y el modulo se queda sin hora para siempre. Medido
     * en el banco:
     *
     *   E esp_netif_sntp: Tried to configure SNTP server from DHCP, while
     *                     disabled. Please enable CONFIG_LWIP_DHCP_GET_NTP_SRV
     *   E esp_netif_sntp: esp_netif_sntp_init(119): Failed initialize SNTP
     *
     * Con la caducidad de comandos medida contra hora de pared, eso dejaba
     * VETADO todo el repertorio 'act' del canal de mantenimiento. Un extra no
     * puede tumbar el camino principal. */
#ifdef CONFIG_LWIP_DHCP_GET_NTP_SRV
    cfg.server_from_dhcp = true;
    cfg.renew_servers_after_new_IP = true;
#else
    cfg.server_from_dhcp = false;
    cfg.renew_servers_after_new_IP = false;
#endif

    esp_err_t err = esp_netif_sntp_init(&cfg);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        /* Sin hora, el modulo SIGUE operando: la defensa contra reproduccion
         * pasa a ser el nonce persistido, y cada comando aceptado lo declara
         * en su veredicto. No se bloquea el arranque por esto. Lo que SI se
         * dice es el codigo exacto: "no disponible" sin motivo obligaba a
         * reproducir el fallo con la placa delante. */
        ESP_LOGW(TAG, "SNTP no arranco (%s): sin hora de pared no se verifica "
                      "la caducidad; el repertorio 'act' de mantenimiento se "
                      "rechazara (README 6-bis)", esp_err_to_name(err));
        return;
    }
    ESP_LOGI(TAG, "SNTP arrancado contra %s (servidor del DHCP: %s)",
             CONFIG_DIANA_NTP_HOST,
#ifdef CONFIG_LWIP_DHCP_GET_NTP_SRV
             "tambien"
#else
             "no, lwIP sin CONFIG_LWIP_DHCP_GET_NTP_SRV"
#endif
    );
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

    /* Camino SPI propio: MISMO framing y MISMO mutex que el driver por defecto
     * de ESP-IDF v5.5. ESP-IDF exige los cuatro callbacks no nulos; si faltara
     * alguno caeria SILENCIOSAMENTE al driver por defecto y perderiamos la
     * primera lectura de VERSIONR sin ningun aviso. `config` apunta a esta
     * misma estructura, viva durante toda la llamada sincrona a
     * esp_eth_mac_new_w5500(), que es quien invoca a `init`. */
    w5500_cfg.custom_spi_driver.config = &w5500_cfg;
    w5500_cfg.custom_spi_driver.init   = diana_w5500_spi_init;
    w5500_cfg.custom_spi_driver.deinit = diana_w5500_spi_deinit;
    w5500_cfg.custom_spi_driver.read   = diana_w5500_spi_read;
    w5500_cfg.custom_spi_driver.write  = diana_w5500_spi_write;

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
    int rc = esp_eth_start(p->eth) == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;

    /* UNA lectura diagnostica por reconexion. Ni bucle ni sondeo periodico: un
     * reconnect es un evento raro, y es justo cuando interesa saber si el chip
     * sigue respondiendo por SPI. */
    uint8_t v = 0;
    diana_w5500_version_class cls = DIANA_W5500_VERSION_READ_ERROR;
    if (diana_platform_eth_versionr(p, &v, &cls) == 0 &&
        cls == DIANA_W5500_VERSION_OK) {
        ESP_LOGI(TAG, "tras reconnect: VERSIONR=0x%02x (%s)",
                 (unsigned)v, diana_w5500_version_class_str(cls));
    } else {
        ESP_LOGW(TAG, "tras reconnect: VERSIONR=0x%02x (%s)",
                 (unsigned)v, diana_w5500_version_class_str(cls));
    }
    return rc;
}

bool diana_platform_eth_available(diana_platform *p)
{
    return p && p->eth_ready && p->eth;
}
