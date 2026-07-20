/**
 * @file command.h
 * @brief Validacion de comandos entrantes (contrato MQTT §6, dosier 23.3).
 *
 * Un modulo DESCARTA un comando si:
 *   1. `schema_version` es superior a la soportada, o el sobre esta incompleto.
 *   2. Los `params` obligatorios de esa accion no estan (hallazgo H-07:
 *      set_targets exige targets, set_all_targets exige state, identify exige
 *      duration_ms, set_maintenance exige enabled).
 *   3. `command_id` ya fue ejecutado (cache de los ULTIMOS 128).
 *   4. `nonce` <= ultimo nonce aceptado de ESE emisor, PERSISTIDO EN NVS.
 *   5. Ha caducado.
 *
 * ---------------------------------------------------------------------------
 * CADUCIDAD (hallazgo H-05 del supervisor)
 * ---------------------------------------------------------------------------
 * La redaccion original medía la caducidad "desde la recepcion del canal". Eso
 * no protege de nada: con QoS 1 cada reentrega reinicia la ventana, y un
 * comando capturado hoy y reinyectado manana llega con sus 5 s intactos.
 *
 * Aqui se mide contra `issued_at_ms`, que es del EMISOR y no se reinicia. Eso
 * obliga a comparar contra hora de PARED, que un modulo puede no tener: el
 * propio contrato admite `epoch_ms` nulo.
 *
 * Politica adoptada, explicita:
 *
 *   a) CON reloj sincronizado: edad = ahora_epoch - issued_at_ms.
 *      - edad > expires_in_ms -> EXPIRED.
 *      - emitido en el futuro mas alla de DIANA_CLOCK_SKEW_TOLERANCE_MS
 *        -> REJECTED (reloj descuadrado o sobre falsificado).
 *
 *   b) SIN reloj sincronizado: la caducidad NO SE PUEDE EVALUAR. El comando no
 *      se rechaza por ese motivo —hacerlo dejaria inoperante a un modulo sin
 *      SNTP—, pero se acepta apoyandose en el NONCE PERSISTIDO como defensa
 *      principal, y el veredicto lo dice en `detail` para que sea visible en
 *      `module/…/status`. No se finge una comprobacion que no se ha hecho.
 *
 *   c) En AMBOS casos se mantiene ademas una guarda monotonica local: si el
 *      propio modulo tardo mas de `expires_in_ms` en procesar el mensaje desde
 *      que lo recibio, se descarta. Protege de actuar sobre ordenes que se
 *      quedaron encoladas dentro del propio firmware. Es una comprobacion
 *      ADICIONAL, nunca la unica.
 *
 * La defensa REAL contra reproduccion es el nonce, y por eso se persiste en NVS
 * con el mismo rigor que `local_sequence`: una cache en RAM se pierde al
 * reiniciar y reabre la ventana entera.
 */
#ifndef DIANA_COMMAND_H
#define DIANA_COMMAND_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** El contrato fija explicitamente 128. */
#define DIANA_CMD_CACHE 128

/** Tolerancia de adelanto del reloj del emisor respecto al del modulo. */
#define DIANA_CLOCK_SKEW_TOLERANCE_MS 30000

/**
 * Techo de validez para acciones criticas (H-05 c).
 * El contrato admite hasta 600 000 ms para cualquier comando. Diez minutos de
 * validez para un `reboot` es una ventana de reproduccion enorme. El firmware
 * la acota para las acciones que pueden interrumpir una partida o dejar el
 * modulo fuera de servicio.
 *
 * OJO: esto es MAS ESTRICTO que el contrato vigente. Pendiente de ratificar en
 * contracts/mqtt/README.md; hasta entonces, un backend que emita un `reboot`
 * con 600 000 ms recibe un rechazo explicito y trazable, no un silencio.
 */
#define DIANA_CMD_CRITICAL_MAX_EXPIRES_MS 15000

typedef struct {
    char     command_id[DIANA_UUID_LEN];
    uint64_t issued_at_ms;
    uint32_t expires_in_ms;
    uint64_t nonce;
    diana_issuer issuer;
    char     module_id[DIANA_ID_MAXLEN];
    diana_command_action action;
    uint32_t schema_version;

    /* Presencia de los params, para la validacion por accion (H-07). El core no
     * parsea JSON: quien lo parsea rellena estos indicadores. */
    bool     has_params;
    bool     param_targets;        /* params.targets presente */
    uint8_t  param_targets_count;  /* el contrato exige minItems 1 */
    bool     param_state;
    bool     param_duration_ms;
    bool     param_enabled;
} diana_command;

/** Reloj para evaluar la caducidad. */
typedef struct {
    uint64_t recv_us;   /**< monotonico, instante de recepcion del mensaje */
    uint64_t now_us;    /**< monotonico, instante de proceso */
    uint64_t epoch_ms;  /**< hora de pared; 0 = SIN sincronizar */
} diana_command_clock;

typedef struct {
    const diana_hal *hal;   /* para persistir el nonce; puede ser NULL */

    char     ids[DIANA_CMD_CACHE][DIANA_UUID_LEN];
    uint16_t next;
    uint16_t used;

    uint64_t last_nonce[DIANA_ISSUER_COUNT];
    bool     nonce_seen[DIANA_ISSUER_COUNT];

    uint32_t accepted;
    uint32_t accepted_without_clock;  /* aceptados sin poder verificar caducidad */
    uint32_t rejected_duplicate;
    uint32_t rejected_nonce;
    uint32_t rejected_expired;
    uint32_t rejected_invalid;
    uint32_t rejected_schema;
    uint32_t rejected_params;
    uint32_t rejected_skew;
} diana_command_guard;

typedef struct {
    diana_command_result result;
    char detail[121];   /* last_command.detail maxLength 120 */
} diana_command_verdict;

/**
 * Inicializa el guardian y CARGA de NVS el ultimo nonce aceptado por emisor.
 * Con hal == NULL funciona solo en memoria.
 */
void diana_command_guard_init(diana_command_guard *g, const diana_hal *hal);

/**
 * Valida un comando recibido.
 *
 * Un veredicto ACCEPTED consume el nonce (y lo PERSISTE) y registra el
 * command_id: repetir el mismo comando devuelve DUPLICATE la segunda vez.
 */
diana_command_verdict diana_command_validate(diana_command_guard *g,
                                             const diana_command *cmd,
                                             const char *own_module_id,
                                             const diana_command_clock *clock);

bool diana_command_seen(const diana_command_guard *g, const char *command_id);

/** true si la accion puede interrumpir el servicio y merece techo reducido. */
bool diana_command_is_critical(diana_command_action action);

/** Ultimo nonce aceptado de un emisor (para diagnostico). */
uint64_t diana_command_last_nonce(const diana_command_guard *g,
                                  diana_issuer issuer);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_COMMAND_H */
