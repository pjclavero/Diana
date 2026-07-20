#include "diana/module_fsm.h"

#include <stddef.h>

typedef struct {
    diana_module_state from;
    diana_module_event ev;
    diana_module_state to;
} transition;

/* Tabla explicita del dosier 13.3. Todo lo no listado se rechaza. */
static const transition TABLE[] = {
    /* arranque */
    {DIANA_MODULE_BOOT,          DIANA_EV_SELFTEST_START,   DIANA_MODULE_SELFTEST},
    {DIANA_MODULE_BOOT,          DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* autodiagnostico */
    {DIANA_MODULE_SELFTEST,      DIANA_EV_SELFTEST_OK,      DIANA_MODULE_NETWORK},
    {DIANA_MODULE_SELFTEST,      DIANA_EV_SELFTEST_FAIL,    DIANA_MODULE_ERROR},
    {DIANA_MODULE_SELFTEST,      DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* red */
    {DIANA_MODULE_NETWORK,       DIANA_EV_LINK_UP,          DIANA_MODULE_NETWORK},
    {DIANA_MODULE_NETWORK,       DIANA_EV_MQTT_CONNECTED,   DIANA_MODULE_REGISTERING},
    {DIANA_MODULE_NETWORK,       DIANA_EV_LINK_DOWN,        DIANA_MODULE_NETWORK},
    {DIANA_MODULE_NETWORK,       DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* registro */
    {DIANA_MODULE_REGISTERING,   DIANA_EV_REGISTERED,       DIANA_MODULE_READY},
    {DIANA_MODULE_REGISTERING,   DIANA_EV_REGISTER_TIMEOUT, DIANA_MODULE_ERROR},
    {DIANA_MODULE_REGISTERING,   DIANA_EV_MQTT_DISCONNECTED,DIANA_MODULE_NETWORK},
    {DIANA_MODULE_REGISTERING,   DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* listo */
    {DIANA_MODULE_READY,         DIANA_EV_CALIBRATION_START,DIANA_MODULE_CALIBRATION},
    {DIANA_MODULE_READY,         DIANA_EV_MAINTENANCE_ON,   DIANA_MODULE_MAINTENANCE},
    {DIANA_MODULE_READY,         DIANA_EV_GAME_PREPARE,     DIANA_MODULE_GAME_PREPARE},
    {DIANA_MODULE_READY,         DIANA_EV_MQTT_DISCONNECTED,DIANA_MODULE_NETWORK},
    {DIANA_MODULE_READY,         DIANA_EV_LINK_DOWN,        DIANA_MODULE_NETWORK},
    {DIANA_MODULE_READY,         DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* calibracion */
    {DIANA_MODULE_CALIBRATION,   DIANA_EV_CALIBRATION_END,  DIANA_MODULE_READY},
    {DIANA_MODULE_CALIBRATION,   DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* mantenimiento */
    {DIANA_MODULE_MAINTENANCE,   DIANA_EV_MAINTENANCE_OFF,  DIANA_MODULE_READY},
    {DIANA_MODULE_MAINTENANCE,   DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* partida */
    {DIANA_MODULE_GAME_PREPARE,  DIANA_EV_GAME_COUNTDOWN,   DIANA_MODULE_GAME_COUNTDOWN},
    {DIANA_MODULE_GAME_PREPARE,  DIANA_EV_GAME_ABORT,       DIANA_MODULE_READY},
    {DIANA_MODULE_GAME_PREPARE,  DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    {DIANA_MODULE_GAME_COUNTDOWN,DIANA_EV_GAME_START,       DIANA_MODULE_GAME_ACTIVE},
    {DIANA_MODULE_GAME_COUNTDOWN,DIANA_EV_GAME_ABORT,       DIANA_MODULE_READY},
    {DIANA_MODULE_GAME_COUNTDOWN,DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    {DIANA_MODULE_GAME_ACTIVE,   DIANA_EV_GAME_PAUSE,       DIANA_MODULE_GAME_PAUSED},
    {DIANA_MODULE_GAME_ACTIVE,   DIANA_EV_GAME_FINISH,      DIANA_MODULE_GAME_FINISHED},
    {DIANA_MODULE_GAME_ACTIVE,   DIANA_EV_GAME_ABORT,       DIANA_MODULE_GAME_FINISHED},
    /* 14.3: perder el coordinador pausa la ronda, no la resuelve en silencio */
    {DIANA_MODULE_GAME_ACTIVE,   DIANA_EV_MQTT_DISCONNECTED,DIANA_MODULE_GAME_PAUSED},
    {DIANA_MODULE_GAME_ACTIVE,   DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    {DIANA_MODULE_GAME_PAUSED,   DIANA_EV_GAME_RESUME,      DIANA_MODULE_GAME_ACTIVE},
    {DIANA_MODULE_GAME_PAUSED,   DIANA_EV_GAME_FINISH,      DIANA_MODULE_GAME_FINISHED},
    {DIANA_MODULE_GAME_PAUSED,   DIANA_EV_GAME_ABORT,       DIANA_MODULE_GAME_FINISHED},
    {DIANA_MODULE_GAME_PAUSED,   DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    {DIANA_MODULE_GAME_FINISHED, DIANA_EV_GAME_PREPARE,     DIANA_MODULE_GAME_PREPARE},
    {DIANA_MODULE_GAME_FINISHED, DIANA_EV_GAME_ABORT,       DIANA_MODULE_READY},
    {DIANA_MODULE_GAME_FINISHED, DIANA_EV_MAINTENANCE_ON,   DIANA_MODULE_MAINTENANCE},
    {DIANA_MODULE_GAME_FINISHED, DIANA_EV_ERROR_RAISED,     DIANA_MODULE_ERROR},

    /* error: solo se sale con clear_error explicito, que devuelve a selftest */
    {DIANA_MODULE_ERROR,         DIANA_EV_ERROR_CLEARED,    DIANA_MODULE_SELFTEST},
    {DIANA_MODULE_ERROR,         DIANA_EV_MAINTENANCE_ON,   DIANA_MODULE_MAINTENANCE},
};

static const size_t TABLE_N = sizeof(TABLE) / sizeof(TABLE[0]);

static const transition *find(diana_module_state from, diana_module_event ev)
{
    for (size_t i = 0; i < TABLE_N; ++i) {
        if (TABLE[i].from == from && TABLE[i].ev == ev) return &TABLE[i];
    }
    return NULL;
}

void diana_module_fsm_init(diana_module_fsm *fsm, uint64_t now_us)
{
    fsm->state = DIANA_MODULE_BOOT;
    fsm->previous = DIANA_MODULE_BOOT;
    fsm->transitions = 0;
    fsm->rejected = 0;
    fsm->entered_at_us = now_us;
    fsm->last_rejected_event = DIANA_EV_COUNT;
}

bool diana_module_fsm_can(const diana_module_fsm *fsm, diana_module_event ev)
{
    return find(fsm->state, ev) != NULL;
}

bool diana_module_fsm_apply(diana_module_fsm *fsm, diana_module_event ev,
                            uint64_t now_us)
{
    const transition *t = find(fsm->state, ev);
    if (!t) {
        fsm->rejected++;
        fsm->last_rejected_event = ev;
        return false;
    }
    fsm->previous = fsm->state;
    fsm->state = t->to;
    fsm->transitions++;
    fsm->entered_at_us = now_us;
    return true;
}

bool diana_module_fsm_game_in_progress(const diana_module_fsm *fsm)
{
    switch (fsm->state) {
    case DIANA_MODULE_GAME_PREPARE:
    case DIANA_MODULE_GAME_COUNTDOWN:
    case DIANA_MODULE_GAME_ACTIVE:
    case DIANA_MODULE_GAME_PAUSED:
        return true;
    default:
        return false;
    }
}

bool diana_module_fsm_accepts_hits(const diana_module_fsm *fsm)
{
    return fsm->state == DIANA_MODULE_GAME_ACTIVE ||
           fsm->state == DIANA_MODULE_CALIBRATION;
}

static const char *const EV_STR[] = {
    "selftest_start", "selftest_ok", "selftest_fail", "link_up", "link_down",
    "mqtt_connected", "mqtt_disconnected", "registered", "register_timeout",
    "calibration_start", "calibration_end", "maintenance_on", "maintenance_off",
    "game_prepare", "game_countdown", "game_start", "game_pause", "game_resume",
    "game_finish", "game_abort", "error_raised", "error_cleared",
};

const char *diana_module_event_str(diana_module_event ev)
{
    if ((int)ev < 0 || ev >= DIANA_EV_COUNT) return "";
    return EV_STR[ev];
}
