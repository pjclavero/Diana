/**
 * @file ota.h
 * @brief Actualizacion OTA A/B (dosier 13.6, ota-command.schema.json).
 *
 * Orden de comprobaciones, no negociable:
 *   1. La orden es un comando valido (caducidad, nonce, command_id) -> command.h
 *   2. NO hay partida en curso. Si la hay, se rechaza. Sin excepciones.
 *   3. target_board coincide con la placa compilada.
 *   4. version distinta de la instalada.
 *   5. La imagen descargada mide size_bytes exactos.
 *   6. sha256(imagen) == sha256 declarado.
 *   7. La firma verifica (delegada al HAL / bootloader firmado de ESP-IDF).
 *   8. Solo entonces se marca arrancable la particion inactiva.
 *
 * Tras arrancar la nueva imagen, el firmware queda PENDIENTE de confirmacion:
 * si no llega 'confirm' antes del plazo, se hace rollback automatico.
 */
#ifndef DIANA_OTA_H
#define DIANA_OTA_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/module_fsm.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DIANA_OTA_IDLE = 0,
    DIANA_OTA_DOWNLOADING,
    DIANA_OTA_VERIFIED,
    DIANA_OTA_PENDING_CONFIRM,  /* arrancada, a la espera de 'confirm' */
    DIANA_OTA_FAILED
} diana_ota_state;

typedef enum {
    DIANA_OTA_OK = 0,
    DIANA_OTA_REJ_GAME_ACTIVE,     /* prohibido durante partida */
    DIANA_OTA_REJ_BOARD,
    DIANA_OTA_REJ_SAME_VERSION,
    DIANA_OTA_REJ_BAD_VERSION,
    DIANA_OTA_REJ_SIZE,
    DIANA_OTA_REJ_SHA256,
    DIANA_OTA_REJ_SIGNATURE,
    DIANA_OTA_REJ_NO_IMAGE,
    DIANA_OTA_REJ_ACTIVATE_FAILED,
    DIANA_OTA_RESULT_COUNT
} diana_ota_result;

typedef struct {
    char     version[DIANA_SEMVER_MAXLEN];
    char     url[256];
    uint32_t size_bytes;
    char     sha256[65];
    char     signature[256];
    char     target_board[65];
} diana_ota_firmware;

typedef struct {
    const diana_hal *hal;
    diana_ota_state state;
    char     board[65];              /* placa compilada */
    char     running_version[DIANA_SEMVER_MAXLEN];
    uint64_t confirm_deadline_us;
    uint32_t confirm_window_ms;
    uint32_t attempts;
    uint32_t rejections;
    diana_ota_result last_result;
} diana_ota;

void diana_ota_init(diana_ota *ota, const diana_hal *hal, const char *board,
                    const char *running_version, uint32_t confirm_window_ms);

const char *diana_ota_result_str(diana_ota_result r);

/**
 * Verifica y activa una imagen ya descargada en la particion inactiva.
 * NO activa nada si cualquier comprobacion falla.
 * @param fsm   estado del modulo, para prohibir OTA con partida en curso.
 * @param image imagen completa descargada (en ESP32 se verifica por bloques;
 *              la logica de decision es la misma y se prueba en host).
 */
diana_ota_result diana_ota_apply(diana_ota *ota, const diana_module_fsm *fsm,
                                 const diana_ota_firmware *fw,
                                 const uint8_t *image, size_t image_len,
                                 uint64_t now_us);

/** Confirma la imagen en ejecucion: cancela el rollback automatico. */
int diana_ota_confirm(diana_ota *ota);

/** Rollback explicito a la particion anterior. */
int diana_ota_rollback(diana_ota *ota);

/**
 * Comprueba si ha vencido el plazo de confirmacion y, en tal caso, dispara el
 * rollback automatico. Devuelve true si se ha hecho rollback.
 */
bool diana_ota_tick(diana_ota *ota, uint64_t now_us);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_OTA_H */
