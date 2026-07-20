#include "diana/ota.h"

#include <string.h>

#include "diana/ids.h"
#include "diana/sha256.h"

static void copyz(char *dst, size_t cap, const char *src)
{
    if (!src) { dst[0] = '\0'; return; }
    size_t n = strlen(src);
    if (n >= cap) n = cap - 1;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

void diana_ota_init(diana_ota *ota, const diana_hal *hal, const char *board,
                    const char *running_version, uint32_t confirm_window_ms)
{
    memset(ota, 0, sizeof(*ota));
    ota->hal = hal;
    ota->state = DIANA_OTA_IDLE;
    copyz(ota->board, sizeof(ota->board), board);
    copyz(ota->running_version, sizeof(ota->running_version), running_version);
    ota->confirm_window_ms = confirm_window_ms;
    ota->last_result = DIANA_OTA_OK;
}

static const char *const RESULT_STR[] = {
    "ok",
    "rechazado: partida en curso",
    "rechazado: target_board no coincide",
    "rechazado: misma version ya instalada",
    "rechazado: version no es semver",
    "rechazado: tamano distinto de size_bytes",
    "rechazado: sha256 no coincide",
    "rechazado: firma invalida",
    "rechazado: no hay imagen",
    "rechazado: fallo al activar la particion",
};

const char *diana_ota_result_str(diana_ota_result r)
{
    if ((int)r < 0 || r >= DIANA_OTA_RESULT_COUNT) return "";
    return RESULT_STR[r];
}

static diana_ota_result reject(diana_ota *ota, diana_ota_result r)
{
    ota->rejections++;
    ota->last_result = r;
    ota->state = DIANA_OTA_FAILED;
    return r;
}

diana_ota_result diana_ota_apply(diana_ota *ota, const diana_module_fsm *fsm,
                                 const diana_ota_firmware *fw,
                                 const uint8_t *image, size_t image_len,
                                 uint64_t now_us)
{
    ota->attempts++;

    /* 1. Prohibicion absoluta durante una partida (dosier 13.6). Se comprueba
     *    ANTES que nada mas para que ninguna otra condicion pueda enmascararla. */
    if (diana_module_fsm_game_in_progress(fsm))
        return reject(ota, DIANA_OTA_REJ_GAME_ACTIVE);

    if (!image || image_len == 0) return reject(ota, DIANA_OTA_REJ_NO_IMAGE);

    /* 2. Placa. */
    if (strcmp(fw->target_board, ota->board) != 0)
        return reject(ota, DIANA_OTA_REJ_BOARD);

    /* 3. Version. */
    if (!diana_is_semver(fw->version)) return reject(ota, DIANA_OTA_REJ_BAD_VERSION);
    if (strcmp(fw->version, ota->running_version) == 0)
        return reject(ota, DIANA_OTA_REJ_SAME_VERSION);

    /* 4. Tamano exacto. */
    if (image_len != (size_t)fw->size_bytes) return reject(ota, DIANA_OTA_REJ_SIZE);

    /* 5. sha256. */
    if (!diana_is_sha256_hex(fw->sha256)) return reject(ota, DIANA_OTA_REJ_SHA256);
    char hex[65];
    diana_sha256_hex(image, image_len, hex);
    if (strcmp(hex, fw->sha256) != 0) return reject(ota, DIANA_OTA_REJ_SHA256);

    /* 6. Firma. Sin implementacion de firma NO se activa: fallar cerrado. */
    if (!ota->hal || !ota->hal->ota_verify_signature)
        return reject(ota, DIANA_OTA_REJ_SIGNATURE);
    if (ota->hal->ota_verify_signature(ota->hal->ctx, image, image_len,
                                       fw->signature) != DIANA_HAL_OK)
        return reject(ota, DIANA_OTA_REJ_SIGNATURE);

    ota->state = DIANA_OTA_VERIFIED;

    /* 7. Solo ahora se marca arrancable la particion inactiva. */
    if (!ota->hal->ota_activate ||
        ota->hal->ota_activate(ota->hal->ctx) != DIANA_HAL_OK)
        return reject(ota, DIANA_OTA_REJ_ACTIVATE_FAILED);

    ota->state = DIANA_OTA_PENDING_CONFIRM;
    ota->confirm_deadline_us = now_us + (uint64_t)ota->confirm_window_ms * 1000ULL;
    ota->last_result = DIANA_OTA_OK;
    return DIANA_OTA_OK;
}

int diana_ota_confirm(diana_ota *ota)
{
    if (ota->state != DIANA_OTA_PENDING_CONFIRM) return DIANA_HAL_ERR_INVALID;
    ota->state = DIANA_OTA_IDLE;
    ota->confirm_deadline_us = 0;
    return DIANA_HAL_OK;
}

int diana_ota_rollback(diana_ota *ota)
{
    if (!ota->hal || !ota->hal->ota_rollback) return DIANA_HAL_ERR_GENERIC;
    int rc = ota->hal->ota_rollback(ota->hal->ctx);
    if (rc == DIANA_HAL_OK) {
        ota->state = DIANA_OTA_IDLE;
        ota->confirm_deadline_us = 0;
    }
    return rc;
}

bool diana_ota_tick(diana_ota *ota, uint64_t now_us)
{
    if (ota->state != DIANA_OTA_PENDING_CONFIRM) return false;
    if (ota->confirm_deadline_us == 0 || now_us < ota->confirm_deadline_us)
        return false;
    return diana_ota_rollback(ota) == DIANA_HAL_OK;
}
