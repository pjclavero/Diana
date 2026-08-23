/**
 * @file types.h
 * @brief Tipos derivados del contrato CONGELADO contracts/mqtt + contracts/schemas.
 *
 * Los enumerados y sus cadenas se corresponden 1:1 con common.schema.json.
 * Cualquier divergencia la detecta el test de conformidad de contrato
 * (test_contract.c), que compara las cadenas del firmware con los $defs del
 * esquema leidos por la herramienta tools/validate_messages.py.
 *
 * NO editar a mano sin actualizar el contrato: el contrato manda.
 */
#ifndef DIANA_TYPES_H
#define DIANA_TYPES_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DIANA_SCHEMA_VERSION      1
#define DIANA_TARGET_COUNT        9
#define DIANA_LED_CHAINS          3
/* Aros WS2812B reales: 24 LED por diana, 3 dianas por fila. */
#define DIANA_LEDS_PER_CHAIN      72
#define DIANA_LEDS_PER_TARGET     24
#define DIANA_ID_MAXLEN           64   /* identifier: hasta 63 chars + NUL */
#define DIANA_UUID_LEN            37   /* 36 chars + NUL */
#define DIANA_EVENTID_LEN         37
#define DIANA_SEMVER_MAXLEN       32
#define DIANA_REASON_MAXLEN       121  /* classification_reason maxLength 120 */
#define DIANA_MESSAGE_MAXLEN      241  /* diagnostic.message maxLength 240 */
#define DIANA_TOPIC_MAXLEN        160
#define DIANA_MAX_NEIGHBOURS      8

/** common.schema.json#/$defs/targetState */
typedef enum {
    DIANA_TARGET_OFF = 0,
    DIANA_TARGET_SAFE,
    DIANA_TARGET_ACTIVE,
    DIANA_TARGET_HIT,
    DIANA_TARGET_COUNTDOWN,
    DIANA_TARGET_PENALTY,
    DIANA_TARGET_ERROR,
    DIANA_TARGET_CALIBRATION,
    DIANA_TARGET_LOCKED,
    DIANA_TARGET_SENSOR_ERROR,
    DIANA_TARGET_MAINTENANCE,
    DIANA_TARGET_DISABLED,
    DIANA_TARGET_STATE_COUNT
} diana_target_state;

/** common.schema.json#/$defs/moduleState */
typedef enum {
    DIANA_MODULE_BOOT = 0,
    DIANA_MODULE_SELFTEST,
    DIANA_MODULE_NETWORK,
    DIANA_MODULE_REGISTERING,
    DIANA_MODULE_READY,
    DIANA_MODULE_CALIBRATION,
    DIANA_MODULE_MAINTENANCE,
    DIANA_MODULE_GAME_PREPARE,
    DIANA_MODULE_GAME_COUNTDOWN,
    DIANA_MODULE_GAME_ACTIVE,
    DIANA_MODULE_GAME_PAUSED,
    DIANA_MODULE_GAME_FINISHED,
    DIANA_MODULE_ERROR,
    DIANA_MODULE_STATE_COUNT
} diana_module_state;

/** common.schema.json#/$defs/hitClassification */
typedef enum {
    DIANA_HIT_VALID = 0,
    DIANA_HIT_ON_SAFE,
    DIANA_HIT_ON_ALREADY_HIT,
    DIANA_HIT_OUT_OF_ORDER,
    DIANA_HIT_CROSSTALK_REJECTED,
    DIANA_HIT_AMBIGUOUS,
    DIANA_HIT_DURING_PAUSE,
    DIANA_HIT_CALIBRATION,
    DIANA_HIT_EARLY_SHOT,
    DIANA_HIT_CLASS_COUNT
} diana_hit_classification;

/** common.schema.json#/$defs/selectorPosition */
typedef enum {
    DIANA_SELECTOR_SATELITE = 0,
    DIANA_SELECTOR_AUTO,
    DIANA_SELECTOR_PRINCIPAL,
    DIANA_SELECTOR_COUNT
} diana_selector_position;

/**
 * hit-event.schema.json#/properties/detection_method (ADR-0007).
 *
 * DISCRIMINADOR EXPLICITO del perfil de deteccion. No es informativo: decide
 * que campos PUEDEN aparecer en el payload.
 *
 *   analog_envelope   -> amplitude y threshold OBLIGATORIOS, y cada vecino
 *                        debe traer su amplitud.
 *   digital_threshold -> amplitude, threshold y noise_floor PROHIBIDOS, igual
 *                        que la amplitud de cada vecino. No estan "ausentes
 *                        por cortesia": no pueden aparecer.
 *
 * La AUSENCIA del campo en el JSON equivale a analog_envelope, nunca a
 * digital: un productor v1 anterior al ADR sigue obligado a medir. Un modulo
 * DO-only tiene que DECLARARSE; el silencio no le sirve de excusa.
 */
typedef enum {
    DIANA_DETECT_ANALOG_ENVELOPE = 0,
    DIANA_DETECT_DIGITAL_THRESHOLD,
    DIANA_DETECT_METHOD_COUNT
} diana_detection_method;

/** common.schema.json#/$defs/moduleRole. 'auto' nunca es un rol resuelto. */
typedef enum {
    DIANA_ROLE_PRINCIPAL = 0,
    DIANA_ROLE_SATELLITE,
    DIANA_ROLE_AUTO,
    DIANA_ROLE_COUNT
} diana_module_role;

/** module-diagnostic.schema.json#/properties/kind */
typedef enum {
    DIANA_DIAG_BOOT = 0,
    DIANA_DIAG_RESET_REASON,
    DIANA_DIAG_SENSOR_ERROR,
    DIANA_DIAG_LED_CHAIN_ERROR,
    DIANA_DIAG_LOW_VOLTAGE,
    DIANA_DIAG_OVER_TEMPERATURE,
    DIANA_DIAG_QUEUE_OVERFLOW,
    DIANA_DIAG_MQTT_DISCONNECT,
    DIANA_DIAG_CALIBRATION_RESULT,
    DIANA_DIAG_SELF_TEST_RESULT,
    DIANA_DIAG_SCHEMA_REJECTED,
    DIANA_DIAG_COMMAND_REJECTED,
    DIANA_DIAG_OTA_RESULT,
    DIANA_DIAG_KIND_COUNT
} diana_diagnostic_kind;

/**
 * module-diagnostic.schema.json · allOf[kind=command_rejected] ->
 * detail.reason. LISTA CERRADA del contrato: un motivo que no este aqui no se
 * puede publicar, y no se "aproxima por parecido".
 *
 * El motivo se elige EN EL PUNTO DE RECHAZO, no se deduce despues a partir del
 * texto: deducirlo seria adivinar. La explicacion literal y completa sigue
 * viajando en `message`, que no esta acotado a vocabulario.
 */
typedef enum {
    DIANA_REJECT_EXPIRED = 0,
    DIANA_REJECT_MODULE_MISMATCH,
    DIANA_REJECT_UNKNOWN_COMMAND,
    DIANA_REJECT_GAME_IN_PROGRESS,
    DIANA_REJECT_DUPLICATE,
    DIANA_REJECT_PARAMS_OUT_OF_RANGE,
    DIANA_REJECT_REASON_COUNT
} diana_command_reject_reason;

typedef enum {
    DIANA_SEV_INFO = 0,
    DIANA_SEV_WARNING,
    DIANA_SEV_ERROR,
    DIANA_SEV_CRITICAL,
    DIANA_SEV_COUNT
} diana_severity;

/** module-command.schema.json#/properties/action */
typedef enum {
    DIANA_CMD_IDENTIFY = 0,
    DIANA_CMD_SET_TARGETS,
    DIANA_CMD_SET_ALL_TARGETS,
    DIANA_CMD_REBOOT,
    DIANA_CMD_START_CALIBRATION,
    DIANA_CMD_ABORT_CALIBRATION,
    DIANA_CMD_SELF_TEST,
    DIANA_CMD_LED_TEST,
    DIANA_CMD_FLUSH_QUEUE,
    DIANA_CMD_SET_MAINTENANCE,
    DIANA_CMD_CLEAR_ERROR,
    DIANA_CMD_ACTION_COUNT
} diana_command_action;

/** module-status.schema.json#/properties/last_command/result */
typedef enum {
    DIANA_CMD_RESULT_ACCEPTED = 0,
    DIANA_CMD_RESULT_REJECTED,
    DIANA_CMD_RESULT_EXPIRED,
    DIANA_CMD_RESULT_DUPLICATE,
    DIANA_CMD_RESULT_FAILED,
    DIANA_CMD_RESULT_COUNT
} diana_command_result;

/** module-presence.schema.json#/properties/reason */
typedef enum {
    DIANA_PRESENCE_CONNECT = 0,
    DIANA_PRESENCE_SHUTDOWN,
    DIANA_PRESENCE_LWT,
    DIANA_PRESENCE_REASON_COUNT
} diana_presence_reason;

/** ota-command.schema.json#/properties/action */
typedef enum {
    DIANA_OTA_UPDATE = 0,
    DIANA_OTA_CONFIRM,
    DIANA_OTA_ROLLBACK,
    DIANA_OTA_CANCEL,
    DIANA_OTA_ACTION_COUNT
} diana_ota_action;

/** commandEnvelope.issuer */
typedef enum {
    DIANA_ISSUER_BACKEND = 0,
    DIANA_ISSUER_COORDINATOR,
    DIANA_ISSUER_OPERATOR_CLI,
    DIANA_ISSUER_COUNT
} diana_issuer;

/** Causa de reinicio registrada en diagnostic (no forma parte del contrato). */
typedef enum {
    DIANA_RESET_UNKNOWN = 0,
    DIANA_RESET_POWERON,
    DIANA_RESET_SOFTWARE,
    DIANA_RESET_PANIC,
    DIANA_RESET_WATCHDOG,
    DIANA_RESET_BROWNOUT,
    DIANA_RESET_OTA,
    DIANA_RESET_COUNT
} diana_reset_reason;

/* --- conversion enum <-> cadena del contrato ------------------------------ */

const char *diana_target_state_str(diana_target_state v);
const char *diana_module_state_str(diana_module_state v);
const char *diana_hit_classification_str(diana_hit_classification v);
const char *diana_selector_str(diana_selector_position v);
const char *diana_role_str(diana_module_role v);
const char *diana_detection_method_str(diana_detection_method v);
const char *diana_command_reject_reason_str(diana_command_reject_reason v);
const char *diana_diagnostic_kind_str(diana_diagnostic_kind v);
const char *diana_severity_str(diana_severity v);
const char *diana_command_action_str(diana_command_action v);
const char *diana_command_result_str(diana_command_result v);
const char *diana_presence_reason_str(diana_presence_reason v);
const char *diana_ota_action_str(diana_ota_action v);
const char *diana_issuer_str(diana_issuer v);
const char *diana_reset_reason_str(diana_reset_reason v);

int diana_target_state_parse(const char *s, diana_target_state *out);
int diana_command_action_parse(const char *s, diana_command_action *out);
int diana_issuer_parse(const char *s, diana_issuer *out);
int diana_ota_action_parse(const char *s, diana_ota_action *out);

/** Rol efectivo a partir del selector fisico. AUTO se resuelve fuera (eleccion). */
diana_module_role diana_role_from_selector(diana_selector_position sel);

#ifdef __cplusplus
}
#endif
/**
 * commandEnvelope.command_plane / common.schema.json#/$defs/commandPlane
 * (contrato v1.4, ver docs/coordination/DECISION-PLANOS-DE-AUTORIDAD.md).
 * const por canal: GAME solo en module/{id}/command, MAINTENANCE solo en
 * module/{id}/maintenance/command. El firmware IMPONE esa constancia, no
 * confia en que el emisor la respete (ver diana_check_command_envelope()).
 */
typedef enum {
    DIANA_PLANE_GAME = 0,
    DIANA_PLANE_MAINTENANCE,
    DIANA_PLANE_DEVICE_MANAGEMENT,
    DIANA_PLANE_COUNT
} diana_command_plane;

/* D1b: añadido de forma ADITIVA sobre la base fisica. NO se ha sustituido
 * este fichero por el de ola/h3-fw, que es anterior al trabajo DO-only y a
 * ADR-0007 y revertiria el discriminador de perfil de deteccion. */

#endif /* DIANA_TYPES_H */
