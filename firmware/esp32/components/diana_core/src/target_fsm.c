#include "diana/target_fsm.h"

#include <stddef.h>

typedef struct {
    diana_target_state from;
    diana_target_event ev;
    diana_target_state to;
} ttrans;

static const ttrans TABLE[] = {
    {DIANA_TARGET_OFF,          DIANA_TEV_ENABLE,            DIANA_TARGET_SAFE},
    {DIANA_TARGET_OFF,          DIANA_TEV_CALIBRATION_START, DIANA_TARGET_CALIBRATION},
    {DIANA_TARGET_OFF,          DIANA_TEV_MAINTENANCE_ON,    DIANA_TARGET_MAINTENANCE},
    {DIANA_TARGET_OFF,          DIANA_TEV_ADMIN_DISABLE,     DIANA_TARGET_DISABLED},
    {DIANA_TARGET_OFF,          DIANA_TEV_SENSOR_FAULT,      DIANA_TARGET_SENSOR_ERROR},
    {DIANA_TARGET_OFF,          DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_SAFE,         DIANA_TEV_ARM,               DIANA_TARGET_ACTIVE},
    {DIANA_TARGET_SAFE,         DIANA_TEV_COUNTDOWN,         DIANA_TARGET_COUNTDOWN},
    {DIANA_TARGET_SAFE,         DIANA_TEV_HIT_PENALTY,       DIANA_TARGET_PENALTY},
    {DIANA_TARGET_SAFE,         DIANA_TEV_LOCK,              DIANA_TARGET_LOCKED},
    {DIANA_TARGET_SAFE,         DIANA_TEV_DISABLE,           DIANA_TARGET_OFF},
    {DIANA_TARGET_SAFE,         DIANA_TEV_ROUND_END,         DIANA_TARGET_OFF},
    {DIANA_TARGET_SAFE,         DIANA_TEV_CALIBRATION_START, DIANA_TARGET_CALIBRATION},
    {DIANA_TARGET_SAFE,         DIANA_TEV_MAINTENANCE_ON,    DIANA_TARGET_MAINTENANCE},
    {DIANA_TARGET_SAFE,         DIANA_TEV_ADMIN_DISABLE,     DIANA_TARGET_DISABLED},
    {DIANA_TARGET_SAFE,         DIANA_TEV_SENSOR_FAULT,      DIANA_TARGET_SENSOR_ERROR},
    {DIANA_TARGET_SAFE,         DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_COUNTDOWN,    DIANA_TEV_ARM,               DIANA_TARGET_ACTIVE},
    {DIANA_TARGET_COUNTDOWN,    DIANA_TEV_DISARM,            DIANA_TARGET_SAFE},
    {DIANA_TARGET_COUNTDOWN,    DIANA_TEV_ROUND_END,         DIANA_TARGET_OFF},
    {DIANA_TARGET_COUNTDOWN,    DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_ACTIVE,       DIANA_TEV_HIT_VALID,         DIANA_TARGET_HIT},
    {DIANA_TARGET_ACTIVE,       DIANA_TEV_DISARM,            DIANA_TARGET_SAFE},
    {DIANA_TARGET_ACTIVE,       DIANA_TEV_LOCK,              DIANA_TARGET_LOCKED},
    {DIANA_TARGET_ACTIVE,       DIANA_TEV_ROUND_END,         DIANA_TARGET_OFF},
    {DIANA_TARGET_ACTIVE,       DIANA_TEV_SENSOR_FAULT,      DIANA_TARGET_SENSOR_ERROR},
    {DIANA_TARGET_ACTIVE,       DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_HIT,          DIANA_TEV_HIT_CLEARED,       DIANA_TARGET_SAFE},
    {DIANA_TARGET_HIT,          DIANA_TEV_ARM,               DIANA_TARGET_ACTIVE},
    {DIANA_TARGET_HIT,          DIANA_TEV_ROUND_END,         DIANA_TARGET_OFF},
    {DIANA_TARGET_HIT,          DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_PENALTY,      DIANA_TEV_HIT_CLEARED,       DIANA_TARGET_SAFE},
    {DIANA_TARGET_PENALTY,      DIANA_TEV_ARM,               DIANA_TARGET_ACTIVE},
    {DIANA_TARGET_PENALTY,      DIANA_TEV_ROUND_END,         DIANA_TARGET_OFF},
    {DIANA_TARGET_PENALTY,      DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_LOCKED,       DIANA_TEV_UNLOCK,            DIANA_TARGET_SAFE},
    {DIANA_TARGET_LOCKED,       DIANA_TEV_ROUND_END,         DIANA_TARGET_OFF},
    {DIANA_TARGET_LOCKED,       DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_CALIBRATION,  DIANA_TEV_CALIBRATION_END,   DIANA_TARGET_SAFE},
    {DIANA_TARGET_CALIBRATION,  DIANA_TEV_SENSOR_FAULT,      DIANA_TARGET_SENSOR_ERROR},
    {DIANA_TARGET_CALIBRATION,  DIANA_TEV_ERROR,             DIANA_TARGET_ERROR},

    {DIANA_TARGET_SENSOR_ERROR, DIANA_TEV_SENSOR_RECOVERED,  DIANA_TARGET_SAFE},
    {DIANA_TARGET_SENSOR_ERROR, DIANA_TEV_ADMIN_DISABLE,     DIANA_TARGET_DISABLED},
    {DIANA_TARGET_SENSOR_ERROR, DIANA_TEV_MAINTENANCE_ON,    DIANA_TARGET_MAINTENANCE},

    {DIANA_TARGET_MAINTENANCE,  DIANA_TEV_MAINTENANCE_OFF,   DIANA_TARGET_SAFE},
    {DIANA_TARGET_MAINTENANCE,  DIANA_TEV_ADMIN_DISABLE,     DIANA_TARGET_DISABLED},
    {DIANA_TARGET_MAINTENANCE,  DIANA_TEV_CALIBRATION_START, DIANA_TARGET_CALIBRATION},

    {DIANA_TARGET_DISABLED,     DIANA_TEV_ADMIN_ENABLE,      DIANA_TARGET_SAFE},

    {DIANA_TARGET_ERROR,        DIANA_TEV_ERROR_CLEAR,       DIANA_TARGET_SAFE},
    {DIANA_TARGET_ERROR,        DIANA_TEV_ADMIN_DISABLE,     DIANA_TARGET_DISABLED},
    {DIANA_TARGET_ERROR,        DIANA_TEV_MAINTENANCE_ON,    DIANA_TARGET_MAINTENANCE},
};

static const size_t TABLE_N = sizeof(TABLE) / sizeof(TABLE[0]);

static const ttrans *find(diana_target_state from, diana_target_event ev)
{
    for (size_t i = 0; i < TABLE_N; ++i) {
        if (TABLE[i].from == from && TABLE[i].ev == ev) return &TABLE[i];
    }
    return NULL;
}

void diana_target_init(diana_target *tg, uint8_t index, uint64_t now_us)
{
    tg->state = DIANA_TARGET_OFF;
    tg->previous = DIANA_TARGET_OFF;
    tg->index = index;
    tg->enabled = true;
    tg->transitions = 0;
    tg->rejected = 0;
    tg->entered_at_us = now_us;
    tg->blanking_until_us = 0;
    tg->hits = 0;
}

void diana_target_set_init(diana_target_set *set, uint64_t now_us)
{
    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i)
        diana_target_init(&set->t[i], (uint8_t)(i + 1), now_us);
}

bool diana_target_can(const diana_target *tg, diana_target_event ev)
{
    return find(tg->state, ev) != NULL;
}

bool diana_target_apply(diana_target *tg, diana_target_event ev, uint64_t now_us)
{
    const ttrans *t = find(tg->state, ev);
    if (!t) {
        tg->rejected++;
        return false;
    }
    tg->previous = tg->state;
    tg->state = t->to;
    tg->transitions++;
    tg->entered_at_us = now_us;
    if (ev == DIANA_TEV_HIT_VALID) tg->hits++;
    if (t->to == DIANA_TARGET_DISABLED) tg->enabled = false;
    if (ev == DIANA_TEV_ADMIN_ENABLE) tg->enabled = true;
    return true;
}

diana_target *diana_target_at(diana_target_set *set, uint8_t target_index)
{
    if (target_index < 1 || target_index > DIANA_TARGET_COUNT) return NULL;
    return &set->t[target_index - 1];
}

const diana_target *diana_target_at_const(const diana_target_set *set,
                                          uint8_t target_index)
{
    if (target_index < 1 || target_index > DIANA_TARGET_COUNT) return NULL;
    return &set->t[target_index - 1];
}

bool diana_target_is_scorable(const diana_target *tg)
{
    return tg->enabled && tg->state == DIANA_TARGET_ACTIVE;
}

static const char *const TEV_STR[] = {
    "enable", "disable", "arm", "disarm", "countdown", "hit_valid",
    "hit_penalty", "hit_cleared", "round_end", "calibration_start",
    "calibration_end", "lock", "unlock", "sensor_fault", "sensor_recovered",
    "maintenance_on", "maintenance_off", "admin_disable", "admin_enable",
    "error", "error_clear",
};

const char *diana_target_event_str(diana_target_event ev)
{
    if ((int)ev < 0 || ev >= DIANA_TEV_COUNT) return "";
    return TEV_STR[ev];
}
