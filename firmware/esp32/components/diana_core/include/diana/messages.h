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

size_t diana_diagnostic_json(const diana_diagnostic *d, const diana_identity *id,
                             uint64_t uptime_us, char *buf, size_t cap);

/* -------------------------------------------------------- config reported */

size_t diana_config_reported_json(const diana_config *cfg, const char *module_id,
                                  const char *applied_at, char *buf, size_t cap);

#define DIANA_MSG_JSON_MAX 3072

#ifdef __cplusplus
}
#endif
#endif /* DIANA_MESSAGES_H */
