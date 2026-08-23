/**
 * @file ota_esp.c
 * @brief OTA A/B sobre esp_ota_ops: verificacion de firma, activacion y
 *        rollback. NO COMPILADO. Dosier 13.6.
 *
 * La DECISION de si se puede actualizar (partida en curso, sha256, orden de
 * comprobaciones) vive en diana_core/ota.c y esta probada en host. Aqui solo
 * estan las operaciones que necesitan el hardware.
 */
#include "platform_internal.h"

#include <string.h>

#include "esp_app_format.h"
#include "esp_err.h"
#include "esp_image_format.h"
#include "esp_log.h"
#include "esp_ota_ops.h"

static const char *TAG = "diana.ota";

int diana_pf_ota_verify_signature(void *ctx, const uint8_t *image, size_t len,
                                  const char *signature_b64)
{
    (void)ctx; (void)image; (void)len; (void)signature_b64;

    /* La firma la verifica el propio ESP-IDF con la clave publica embebida en
     * el bootloader (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT). No se
     * reimplementa aqui la criptografia: hacerlo seria un error de seguridad.
     *
     * esp_ota_end() falla con ESP_ERR_OTA_VALIDATE_FAILED si la firma o el
     * formato no son validos, de modo que la verificacion ocurre ANTES de que
     * se pueda marcar la particion como arrancable. */
    const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
    if (!next) {
        ESP_LOGE(TAG, "no hay particion OTA de destino");
        return DIANA_HAL_ERR_GENERIC;
    }

    esp_partition_pos_t pos = {.offset = next->address, .size = next->size};
    esp_image_metadata_t meta;
    /* ESP_IMAGE_VERIFY comprueba cabecera, checksum y, con firma activada, la
     * firma de la imagen. */
    if (esp_image_verify(ESP_IMAGE_VERIFY, &pos, &meta) != ESP_OK) {
        ESP_LOGE(TAG, "la imagen descargada NO supera la verificacion");
        return DIANA_HAL_ERR_INVALID;
    }
    return DIANA_HAL_OK;
}

int diana_pf_ota_activate(void *ctx)
{
    (void)ctx;
    const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
    if (!next) return DIANA_HAL_ERR_GENERIC;

    if (esp_ota_set_boot_partition(next) != ESP_OK) {
        ESP_LOGE(TAG, "no se pudo marcar la particion como arrancable");
        return DIANA_HAL_ERR_GENERIC;
    }
    ESP_LOGW(TAG, "particion %s marcada: se arrancara en el proximo reinicio",
             next->label);
    return DIANA_HAL_OK;
}

int diana_pf_ota_rollback(void *ctx)
{
    (void)ctx;
    /* Marca la imagen en ejecucion como invalida y reinicia en la anterior.
     * Con CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE, ademas, una imagen que nunca
     * llame a esp_ota_mark_app_valid_cancel_rollback() revierte sola tras el
     * siguiente reinicio: hay dos redes de seguridad, no una. */
    esp_err_t err = esp_ota_mark_app_invalid_rollback_and_reboot();
    ESP_LOGE(TAG, "rollback solicitado (err=%d)", (int)err);
    return err == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;
}

/** Confirma la imagen actual: cancela el rollback automatico del bootloader. */
int diana_pf_ota_mark_valid(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
    esp_err_t err = running ? esp_ota_get_state_partition(running, &state)
                            : ESP_ERR_NOT_FOUND;
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "no se confirma OTA: estado de particion no disponible (%s)",
                 esp_err_to_name(err));
        return DIANA_HAL_OK;
    }
    if (state != ESP_OTA_IMG_PENDING_VERIFY) {
        ESP_LOGI(TAG, "no se confirma OTA: imagen en estado %d", (int)state);
        return DIANA_HAL_OK;
    }

    err = esp_ota_mark_app_valid_cancel_rollback();
    return err == ESP_OK ? DIANA_HAL_OK : DIANA_HAL_ERR_GENERIC;
}
