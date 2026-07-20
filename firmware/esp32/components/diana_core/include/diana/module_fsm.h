/**
 * @file module_fsm.h
 * @brief Maquina de estados del modulo (dosier 13.3).
 *
 * Codigo puro: no toca hardware, no llama al HAL. Se prueba integramente en
 * host. La tabla de transiciones es explicita: cualquier par (estado, evento)
 * no declarado se RECHAZA y se contabiliza como transicion invalida.
 *
 *   ARRANQUE -> AUTODIAGNOSTICO -> RED -> REGISTRO -> {ERROR | LISTO}
 *   LISTO -> {CALIBRACION | MANTENIMIENTO | PARTIDA}
 *   PARTIDA: PREPARACION -> CUENTA_ATRAS -> ACTIVA -> {PAUSADA} -> FINALIZADA
 */
#ifndef DIANA_MODULE_FSM_H
#define DIANA_MODULE_FSM_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DIANA_EV_SELFTEST_START = 0,
    DIANA_EV_SELFTEST_OK,
    DIANA_EV_SELFTEST_FAIL,
    DIANA_EV_LINK_UP,
    DIANA_EV_LINK_DOWN,
    DIANA_EV_MQTT_CONNECTED,
    DIANA_EV_MQTT_DISCONNECTED,
    DIANA_EV_REGISTERED,
    DIANA_EV_REGISTER_TIMEOUT,
    DIANA_EV_CALIBRATION_START,
    DIANA_EV_CALIBRATION_END,
    DIANA_EV_MAINTENANCE_ON,
    DIANA_EV_MAINTENANCE_OFF,
    DIANA_EV_GAME_PREPARE,
    DIANA_EV_GAME_COUNTDOWN,
    DIANA_EV_GAME_START,
    DIANA_EV_GAME_PAUSE,
    DIANA_EV_GAME_RESUME,
    DIANA_EV_GAME_FINISH,
    DIANA_EV_GAME_ABORT,
    DIANA_EV_ERROR_RAISED,
    DIANA_EV_ERROR_CLEARED,
    DIANA_EV_COUNT
} diana_module_event;

typedef struct {
    diana_module_state state;
    diana_module_state previous;
    uint32_t transitions;
    uint32_t rejected;          /* transiciones invalidas rechazadas */
    uint64_t entered_at_us;
    diana_module_event last_rejected_event;
} diana_module_fsm;

void diana_module_fsm_init(diana_module_fsm *fsm, uint64_t now_us);

/** true si (estado actual, ev) es una transicion declarada. */
bool diana_module_fsm_can(const diana_module_fsm *fsm, diana_module_event ev);

/**
 * Aplica el evento. Devuelve true si transiciono. Si la transicion no esta
 * declarada devuelve false, NO cambia de estado e incrementa 'rejected'.
 */
bool diana_module_fsm_apply(diana_module_fsm *fsm, diana_module_event ev,
                            uint64_t now_us);

/** true si el modulo esta en cualquier fase de partida no terminada.
 *  Usado por OTA: prohibido actualizar durante una partida (dosier 13.6). */
bool diana_module_fsm_game_in_progress(const diana_module_fsm *fsm);

/** true si el modulo acepta impactos puntuables. */
bool diana_module_fsm_accepts_hits(const diana_module_fsm *fsm);

const char *diana_module_event_str(diana_module_event ev);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_MODULE_FSM_H */
