/**
 * @file command.h
 * @brief Validacion de comandos entrantes (contrato MQTT §6, dosier 23.3).
 *
 * Un modulo DESCARTA un comando si:
 *   1. command_id ya fue ejecutado (cache de los ULTIMOS 128), o
 *   2. nonce <= ultimo nonce aceptado de ESE emisor (proteccion de reenvio), o
 *   3. han pasado mas de expires_in_ms desde la recepcion del canal.
 *
 * La caducidad se mide con el reloj MONOTONICO local sobre el instante de
 * recepcion, no restando issued_at_ms del reloj de pared: el modulo puede no
 * tener hora sincronizada y no se le puede permitir aceptar ordenes viejas
 * porque su reloj vaya atrasado.
 */
#ifndef DIANA_COMMAND_H
#define DIANA_COMMAND_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** El contrato fija explicitamente 128. */
#define DIANA_CMD_CACHE 128

typedef struct {
    char     command_id[DIANA_UUID_LEN];
    uint64_t issued_at_ms;
    uint32_t expires_in_ms;
    uint64_t nonce;
    diana_issuer issuer;
    char     module_id[DIANA_ID_MAXLEN];
    diana_command_action action;
    uint32_t schema_version;
} diana_command;

typedef struct {
    char     ids[DIANA_CMD_CACHE][DIANA_UUID_LEN];
    uint64_t recv_us[DIANA_CMD_CACHE];
    uint16_t next;
    uint16_t used;

    uint64_t last_nonce[DIANA_ISSUER_COUNT];
    bool     nonce_seen[DIANA_ISSUER_COUNT];

    uint32_t accepted;
    uint32_t rejected_duplicate;
    uint32_t rejected_nonce;
    uint32_t rejected_expired;
    uint32_t rejected_invalid;
    uint32_t rejected_schema;
} diana_command_guard;

typedef struct {
    diana_command_result result;
    char detail[121];   /* last_command.detail maxLength 120 */
} diana_command_verdict;

void diana_command_guard_init(diana_command_guard *g);

/**
 * Valida un comando recibido.
 * @param recv_us   instante monotonico de recepcion del mensaje.
 * @param now_us    instante monotonico actual (al procesarlo).
 *
 * Un veredicto ACCEPTED consume el nonce y registra el command_id: llamar dos
 * veces con el mismo comando devuelve DUPLICATE la segunda vez.
 */
diana_command_verdict diana_command_validate(diana_command_guard *g,
                                             const diana_command *cmd,
                                             const char *own_module_id,
                                             uint64_t recv_us, uint64_t now_us);

bool diana_command_seen(const diana_command_guard *g, const char *command_id);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_COMMAND_H */
