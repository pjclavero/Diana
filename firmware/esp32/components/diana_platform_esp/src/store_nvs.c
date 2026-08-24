/**
 * @file store_nvs.c
 * @brief Almacenamiento clave-valor sobre NVS (identidad, config, credenciales).
 */
#include "platform_internal.h"

#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

static const char *TAG = "diana.nvs";

int diana_pf_nvs_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        /* NVS corrupta o de otra version: se borra y se reinicia.
         * OJO: esto pierde identidad y calibracion. Se registra como incidente
         * grave, no como rutina; el modulo quedara sin aprovisionar. */
        ESP_LOGE(TAG, "NVS ilegible: se borra. Se perdera identidad y calibracion");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    return err == ESP_OK ? 0 : -1;
}

int diana_pf_kv_get(void *ctx, const char *ns, const char *key, void *out,
                    size_t out_size, size_t *out_len)
{
    (void)ctx;
    nvs_handle_t h;
    if (nvs_open(ns, NVS_READONLY, &h) != ESP_OK) return DIANA_HAL_ERR_NOT_FOUND;

    size_t len = out_size;
    esp_err_t err = nvs_get_blob(h, key, out, &len);
    nvs_close(h);

    if (err == ESP_ERR_NVS_NOT_FOUND) return DIANA_HAL_ERR_NOT_FOUND;
    if (err == ESP_ERR_NVS_INVALID_LENGTH) return DIANA_HAL_ERR_NO_SPACE;
    if (err != ESP_OK) return DIANA_HAL_ERR_GENERIC;

    if (out_len) *out_len = len;
    return DIANA_HAL_OK;
}

int diana_pf_kv_set(void *ctx, const char *ns, const char *key, const void *data,
                    size_t len)
{
    (void)ctx;
    nvs_handle_t h;
    if (nvs_open(ns, NVS_READWRITE, &h) != ESP_OK) return DIANA_HAL_ERR_GENERIC;

    esp_err_t err = nvs_set_blob(h, key, data, len);
    if (err == ESP_OK) err = nvs_commit(h);   /* commit explicito: sin el, un
                                               * corte de corriente pierde el dato */
    nvs_close(h);
    return err == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;
}

int diana_pf_kv_erase(void *ctx, const char *ns, const char *key)
{
    (void)ctx;
    nvs_handle_t h;
    if (nvs_open(ns, NVS_READWRITE, &h) != ESP_OK) return DIANA_HAL_ERR_GENERIC;
    esp_err_t err = nvs_erase_key(h, key);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    if (err == ESP_ERR_NVS_NOT_FOUND) return DIANA_HAL_ERR_NOT_FOUND;
    return err == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;
}
