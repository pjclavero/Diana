/**
 * @file identity.h
 * @brief Identidad persistente del modulo (dosier 12.3, 13.5; ADR-0003).
 *
 * Persistido en NVS (namespace "diana_id"):
 *   module_id, system_id, serial, hw_rev, credenciales MQTT, local_sequence.
 * Volatil, nuevo en cada arranque:
 *   boot_id (UUIDv4).
 *
 * local_sequence es monotonico y NO se reinicia al reconectar. Se reinicia solo
 * si se borra la NVS (reflasheo), y entonces boot_id cambia: por eso la tupla
 * (module_id, boot_id, local_sequence) sigue siendo unica.
 */
#ifndef DIANA_IDENTITY_H
#define DIANA_IDENTITY_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define DIANA_NVS_NS_IDENTITY "diana_id"
#define DIANA_NVS_NS_CONFIG   "diana_cfg"
#define DIANA_NVS_NS_STATE    "diana_st"

/** Cada cuantos incrementos se persiste local_sequence en NVS.
 *  Compromiso entre desgaste de flash y salto de secuencia tras corte de
 *  corriente: al arrancar se reserva un bloque entero, de modo que la secuencia
 *  puede saltar hacia delante pero NUNCA repetirse. */
#define DIANA_SEQ_RESERVE_BLOCK 64

typedef struct {
    char module_id[DIANA_ID_MAXLEN];
    char system_id[DIANA_ID_MAXLEN];   /* vacio si aun no asignado */
    char serial[65];
    char hardware_revision[33];
    char mqtt_user[65];
    char mqtt_pass[65];                /* nunca se publica ni se registra */
    char boot_id[DIANA_UUID_LEN];
    char firmware_version[DIANA_SEMVER_MAXLEN];

    uint64_t local_sequence;           /* siguiente valor a usar */
    uint64_t seq_persisted_upto;       /* frontera reservada en NVS */
    diana_reset_reason reset_reason;
    bool loaded;
} diana_identity;

/**
 * Carga la identidad de NVS, genera boot_id nuevo y reserva un bloque de
 * secuencia. Si no hay identidad guardada, deja module_id vacio y devuelve
 * DIANA_HAL_ERR_NOT_FOUND (el modulo debe entrar en aprovisionamiento).
 */
int diana_identity_load(diana_identity *id, const diana_hal *hal,
                        const char *firmware_version);

/** Escribe module_id/system_id/serial/hw_rev/credenciales en NVS. */
int diana_identity_provision(diana_identity *id, const diana_hal *hal,
                             const char *module_id, const char *system_id,
                             const char *serial, const char *hw_rev,
                             const char *mqtt_user, const char *mqtt_pass);

/** Persiste system_id (lo asigna el backend via config/desired). */
int diana_identity_set_system(diana_identity *id, const diana_hal *hal,
                              const char *system_id);

/**
 * Devuelve el siguiente local_sequence y lo consume. Persiste una nueva
 * frontera cuando se agota el bloque reservado.
 */
uint64_t diana_identity_next_sequence(diana_identity *id, const diana_hal *hal);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_IDENTITY_H */
