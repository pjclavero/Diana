/**
 * @file messages.h
 * @brief Topicos y payloads de los mensajes que publica el modulo.
 *
 * Derivado del contrato CONGELADO contracts/mqtt/README.md §1, §2 y §3.
 * QoS y retain de cada topico son los de la tabla del contrato y estan
 * codificados en diana_topic_qos() / diana_topic_retain(): el firmware no
 * decide, obedece.
 */
#ifndef DIANA_MESSAGES_H
#define DIANA_MESSAGES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/config.h"
#include "diana/event.h"
#include "diana/hal.h"
#include "diana/identity.h"
#include "diana/module_fsm.h"
#include "diana/target_fsm.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DIANA_TOPIC_PRESENCE = 0,
    DIANA_TOPIC_STATUS,
    DIANA_TOPIC_TELEMETRY,
    DIANA_TOPIC_CONFIG_REPORTED,
    DIANA_TOPIC_CONFIG_DESIRED,
    DIANA_TOPIC_COMMAND,
    DIANA_TOPIC_HIT,
    DIANA_TOPIC_DIAGNOSTIC,
    DIANA_TOPIC_OTA,
    DIANA_TOPIC_COUNT
} diana_topic;

/** Construye 'targets/v1/module/{module_id}/...'. 0 si no cabe. */
size_t diana_topic_build(char *buf, size_t cap, diana_topic t,
                         const char *module_id);
int  diana_topic_qos(diana_topic t);
bool diana_topic_retain(diana_topic t);

/**
 * Tópicos de sistema. SOLO el coordinador publica en game/event y game/state;
 * el backend es el unico que escribe system/…/command y system/…/status.
 */
typedef enum {
    DIANA_SYS_TOPIC_GAME_EVENT = 0,
    DIANA_SYS_TOPIC_GAME_STATE,
    DIANA_SYS_TOPIC_COMMAND,
    DIANA_SYS_TOPIC_STATUS,
    DIANA_SYS_TOPIC_COUNT
} diana_system_topic;

/** Construye 'targets/v1/system/{system_id}/...'. 0 si no cabe. */
size_t diana_system_topic_build(char *buf, size_t cap, diana_system_topic t,
                                const char *system_id);

/* ------------------------------------------------------------- presencia */

/**
 * Payload del Last Will, EXACTAMENTE como manda el contrato §3:
 *   {"schema_version":1,"module_id":"…","online":false,"reason":"lwt"}
 * Se registra en CONNECT con QoS 1 y retain=true.
 */
size_t diana_presence_lwt_json(const char *module_id, char *buf, size_t cap);

/** Presencia completa (connect / shutdown), con datos de identidad y red. */
size_t diana_presence_json(const diana_identity *id, diana_presence_reason reason,
                           const diana_hal_net_status *net, char *buf, size_t cap);

/* ----------------------------------------------------------------- estado */

typedef struct {
    const diana_identity *id;
    const diana_module_fsm *fsm;
    const diana_target_set *targets;
    const diana_config *cfg;
    diana_selector_position selector;
    diana_module_role role;
    size_t queue_depth;
    uint64_t uptime_s;
    bool has_last_command;
    char last_command_id[DIANA_UUID_LEN];
    const char *last_command_result;  /* cadena del contrato */
    const char *last_command_detail;  /* puede ser NULL */
} diana_status_input;

size_t diana_status_json(const diana_status_input *in, char *buf, size_t cap);

/* ------------------------------------------------------------- telemetria */

typedef struct {
    const diana_identity *id;
    uint64_t uptime_s;
    uint64_t uptime_us;
    diana_hal_health health;
    bool link_up;
    uint32_t mqtt_reconnects;
    size_t queue_depth;
    bool chain_ok[DIANA_LED_CHAINS];
    bool has_chain_current;
    uint32_t chain_current_ma[DIANA_LED_CHAINS];
} diana_telemetry_input;

size_t diana_telemetry_json(const diana_telemetry_input *in, char *buf, size_t cap);

/* ------------------------------------------------------------ diagnostico */

typedef struct {
    char event_id[DIANA_EVENTID_LEN];
    diana_diagnostic_kind kind;
    diana_severity severity;
    char message[DIANA_MESSAGE_MAXLEN];
    /*
     * Correlacion con la orden que provoco el diagnostico. El contrato la
     * exige para kind=command_rejected: "un rechazo sin request_id es, por
     * definicion, incorrelable". Para los diagnosticos espontaneos (boot,
     * sensor_error, low_voltage, ...) no existe ninguna orden y el campo NO se
     * emite: no se rellena con un UUID inventado ni con una cadena vacia.
     */
    bool has_request_id;
    char request_id[DIANA_UUID_LEN];
    bool has_reject_reason;
    diana_command_reject_reason reject_reason;
    /* detail: pares clave/valor simples, suficientes para los kinds actuales.
     * Sin secretos ni credenciales (contrato). */
    const char *detail_keys[8];
    const char *detail_str[8];   /* NULL si el valor es numerico */
    int64_t     detail_num[8];
    uint8_t     detail_count;
} diana_diagnostic;

/** Rellena event_id, device y firmware_version a partir de la identidad. */
void diana_diagnostic_init(diana_diagnostic *d, const diana_hal *hal,
                           diana_diagnostic_kind kind, diana_severity sev,
                           const char *message);

/**
 * Constructor UNICO del diagnostico kind=command_rejected.
 *
 * Existe para que sea IMPOSIBLE emitir un rechazo sin correlacion: pide el
 * identificador de la orden rechazada y el motivo del contrato como argumentos
 * obligatorios. diana_diagnostic_json() se niega a serializar un
 * command_rejected que no los lleve, asi que no hay camino alternativo.
 *
 * @param command_id UUID de la orden RECHAZADA (module-command.command_id).
 *                   Debe ser el de ESA orden: un rechazo correlado con otra
 *                   cosa es peor que uno sin correlar, porque miente.
 * @param reason     motivo de la lista CERRADA del contrato, elegido en el
 *                   punto de rechazo.
 * @param message    explicacion literal, sin vocabulario acotado.
 * @return false si command_id no es un UUID valido: en ese caso el diagnostico
 *         NO queda construido y no se puede publicar.
 */
bool diana_diagnostic_command_rejected(diana_diagnostic *d, const diana_hal *hal,
                                       const char *command_id,
                                       diana_command_reject_reason reason,
                                       const char *message);

size_t diana_diagnostic_json(const diana_diagnostic *d, const diana_identity *id,
                             uint64_t uptime_us, char *buf, size_t cap);

/* -------------------------------------------------------- config reported */

size_t diana_config_reported_json(const diana_config *cfg, const char *module_id,
                                  const char *applied_at, char *buf, size_t cap);

/* ------------------------------------------------------------- game-event
 * Via por la que el COORDINADOR aporta T2 al impacto de un SATELITE sin
 * escribir en el topico ajeno (hallazgo H-01). */

typedef struct {
    const char *system_id;
    const char *coordinator_module_id; /* el propio, es quien publica */
    const char *game_id;
    const char *round_id;
    /* Enlace al hit-event original del detector. */
    const char *hit_event_id;
    const char *detector_module_id;
    uint8_t     target_index;
    /* T2 consolidado por el coordinador. */
    uint64_t    elapsed_us;
    /* T1 del propio coordinador en el instante de consolidar. */
    diana_device_time device;
    const char *detail;                /* opcional */
} diana_game_event_hit;

/**
 * Construye el game-event kind=target_hit que transporta T2 del impacto de un
 * satelite. Genera event_id propio (el del coordinador), distinto del
 * hit_event_id, que es el del detector.
 *
 * Devuelve 0 si el emisor no es el coordinador o si falta el enlace.
 */
size_t diana_game_event_target_hit(const diana_hal *hal,
                                   diana_module_role own_role,
                                   const diana_game_event_hit *in,
                                   char *buf, size_t cap);

#define DIANA_MSG_JSON_MAX 3072

#ifdef __cplusplus
}
#endif
#endif /* DIANA_MESSAGES_H */
