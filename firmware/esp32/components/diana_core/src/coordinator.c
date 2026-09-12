#include "diana/coordinator.h"

#include <stdio.h>
#include <string.h>

#include "diana/ids.h"

static const char *const ACTION_STR[] = {
    "arm_game", "start_game", "pause_game", "resume_game", "abort_game",
    "end_game", "set_topology", "identify_all", "all_safe",
};

const char *diana_system_action_str(diana_system_action v)
{
    if ((int)v < 0 || (size_t)v >= sizeof(ACTION_STR) / sizeof(ACTION_STR[0]))
        return "";
    return ACTION_STR[v];
}

int diana_system_action_parse(const char *s, diana_system_action *out)
{
    if (!s || !out) return -1;
    for (size_t i = 0; i < sizeof(ACTION_STR) / sizeof(ACTION_STR[0]); ++i) {
        if (strcmp(ACTION_STR[i], s) == 0) {
            *out = (diana_system_action)i;
            return 0;
        }
    }
    return -1;
}

static const char *const PHASE_STR[] = {
    "armed", "countdown", "running", "paused", "finished", "aborted",
};

const char *diana_game_phase_str(diana_game_phase v)
{
    if ((int)v < 0 || (size_t)v >= sizeof(PHASE_STR) / sizeof(PHASE_STR[0]))
        return "";
    return PHASE_STR[v];
}

void diana_coordinator_reset(diana_coordinator *c)
{
    if (c) memset(c, 0, sizeof(*c));
}

static bool ya_visto(const diana_coordinator *c, const char *command_id)
{
    for (uint8_t i = 0; i < c->seen_count; ++i)
        if (strcmp(c->seen[i], command_id) == 0) return true;
    return false;
}

static void recordar(diana_coordinator *c, const char *command_id)
{
    const uint8_t cap = (uint8_t)(sizeof(c->seen) / sizeof(c->seen[0]));
    snprintf(c->seen[c->seen_next], DIANA_UUID_LEN, "%s", command_id);
    c->seen_next = (uint8_t)((c->seen_next + 1) % cap);
    if (c->seen_count < cap) c->seen_count++;
}

/** Activa la diana `idx` de la lista y devuelve el plan correspondiente. */
static void activar(diana_coordinator *c, diana_coord_plan *out, uint8_t idx)
{
    out->emit_command = true;
    snprintf(out->command_module_id, sizeof(out->command_module_id), "%s",
             c->targets[idx].module_id);
    out->active_target_index = c->targets[idx].target_index;
    c->out_nonce++;
    out->command_nonce = c->out_nonce;
}

/** Manda a SAFE el modulo de la primera diana, sin activar ninguna. */
static void todo_seguro(diana_coordinator *c, diana_coord_plan *out)
{
    if (c->target_count == 0) return;
    out->emit_command = true;
    snprintf(out->command_module_id, sizeof(out->command_module_id), "%s",
             c->targets[0].module_id);
    out->active_target_index = 0;   /* ninguna activa */
    c->out_nonce++;
    out->command_nonce = c->out_nonce;
}

diana_coord_result diana_coordinator_on_system_command(
    diana_coordinator *c, bool is_principal, const char *own_system_id,
    const diana_system_command *cmd, diana_coord_plan *out)
{
    if (!c || !cmd || !out) return DIANA_COORD_INVALID;
    memset(out, 0, sizeof(*out));

    /* AUTORIDAD. Es lo primero que se mira, antes incluso que la validez del
     * sobre: un satelite no tiene por que opinar sobre una orden de sistema, y
     * desde luego no puede emitir nada. Tampoco se consume el command_id: no
     * ha atendido la orden, asi que no puede decir que ya la vio. */
    if (!is_principal) return DIANA_COORD_NOT_MINE;

    if (!diana_is_uuid(cmd->command_id)) return DIANA_COORD_INVALID;
    if (cmd->issuer != DIANA_ISSUER_BACKEND) {
        /* El canal de sistema es del backend. Otro emisor aqui no es una orden
         * de juego legitima. */
        return DIANA_COORD_INVALID;
    }
    if (own_system_id && own_system_id[0] &&
        strcmp(cmd->system_id, own_system_id) != 0)
        return DIANA_COORD_OTHER_SYSTEM;

    /* Duplicado: una reentrega QoS 1 no puede producir un segundo efecto. */
    if (ya_visto(c, cmd->command_id)) return DIANA_COORD_DUPLICATE;

    switch (cmd->action) {
    case DIANA_SYS_ARM_GAME:
        if (!cmd->has_game || cmd->target_count == 0) return DIANA_COORD_INVALID;
        c->have_game = true;
        snprintf(c->game_id, sizeof(c->game_id), "%s", cmd->game_id);
        snprintf(c->round_id, sizeof(c->round_id), "%s", cmd->round_id);
        memcpy(c->targets, cmd->targets, sizeof(c->targets));
        c->target_count = cmd->target_count;
        c->next_target = 0;
        c->phase = DIANA_GAME_ARMED;
        /* Armar NO enciende nada: sólo declara la partida. El comando de modulo
         * llega con start_game. */
        out->emit_state = true;
        break;

    case DIANA_SYS_START_GAME:
        if (!c->have_game) return DIANA_COORD_INVALID;
        c->phase = DIANA_GAME_RUNNING;
        c->next_target = 0;
        activar(c, out, c->next_target);
        out->emit_state = true;
        break;

    case DIANA_SYS_PAUSE_GAME:
        if (!c->have_game) return DIANA_COORD_INVALID;
        c->phase = DIANA_GAME_PAUSED;
        /* Al pausar, las dianas dejan de ser objetivo: se apagan. */
        todo_seguro(c, out);
        out->emit_state = true;
        break;

    case DIANA_SYS_RESUME_GAME:
        if (!c->have_game) return DIANA_COORD_INVALID;
        c->phase = DIANA_GAME_RUNNING;
        activar(c, out, c->next_target);
        out->emit_state = true;
        break;

    case DIANA_SYS_ABORT_GAME:
    case DIANA_SYS_END_GAME:
        if (!c->have_game) return DIANA_COORD_INVALID;
        c->phase = (cmd->action == DIANA_SYS_ABORT_GAME) ? DIANA_GAME_ABORTED
                                                         : DIANA_GAME_FINISHED;
        todo_seguro(c, out);
        out->emit_state = true;
        break;

    case DIANA_SYS_ALL_SAFE:
        /* No exige partida: es la orden de "deja todo seguro". */
        todo_seguro(c, out);
        break;

    case DIANA_SYS_SET_TOPOLOGY:
    case DIANA_SYS_IDENTIFY_ALL:
    default:
        /* Declaradas y NO implementadas en el camino minimo. Se consume el
         * command_id igual --- la orden se ha atendido, con el resultado de no
         * hacer nada --- para que una reentrega no parezca nueva. */
        break;
    }

    recordar(c, cmd->command_id);
    out->phase = c->phase;
    out->targets_remaining = (uint8_t)(c->target_count > c->next_target
                                           ? c->target_count - c->next_target
                                           : 0);
    return DIANA_COORD_OK;
}
