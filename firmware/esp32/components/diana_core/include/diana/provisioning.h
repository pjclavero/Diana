/**
 * @file provisioning.h
 * @brief Protocolo D1b v1.7.1 (plano DEVICE_MANAGEMENT) en el DISPOSITIVO.
 *
 * Cuarta implementacion del contrato, junto a la de referencia en Python
 * (contracts/validate.py), la del backend (server/) y la del simulador
 * (simulators/src/domain/provisioning/). Cubre la parte que NO depende del
 * hardware fisico: canonicalizacion, verificacion ECDSA, delegacion,
 * maquina de estados y persistencia.
 *
 * REGLAS QUE ESTE MODULO IMPONE (y que ningun JSON Schema puede imponer):
 *
 *  - `retained == true` se rechaza SIEMPRE, lo PRIMERO de todo, con
 *    `retained_provisioning_rejected`. Un mensaje retenido es un replay
 *    servido por el propio broker; la ACL de Mosquitto no sabe condicionar
 *    una regla al flag retain, asi que este es el UNICO punto donde la regla
 *    existe. Se comprueba ANTES de la firma a proposito: un retenido con
 *    firma valida y secuencia buena tiene que morir POR RETENIDO.
 *
 *  - NO existe ningun camino "si faltan epoch o sequence, tratarlo como
 *    comando antiguo". Un mensaje incompleto se rechaza con
 *    `malformed_provisioning_message`. Sin modo heredado.
 *
 *  - El algoritmo de firma es FIJO (diana_p256_*). `signature_alg` se compara
 *    contra la unica constante admitida y se rechaza si difiere; NO se usa
 *    para SELECCIONAR verificador. Un selector dinamico permitiria degradar
 *    el algoritmo desde el propio mensaje.
 *
 *  - Fallo CERRADO en todo: firma invalida, raiz distinta, secuencia vieja,
 *    delegacion invalida o rotacion repetida no aplican NADA.
 *
 * ORDEN DE VERIFICACION (README §0-septies punto 1, normativo): retenido,
 * conformidad estructural, direccionamiento, algoritmo, huella de la raiz,
 * delegacion (firma, sistema, version, secuencia, extraccion de la clave
 * operativa), firma de la ORDEN, antirrepetición de la orden, estado del
 * dominio, persistencia, respuesta. Verificar la orden antes que la
 * delegacion seria confiar en la clave antes de saber si se puede confiar en
 * ella; `diana_prov_outcome.trace` deja constancia EJECUTADA de ese orden
 * para que una prueba pueda demostrar construccion, no solo resultado.
 *
 * LOS ESTADOS SON CINCO. `PROVISIONED` y `COMMITTED` son RESULTADOS de una
 * orden (diana_prov_result), no estados del dispositivo: tras un PROVISION
 * aplicado el estado es READY, y tras un COMMIT aplicado tambien. No existe
 * un sexto estado y anadirlo rompe el enum del contrato.
 */
#ifndef DIANA_PROVISIONING_H
#define DIANA_PROVISIONING_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/p256.h"
#include "diana/seq_guard.h"

#ifdef __cplusplus
extern "C" {
#endif

/* --------------------------------------------------------------- limites -- */

#define DIANA_PROV_UUID_LEN        36    /**< "8-4-4-4-12", sin NUL */
#define DIANA_PROV_UUID_BUF        37
#define DIANA_PROV_ID_BUF          64    /**< identifier: hasta 63 chars + NUL */
#define DIANA_PROV_FP_HEX_BUF      65    /**< SHA-256 en hex + NUL */
#define DIANA_PROV_B64_BUF         256   /**< claves/firmas en base64url + NUL */
#define DIANA_PROV_ALG_BUF         48

/** Unico literal de algoritmo admitido. NO es un selector: es una constante
 *  contra la que se compara y se rechaza. */
#define DIANA_PROV_SIGNATURE_ALG   "ECDSA-P256-SHA256-P1363-B64URL"
#define DIANA_PROV_DELEGATION_SCOPE "DIANA_PROVISIONING"
#define DIANA_PROV_DELEGATION_VERSION 1

/** Separadores de dominio de las DOS cadenas canonicas. Distintos a proposito:
 *  ninguna firma de una vale nunca en la otra. */
#define DIANA_PROV_DOMAIN_SEP      "diana/provision/v1"
#define DIANA_PROV_DELEG_DOMAIN_SEP "diana/delegation/v1"

/** Marcador de registro AUSENTE en la cadena canonica: 0xFFFFFFFF, sin valor. */
#define DIANA_PROV_ABSENT_MARKER   0xFFFFFFFFu
/** Prefijo de longitud: 4 bytes big-endian. Sin delimitadores. */
#define DIANA_PROV_LEN_PREFIX      4

/** Cota superior del tamano de una cadena canonica (13 registros holgados). */
#define DIANA_PROV_CANON_MAX       1024

/* NVS: el espacio y la clave de la autoridad YA NO son publicos. Viven en
 * components/diana_core/src/prov_nvs.h porque nombrar el espacio ES la
 * capacidad de escribir en el. Para leer material de fabrica desde fuera del
 * nucleo existe diana_prov_factory_read(), declarada mas abajo. */

/* ----------------------------------------------------------------- tipos -- */

/** Los CINCO estados del contrato. Ni uno mas. */
typedef enum {
    DIANA_PROV_UNPROVISIONED = 0,
    DIANA_PROV_READY,
    DIANA_PROV_PREPARED,
    DIANA_PROV_STALE,
    DIANA_PROV_QUARANTINED,
} diana_prov_state;

typedef enum {
    DIANA_PROV_ACTION_PROVISION = 0,
    DIANA_PROV_ACTION_PREPARE,
    DIANA_PROV_ACTION_COMMIT,
} diana_prov_action;

typedef enum {
    DIANA_PROV_MODE_NONE = 0,   /**< ausente (PROVISION no lleva modo) */
    DIANA_PROV_MODE_NORMAL,
    DIANA_PROV_MODE_EMERGENCY,
} diana_prov_mode;

/** RESULTADOS de una orden. PROVISIONED y COMMITTED viven aqui, no en estados. */
typedef enum {
    DIANA_PROV_RESULT_PROVISIONED = 0,
    DIANA_PROV_RESULT_PREPARED,
    DIANA_PROV_RESULT_COMMITTED,
    DIANA_PROV_RESULT_AUTHORITY_UNPROVISIONED,
    DIANA_PROV_RESULT_AUTHORITY_STALE,
    DIANA_PROV_RESULT_REJECTED,
} diana_prov_result;

/** Vocabulario CERRADO de motivos de rechazo (module-provision-state.schema.json). */
typedef enum {
    DIANA_PROV_REASON_NONE = -1,
    DIANA_PROV_REASON_INVALID_SIGNATURE = 0,
    DIANA_PROV_REASON_SIGNATURE_ALGORITHM_REJECTED,
    DIANA_PROV_REASON_PROVISIONING_KEY_MISMATCH,
    DIANA_PROV_REASON_PROVISIONING_SEQUENCE_REJECTED,
    DIANA_PROV_REASON_ROTATION_ID_REPLAYED,
    DIANA_PROV_REASON_ROTATION_ID_UNKNOWN,
    DIANA_PROV_REASON_CURRENT_EPOCH_MISMATCH,
    DIANA_PROV_REASON_EPOCH_NOT_PROVISIONED,
    DIANA_PROV_REASON_EPOCH_REUSE_REJECTED,
    DIANA_PROV_REASON_ALREADY_PROVISIONED,
    DIANA_PROV_REASON_RETAINED_PROVISIONING_REJECTED,
    DIANA_PROV_REASON_DEVICE_MISMATCH,
    DIANA_PROV_REASON_SYSTEM_MISMATCH,
    DIANA_PROV_REASON_MALFORMED_PROVISIONING_MESSAGE,
    DIANA_PROV_REASON_DELEGATION_MISSING,
    DIANA_PROV_REASON_DELEGATION_INVALID_SIGNATURE,
    DIANA_PROV_REASON_DELEGATION_ROOT_KEY_MISMATCH,
    DIANA_PROV_REASON_DELEGATION_SEQUENCE_REJECTED,
    DIANA_PROV_REASON_DELEGATION_SEQUENCE_CONFLICT,
    DIANA_PROV_REASON_DELEGATION_VERSION_REJECTED,
} diana_prov_reason;

/** Credencial de delegacion raiz -> clave operativa, ya deserializada. */
typedef struct {
    uint64_t delegation_version;
    char     delegation_id[DIANA_PROV_UUID_BUF];
    char     root_key_id[DIANA_PROV_ID_BUF];
    char     operational_key_id[DIANA_PROV_ID_BUF];
    /** SubjectPublicKeyInfo DER en base64url, tal cual viaja en el contrato. */
    char     operational_public_key[DIANA_PROV_B64_BUF];
    char     scope[DIANA_PROV_ID_BUF];
    uint64_t delegation_sequence;
    char     system_id[DIANA_PROV_ID_BUF];
    char     signature_alg[DIANA_PROV_ALG_BUF];
    char     root_signature[DIANA_PROV_B64_BUF];
} diana_prov_delegation;

/**
 * Orden de aprovisionamiento ya deserializada. El firmware NO parsea JSON en
 * este modulo (misma convencion que diana_command): quien parsea rellena esta
 * estructura y marca los `has_*`. Un campo obligatorio ausente NO se
 * "interpreta": se rechaza.
 *
 * Los campos de texto vacios ("") significan AUSENTE, que es exactamente lo
 * que la cadena canonica serializa como 0xFFFFFFFF.
 */
typedef struct {
    char     request_id[DIANA_PROV_UUID_BUF];
    char     device_id[DIANA_PROV_ID_BUF];
    char     system_id[DIANA_PROV_ID_BUF];
    diana_prov_action action;
    diana_prov_mode   mode;              /**< NONE = ausente */
    uint64_t provisioning_sequence;
    char     rotation_id[DIANA_PROV_UUID_BUF];
    char     current_epoch[DIANA_PROV_UUID_BUF];
    char     next_epoch[DIANA_PROV_UUID_BUF];
    char     epoch[DIANA_PROV_UUID_BUF];
    char     provision_id[DIANA_PROV_UUID_BUF];
    uint64_t issued_at_ms;
    char     provisioning_key_fingerprint[DIANA_PROV_FP_HEX_BUF];
    char     signature_alg[DIANA_PROV_ALG_BUF];
    char     signature[DIANA_PROV_B64_BUF];

    bool                  has_delegation;
    diana_prov_delegation delegation;

    /** Indicadores de presencia de los campos que el esquema exige. Los
     *  rellena el parseador. Si alguno obligatorio falta, el mensaje es
     *  malformado y NO hay ninguna rama que lo trate como "orden antigua". */
    bool has_request_id;
    bool has_provisioning_sequence;
    bool has_issued_at_ms;
    bool has_schema_version_1;
    bool has_command_plane_device_management;
} diana_prov_command;

/**
 * Estado PERSISTENTE. Es el unico sitio donde vive la autoridad del modulo, y
 * la unica via de escritura es diana_prov_handle(): no hay ninguna funcion que
 * toque active_epoch, pending_epoch o delegation_sequence "por detras".
 *
 * Presupuesto NVS: sizeof(diana_prov_persist) ~ 380 bytes en una sola clave.
 * Contra el presupuesto medido del carril (7344 B logicos / ~8027 B fisicos,
 * 3 paginas libres contando la huella de 32 B) cabe holgadamente; ver informe.
 */
typedef struct {
    char     active_epoch[DIANA_PROV_UUID_BUF];    /**< "" = null */
    char     pending_epoch[DIANA_PROV_UUID_BUF];   /**< "" = null */
    uint64_t last_provisioning_sequence;
    char     last_rotation_id[DIANA_PROV_UUID_BUF];/**< "" = null */
    char     provisioning_key_fingerprint[DIANA_PROV_FP_HEX_BUF];
    uint8_t  state;                                /**< diana_prov_state */
    uint8_t  pending_mode;                         /**< diana_prov_mode */
    uint64_t last_delegation_sequence;             /**< 0 = ninguna aceptada */
    /** Clave operativa vigente, ya DECODIFICADA a punto SEC1 no comprimido.
     *  Se guarda decodificada para no re-decodificar en cada arranque. */
    uint8_t  operational_key[DIANA_P256_PUBKEY_LEN];
    bool     has_operational_key;
    /** delegation_fingerprint = SHA-256 del payload canonico de la delegacion,
     *  SIN la firma: ECDSA no es determinista y meterla dentro haria el
     *  fingerprint inutil como identidad de la delegacion. 32 bytes. */
    uint8_t  delegation_fingerprint[32];
    bool     has_delegation_fingerprint;
} diana_prov_persist;

/** Contexto del modulo. */
typedef struct {
    const diana_hal *hal;              /**< NULL = solo memoria (tests puros) */
    char  device_id[DIANA_PROV_ID_BUF];
    char  system_id[DIANA_PROV_ID_BUF];
    /** Raiz de aprovisionamiento FIJADA en el flasheo (punto SEC1 de 65 bytes).
     *  Sin ella, TODA credencial se rechaza con delegation_invalid_signature:
     *  fallo cerrado, nunca "acepta porque no puede comprobar". */
    uint8_t root_key[DIANA_P256_PUBKEY_LEN];
    bool    has_root_key;
    /** Nombre de fabrica de la raiz, SOLO diagnostico
     *  (delegation_root_key_mismatch). "" desactiva la comprobacion: el
     *  dispositivo NO elige raiz por este campo, verifica siempre contra la
     *  unica que tiene fijada. */
    char    root_key_id[DIANA_PROV_ID_BUF];

    diana_prov_persist st;

    /** Guardas antirrepeticion POR PLANO. Si no es NULL, un cambio de
     *  autoridad (PROVISION o COMMIT aplicados) reprovisiona las nueve
     *  combinaciones (issuer, plane) con el nuevo epoch. */
    diana_seq_guard_set *guards;

    /** Diagnostico en RAM (se pierde al reiniciar). */
    uint32_t undeliverable_rejections;
    uint32_t applied_bootstraps;
} diana_prov_ctx;

#define DIANA_PROV_TRACE_MAX 24

/** Resultado de tratar un mensaje. */
typedef struct {
    bool              publish;    /**< false = descartado sin respuesta posible */
    diana_prov_result result;
    diana_prov_state  state;
    diana_prov_reason reason;
    bool              applied;
    bool              authority_changed;
    char              new_active_epoch[DIANA_PROV_UUID_BUF];
    /** Pasos EJECUTADOS, en orden. Permite demostrar el orden de verificacion,
     *  no solo el veredicto final. */
    const char       *trace[DIANA_PROV_TRACE_MAX];
    size_t            trace_len;
} diana_prov_outcome;

/* ---------------------------------------------------- cadenas canonicas -- */

/**
 * Cadena canonica de la ORDEN (13 registros, §0-sexies + §0-septies punto 4).
 * longitud(4 bytes big-endian) ++ valor(UTF-8); ausente = 0xFFFFFFFF sin valor.
 * Sin delimitadores: ningun contenido de campo puede desplazar a los
 * siguientes, y un valor que sea literalmente "-" no se confunde con el
 * registro reservado de ausencia.
 *
 * @return bytes escritos, o 0 si no caben en `out`.
 */
size_t diana_prov_canonical(const diana_prov_command *cmd, uint8_t *out, size_t cap);

/**
 * Cadena canonica de la CREDENCIAL DE DELEGACION (9 registros, §0-septies
 * punto 2). Separador de dominio PROPIO. `signature_alg` y `root_signature`
 * NO entran.
 */
size_t diana_prov_delegation_canonical(const diana_prov_delegation *d,
                                       uint8_t *out, size_t cap);

/** delegation_fingerprint = SHA-256 de la cadena canonica de la delegacion. */
void diana_prov_delegation_fingerprint(const diana_prov_delegation *d, uint8_t out[32]);

/**
 * Extrae el punto SEC1 no comprimido (65 bytes) de un SubjectPublicKeyInfo
 * DER de P-256 codificado en base64url. Comparacion ESTRICTA contra el prefijo
 * DER fijo de secp256r1: no es un parser DER generico, y eso es deliberado
 * (menos superficie, cero ambiguedad de codificacion).
 */
bool diana_prov_decode_pubkey(const char *spki_b64url,
                              uint8_t out[DIANA_P256_PUBKEY_LEN]);

/* --------------------------------------------------------------- modulo -- */

/** Estado de FABRICA: sin autoridad de ninguna clase. */
void diana_prov_factory_state(diana_prov_persist *st, const char *fingerprint_hex);

/**
 * Inicializa el contexto y CARGA el estado desde NVS si `hal` lo permite.
 * Si no hay estado guardado, deja el de fabrica con la huella indicada.
 */
void diana_prov_init(diana_prov_ctx *ctx, const diana_hal *hal,
                     const char *device_id, const char *system_id,
                     const char *fingerprint_hex);

/** Fija la raiz de aprovisionamiento (punto SEC1 de 65 bytes) del flasheo. */
void diana_prov_set_root_key(diana_prov_ctx *ctx,
                             const uint8_t root_key[DIANA_P256_PUBKEY_LEN],
                             const char *root_key_id);

/**
 * Lee material de FABRICA del espacio NVS de la autoridad. SOLO LECTURA.
 *
 * Es la unica via por la que un fichero fuera de diana_core puede tocar ese
 * espacio, y por construccion no puede escribir: el espacio no se nombra
 * desde fuera. Sirve para cargar la raiz de aprovisionamiento y el
 * fingerprint que deja el utillaje de fabrica.
 *
 * Devuelve true si la clave existe y se leyo entera. Cualquier otro caso es
 * false y el llamante debe fallar cerrado.
 */
bool diana_prov_factory_read(const diana_hal *hal, const char *key,
                             void *out, size_t cap, size_t *out_len);

/** Asocia las guardas antirrepeticion por plano (opcional). */
void diana_prov_set_guards(diana_prov_ctx *ctx, diana_seq_guard_set *guards);

/**
 * Trata una orden recibida en targets/v1/module/{id}/provision.
 *
 * @param retained  flag de TRANSPORTE MQTT: no viaja en el payload, por eso
 *                  ningun esquema puede verlo, y por eso se pasa aparte.
 */
void diana_prov_handle(diana_prov_ctx *ctx, const diana_prov_command *cmd,
                       bool retained, diana_prov_outcome *out);

/* ------------------------------------------------- entrada de RUNTIME ----- */

/**
 * Deserializa module-provision-command.schema.json (prov_parse.c). NO valida:
 * rellena la estructura y los `has_*`, y quien dicta el veredicto sigue siendo
 * diana_prov_handle(). Fallo CERRADO: si la sintaxis no cuadra, `out` queda a
 * cero y el mensaje muere despues como malformed_provisioning_message.
 *
 * @return true si el payload es JSON sintacticamente valido y todos sus campos
 *         conocidos caben; false si no. El llamante NO necesita mirar el
 *         retorno para ser correcto.
 */
bool diana_prov_parse(const char *payload, size_t len, diana_prov_command *out);

/**
 * Camino de RUNTIME completo para un mensaje recibido en
 * targets/v1/module/{id}/provision: payload crudo -> parser -> diana_prov_handle
 * -> NVS -> veredicto.
 *
 * @param retained  flag de TRANSPORTE MQTT (esp_mqtt_event_t::retain). No viaja
 *                  en el payload y ningun esquema puede verlo, por eso llega
 *                  hasta aqui como parametro y no como campo.
 * @param cmd       la orden deserializada, del llamante: se necesita despues
 *                  para componer la respuesta (request_id, action...).
 */
void diana_prov_message(diana_prov_ctx *ctx, const char *payload, size_t len,
                        bool retained, diana_prov_command *cmd,
                        diana_prov_outcome *out);

/** Declaracion NO solicitada del arranque, o publish=false si no hay nada que
 *  declarar (READY/PREPARED: hay autoridad utilizable). */
void diana_prov_connect_declaration(diana_prov_ctx *ctx, diana_prov_outcome *out);

/** Acepta ordenes del plano GAME? Solo READY y PREPARED. */
bool diana_prov_accepts_game(const diana_prov_ctx *ctx);

/** Serializa la respuesta module-provision-state. @return longitud, 0 si no cabe. */
size_t diana_prov_state_json(const diana_prov_ctx *ctx, const diana_prov_command *cmd,
                             const diana_prov_outcome *out, char *buf, size_t cap);

/* Nombres de contrato de cada enumerado (types.c los valida contra el esquema). */
const char *diana_prov_state_str(diana_prov_state s);
const char *diana_prov_result_str(diana_prov_result r);
const char *diana_prov_reason_str(diana_prov_reason r);
const char *diana_prov_action_str(diana_prov_action a);
const char *diana_prov_mode_str(diana_prov_mode m);

/* Persistencia (expuesta para las pruebas de reinicio). */
bool diana_prov_load(diana_prov_ctx *ctx);
bool diana_prov_save(const diana_prov_ctx *ctx);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_PROVISIONING_H */
