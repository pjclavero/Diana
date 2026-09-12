/**
 * Rol de COORDINADOR (modulo en posicion PRINCIPAL).
 *
 * QUE FALTABA. El contrato reparte la autoridad por dominio: el backend manda
 * al sistema por `system/{id}/command` y es el COORDINADOR quien traduce eso a
 * ordenes de juego en `module/{id}/command`. El backend tiene PROHIBIDO escribir
 * ahi --- hay una prueba que recorre su AST para impedirlo --- y el firmware
 * nunca implemento el otro extremo: leia el selector, lo mapeaba a un rol y lo
 * publicaba en `status`, pero ninguna conducta dependia de el. Resultado: la
 * cadena de juego estaba cortada en el medio y ninguna partida era alcanzable.
 *
 * ALCANCE DE ESTA PIEZA (camino minimo, deliberado): recibir una orden de
 * sistema valida, decidir el UNICO `module/{id}/command` que corresponde y el
 * `game/state` que hay que publicar. No implementa los modos de juego: activa
 * la primera diana de la lista y deja el resto en SAFE, que es lo que hace
 * falta para demostrar que la autoridad funciona de verdad.
 *
 * LO QUE SI ES DEFINITIVO Y NO PUEDE RELAJARSE DESPUES:
 *   · solo coordina un modulo cuyo selector ESTABLE es PRINCIPAL;
 *   · en SATELITE no emite absolutamente nada, ni siquiera estado;
 *   · una orden repetida (mismo command_id) no genera un segundo efecto;
 *   · el nonce de salida es monotonico, porque el receptor lo exige;
 *   · nunca se emite mas de un comando por orden recibida.
 *
 * Es logica PURA: sin MQTT, sin FreeRTOS y sin reloj propio (el tiempo entra
 * como parametro). El transporte lo pone main/. Asi estas reglas se prueban en
 * la suite de host, que es justo lo que no se podia hacer con el rol viviendo
 * dentro del manejador de eventos.
 */
#ifndef DIANA_COORDINATOR_H
#define DIANA_COORDINATOR_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Acciones de system-command.schema.json#/properties/action. */
typedef enum {
    DIANA_SYS_ARM_GAME = 0,
    DIANA_SYS_START_GAME,
    DIANA_SYS_PAUSE_GAME,
    DIANA_SYS_RESUME_GAME,
    DIANA_SYS_ABORT_GAME,
    DIANA_SYS_END_GAME,
    DIANA_SYS_SET_TOPOLOGY,
    DIANA_SYS_IDENTIFY_ALL,
    DIANA_SYS_ALL_SAFE,
    DIANA_SYS_ACTION_COUNT
} diana_system_action;

const char *diana_system_action_str(diana_system_action v);
int diana_system_action_parse(const char *s, diana_system_action *out);

/** Fase de la partida (game-state.schema.json#/properties/phase). */
typedef enum {
    DIANA_GAME_ARMED = 0,
    DIANA_GAME_COUNTDOWN,
    DIANA_GAME_RUNNING,
    DIANA_GAME_PAUSED,
    DIANA_GAME_FINISHED,
    DIANA_GAME_ABORTED,
    DIANA_GAME_PHASE_COUNT
} diana_game_phase;

const char *diana_game_phase_str(diana_game_phase v);

/** Diana participante, en coordenadas de modulo + indice local. */
typedef struct {
    char    module_id[DIANA_ID_MAXLEN];
    uint8_t target_index;   /* 1..9 */
} diana_coord_target;

#define DIANA_COORD_MAX_TARGETS 9   /* camino minimo: un modulo */

/** Orden de sistema ya parseada. El nucleo no toca JSON. */
typedef struct {
    uint32_t schema_version;
    char     command_id[DIANA_UUID_LEN];
    char     system_id[DIANA_ID_MAXLEN];
    diana_system_action action;
    uint64_t issued_at_ms;
    uint32_t expires_in_ms;
    uint64_t nonce;
    diana_issuer issuer;

    bool     has_game;
    char     game_id[DIANA_UUID_LEN];
    char     round_id[DIANA_UUID_LEN];
    diana_coord_target targets[DIANA_COORD_MAX_TARGETS];
    uint8_t  target_count;
} diana_system_command;

/** Veredicto de una orden de sistema. */
typedef enum {
    DIANA_COORD_OK = 0,        /* aceptada: hay plan que ejecutar */
    DIANA_COORD_NOT_MINE,      /* este modulo no es el coordinador */
    DIANA_COORD_DUPLICATE,     /* command_id ya atendido */
    DIANA_COORD_OTHER_SYSTEM,  /* system_id ajeno */
    DIANA_COORD_INVALID,       /* sobre incompleto o incoherente */
    DIANA_COORD_RESULT_COUNT
} diana_coord_result;

/**
 * Plan de salida. Un plan puede pedir COMO MUCHO un comando de modulo: si
 * alguna vez hiciera falta mas de uno por orden, tiene que ser una decision
 * explicita y no un bucle que crece solo.
 */
typedef struct {
    bool     emit_command;                       /* publicar module/{id}/command */
    char     command_module_id[DIANA_ID_MAXLEN];
    /* set_targets: la diana que se ACTIVA; el resto del modulo pasa a SAFE. */
    uint8_t  active_target_index;                /* 0 = ninguna (todo a SAFE) */
    uint64_t command_nonce;                      /* monotonico del coordinador */

    bool     emit_state;                         /* publicar game/state */
    diana_game_phase phase;
    uint8_t  targets_remaining;
} diana_coord_plan;

/** Estado del coordinador. memset a cero = inactivo, sin partida. */
typedef struct {
    bool     have_game;
    char     game_id[DIANA_UUID_LEN];
    char     round_id[DIANA_UUID_LEN];
    diana_game_phase phase;
    diana_coord_target targets[DIANA_COORD_MAX_TARGETS];
    uint8_t  target_count;
    uint8_t  next_target;      /* siguiente a activar */
    uint64_t out_nonce;        /* ultimo nonce emitido */

    /* Dedup de ordenes de sistema. Pequena a proposito: el backend no repite
     * salvo reentrega, y una caché grande esconderia un emisor descontrolado. */
    char     seen[8][DIANA_UUID_LEN];
    uint8_t  seen_count;
    uint8_t  seen_next;
} diana_coordinator;

void diana_coordinator_reset(diana_coordinator *c);

/**
 * Decide que hacer con una orden de sistema.
 *
 * @param is_principal  true SOLO si el selector estable es PRINCIPAL. Es el
 *                      unico interruptor de autoridad: con false no se emite
 *                      nada, ni comando ni estado.
 * @param own_system_id sistema al que pertenece este modulo.
 * @param out           plan; se rellena a cero salvo que el resultado sea OK.
 */
diana_coord_result diana_coordinator_on_system_command(
    diana_coordinator *c, bool is_principal, const char *own_system_id,
    const diana_system_command *cmd, diana_coord_plan *out);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_COORDINATOR_H */
