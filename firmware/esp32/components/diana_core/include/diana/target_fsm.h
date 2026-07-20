/**
 * @file target_fsm.h
 * @brief Maquina de estados de una diana (dosier 13.4) y del conjunto de 9.
 *
 * Codigo puro, probado en host. Los 12 estados son los de
 * common.schema.json#/$defs/targetState.
 *
 *   APAGADA -> SEGURA -> ACTIVA --impacto valido--> ALCANZADA -> {SEGURA|ACTIVA|APAGADA}
 *   Adicionales: CUENTA_ATRAS, PENALIZACION, CALIBRACION, BLOQUEADA,
 *                ERROR_SENSOR, MANTENIMIENTO, DESHABILITADA, ERROR.
 */
#ifndef DIANA_TARGET_FSM_H
#define DIANA_TARGET_FSM_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DIANA_TEV_ENABLE = 0,        /* apagada -> segura */
    DIANA_TEV_DISABLE,           /* -> apagada */
    DIANA_TEV_ARM,               /* segura -> activa */
    DIANA_TEV_DISARM,            /* activa -> segura */
    DIANA_TEV_COUNTDOWN,         /* segura -> cuenta atras */
    DIANA_TEV_HIT_VALID,         /* activa -> alcanzada */
    DIANA_TEV_HIT_PENALTY,       /* segura golpeada -> penalizacion */
    DIANA_TEV_HIT_CLEARED,       /* alcanzada/penalizacion -> segura */
    DIANA_TEV_ROUND_END,         /* -> apagada */
    DIANA_TEV_CALIBRATION_START,
    DIANA_TEV_CALIBRATION_END,
    DIANA_TEV_LOCK,              /* bloqueo por el coordinador */
    DIANA_TEV_UNLOCK,
    DIANA_TEV_SENSOR_FAULT,
    DIANA_TEV_SENSOR_RECOVERED,
    DIANA_TEV_MAINTENANCE_ON,
    DIANA_TEV_MAINTENANCE_OFF,
    DIANA_TEV_ADMIN_DISABLE,     /* -> disabled, requiere accion de operador */
    DIANA_TEV_ADMIN_ENABLE,
    DIANA_TEV_ERROR,
    DIANA_TEV_ERROR_CLEAR,
    DIANA_TEV_COUNT
} diana_target_event;

typedef struct {
    diana_target_state state;
    diana_target_state previous;
    uint8_t  index;              /* 1..9 */
    bool     enabled;
    uint32_t transitions;
    uint32_t rejected;
    uint64_t entered_at_us;
    uint64_t blanking_until_us;  /* bloqueo antirrebote tras impacto valido */
    uint32_t hits;
} diana_target;

typedef struct {
    diana_target t[DIANA_TARGET_COUNT];
} diana_target_set;

void diana_target_init(diana_target *tg, uint8_t index, uint64_t now_us);
void diana_target_set_init(diana_target_set *set, uint64_t now_us);

bool diana_target_can(const diana_target *tg, diana_target_event ev);
bool diana_target_apply(diana_target *tg, diana_target_event ev, uint64_t now_us);

/** Acceso por indice de contrato (1..9). NULL fuera de rango. */
diana_target *diana_target_at(diana_target_set *set, uint8_t target_index);
const diana_target *diana_target_at_const(const diana_target_set *set,
                                          uint8_t target_index);

/** true si la diana esta en un estado en el que un impacto puntua. */
bool diana_target_is_scorable(const diana_target *tg);

const char *diana_target_event_str(diana_target_event ev);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_TARGET_FSM_H */
