#include "diana/command.h"

#include <stdio.h>
#include <string.h>

#include "diana/identity.h"
#include "diana/ids.h"

/* Clave NVS del ultimo nonce aceptado por emisor. Se persiste con el mismo
 * rigor que local_sequence (hallazgo H-05 b). */
#define NONCE_KEY "nonce"

void diana_command_guard_init(diana_command_guard *g, const diana_hal *hal)
{
    memset(g, 0, sizeof(*g));
    g->hal = hal;

    if (!hal || !hal->kv_get) return;

    /* Recupera de NVS el ultimo nonce aceptado de cada emisor. Sin esto, un
     * reinicio dejaria el contador a 0 y aceptaria cualquier comando antiguo
     * capturado. */
    uint64_t stored[DIANA_ISSUER_COUNT];
    size_t len = 0;
    if (hal->kv_get(hal->ctx, DIANA_NVS_NS_STATE, NONCE_KEY, stored,
                    sizeof(stored), &len) == DIANA_HAL_OK &&
        len == sizeof(stored)) {
        for (int i = 0; i < DIANA_ISSUER_COUNT; ++i) {
            g->last_nonce[i] = stored[i];
            /* Un 0 persistido es indistinguible de "nunca visto"; se trata como
             * no visto, que es el caso conservador correcto porque el contrato
             * admite nonce 0 como primer valor legitimo. */
            g->nonce_seen[i] = (stored[i] > 0);
        }
    }
}

static void persist_nonces(diana_command_guard *g)
{
    if (!g->hal || !g->hal->kv_set) return;
    uint64_t stored[DIANA_ISSUER_COUNT];
    for (int i = 0; i < DIANA_ISSUER_COUNT; ++i) stored[i] = g->last_nonce[i];
    g->hal->kv_set(g->hal->ctx, DIANA_NVS_NS_STATE, NONCE_KEY, stored,
                   sizeof(stored));
}

uint64_t diana_command_last_nonce(const diana_command_guard *g,
                                  diana_issuer issuer)
{
    if ((int)issuer < 0 || issuer >= DIANA_ISSUER_COUNT) return 0;
    return g->last_nonce[issuer];
}

bool diana_command_is_critical(diana_command_action action)
{
    switch (action) {
    case DIANA_CMD_REBOOT:
    case DIANA_CMD_SET_MAINTENANCE:
    case DIANA_CMD_START_CALIBRATION:
        return true;
    default:
        return false;
    }
}

bool diana_command_seen(const diana_command_guard *g, const char *command_id)
{
    for (uint16_t i = 0; i < g->used; ++i) {
        if (strcmp(g->ids[i], command_id) == 0) return true;
    }
    return false;
}

static void remember(diana_command_guard *g, const char *command_id)
{
    size_t n = strlen(command_id);
    if (n >= DIANA_UUID_LEN) n = DIANA_UUID_LEN - 1;
    memcpy(g->ids[g->next], command_id, n);
    g->ids[g->next][n] = '\0';
    g->next = (uint16_t)((g->next + 1) % DIANA_CMD_CACHE);
    if (g->used < DIANA_CMD_CACHE) g->used++;
}

static diana_command_verdict verdict_r(diana_command_result r,
                                      diana_command_reject_reason reason,
                                      const char *detail)
{
    diana_command_verdict v;
    v.result = r;
    v.reason = reason;
    v.detail[0] = '\0';
    if (detail) {
        size_t n = strlen(detail);
        if (n >= sizeof(v.detail)) n = sizeof(v.detail) - 1;
        memcpy(v.detail, detail, n);
        v.detail[n] = '\0';
    }
    return v;
}

/* Aceptacion: `reason` no es significativo. Se fija a un valor determinista
 * para no dejar basura en la pila, no porque signifique nada. */
static diana_command_verdict verdict(diana_command_result r, const char *detail)
{
    return verdict_r(r, DIANA_REJECT_PARAMS_OUT_OF_RANGE, detail);
}

/** Comprueba los params obligatorios de cada accion (hallazgo H-07). */
static const char *missing_params(const diana_command *cmd)
{
    switch (cmd->action) {
    case DIANA_CMD_SET_TARGETS:
        if (!cmd->has_params || !cmd->param_targets)
            return "set_targets exige params.targets";
        if (cmd->param_targets_count < 1)
            return "set_targets exige params.targets con al menos 1 elemento";
        return NULL;
    case DIANA_CMD_SET_ALL_TARGETS:
        if (!cmd->has_params || !cmd->param_state)
            return "set_all_targets exige params.state";
        return NULL;
    case DIANA_CMD_IDENTIFY:
        if (!cmd->has_params || !cmd->param_duration_ms)
            return "identify exige params.duration_ms";
        return NULL;
    case DIANA_CMD_SET_MAINTENANCE:
        if (!cmd->has_params || !cmd->param_enabled)
            return "set_maintenance exige params.enabled";
        return NULL;
    default:
        return NULL;
    }
}

diana_command_verdict diana_command_validate(diana_command_guard *g,
                                             const diana_command *cmd,
                                             const char *own_module_id,
                                             const diana_command_clock *clock)
{
    /* --- 1. Version de esquema (contrato §7) ------------------------------ */
    if (cmd->schema_version > DIANA_SCHEMA_VERSION) {
        g->rejected_schema++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_UNKNOWN_COMMAND,
                       "schema_version superior a la soportada");
    }
    if (cmd->schema_version != DIANA_SCHEMA_VERSION) {
        g->rejected_schema++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_UNKNOWN_COMMAND, "schema_version desconocida");
    }

    /* --- 2. Sobre bien formado ------------------------------------------- */
    if (!diana_is_uuid(cmd->command_id)) {
        g->rejected_invalid++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_PARAMS_OUT_OF_RANGE, "command_id no es un UUID");
    }
    if ((int)cmd->issuer < 0 || cmd->issuer >= DIANA_ISSUER_COUNT) {
        g->rejected_invalid++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_PARAMS_OUT_OF_RANGE, "issuer desconocido");
    }
    if ((int)cmd->action < 0 || cmd->action >= DIANA_CMD_ACTION_COUNT) {
        g->rejected_invalid++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_UNKNOWN_COMMAND, "accion desconocida");
    }
    /* Mensaje dirigido a otro modulo o a otra instalacion (dosier 23.3). */
    if (own_module_id && own_module_id[0] &&
        strcmp(cmd->module_id, own_module_id) != 0) {
        g->rejected_invalid++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_MODULE_MISMATCH, "module_id no coincide");
    }
    if (cmd->expires_in_ms < 100 || cmd->expires_in_ms > 600000) {
        g->rejected_invalid++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_PARAMS_OUT_OF_RANGE, "expires_in_ms fuera de rango");
    }

    /* --- 3. Params obligatorios por accion (H-07) ------------------------- */
    const char *miss = missing_params(cmd);
    if (miss) {
        g->rejected_params++;
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_PARAMS_OUT_OF_RANGE, miss);
    }

    /* --- 4. Techo de validez para acciones criticas (H-05 c) -------------- */
    if (diana_command_is_critical(cmd->action) &&
        cmd->expires_in_ms > DIANA_CMD_CRITICAL_MAX_EXPIRES_MS) {
        g->rejected_invalid++;
        char d[121];
        snprintf(d, sizeof(d), "accion critica con expires_in_ms %u > techo %u",
                 (unsigned)cmd->expires_in_ms,
                 (unsigned)DIANA_CMD_CRITICAL_MAX_EXPIRES_MS);
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_PARAMS_OUT_OF_RANGE, d);
    }

    /* --- 5. Duplicado por command_id -------------------------------------- */
    if (diana_command_seen(g, cmd->command_id)) {
        g->rejected_duplicate++;
        return verdict_r(DIANA_CMD_RESULT_DUPLICATE, DIANA_REJECT_DUPLICATE, "command_id ya ejecutado");
    }

    /* --- 6. Nonce monotonico por emisor, PERSISTIDO ----------------------- */
    if (g->nonce_seen[cmd->issuer] && cmd->nonce <= g->last_nonce[cmd->issuer]) {
        g->rejected_nonce++;
        char d[121];
        snprintf(d, sizeof(d), "nonce %llu <= ultimo aceptado %llu de %s",
                 (unsigned long long)cmd->nonce,
                 (unsigned long long)g->last_nonce[cmd->issuer],
                 diana_issuer_str(cmd->issuer));
        /* MAPEO IMPERFECTO: el contrato no tiene un motivo para "nonce reenviado". Es un reenvio de una secuencia ya consumida, luego duplicate es lo mas cercano; el texto exacto viaja en detail. CONTRACT_GAP anotado. */
        return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_DUPLICATE, d);
    }

    /* --- 7. Caducidad ------------------------------------------------------
     * Guarda monotonica local: retraso del PROPIO firmware desde que recibio el
     * mensaje. Adicional, nunca la unica (ver cabecera). */
    uint64_t held_us = (clock->now_us >= clock->recv_us)
                           ? (clock->now_us - clock->recv_us)
                           : 0;
    if (held_us > (uint64_t)cmd->expires_in_ms * 1000ULL) {
        g->rejected_expired++;
        char d[121];
        snprintf(d, sizeof(d), "retenido %llu ms en el modulo > expires_in_ms %u",
                 (unsigned long long)(held_us / 1000ULL),
                 (unsigned)cmd->expires_in_ms);
        return verdict_r(DIANA_CMD_RESULT_EXPIRED, DIANA_REJECT_EXPIRED, d);
    }

    bool clock_ok = (clock->epoch_ms > 0);
    if (clock_ok) {
        /* Emitido en el futuro: reloj descuadrado o sobre falsificado. */
        if (cmd->issued_at_ms > clock->epoch_ms + DIANA_CLOCK_SKEW_TOLERANCE_MS) {
            g->rejected_skew++;
            char d[121];
            snprintf(d, sizeof(d),
                     "issued_at_ms %llu ms en el futuro respecto al modulo",
                     (unsigned long long)(cmd->issued_at_ms - clock->epoch_ms));
            /* MAPEO IMPERFECTO: "emitido en el futuro" no es "caducado", pero es el mismo fallo de ventana de validez y el contrato no ofrece otro. CONTRACT_GAP anotado. */
            return verdict_r(DIANA_CMD_RESULT_REJECTED, DIANA_REJECT_EXPIRED, d);
        }
        uint64_t age_ms = (clock->epoch_ms > cmd->issued_at_ms)
                              ? (clock->epoch_ms - cmd->issued_at_ms)
                              : 0;
        if (age_ms > (uint64_t)cmd->expires_in_ms) {
            g->rejected_expired++;
            char d[121];
            snprintf(d, sizeof(d),
                     "caducado: %llu ms desde issued_at_ms > expires_in_ms %u",
                     (unsigned long long)age_ms, (unsigned)cmd->expires_in_ms);
            return verdict_r(DIANA_CMD_RESULT_EXPIRED, DIANA_REJECT_EXPIRED, d);
        }
    }

    /* --- 8. Aceptado: consume y PERSISTE el nonce -------------------------- */
    g->last_nonce[cmd->issuer] = cmd->nonce;
    g->nonce_seen[cmd->issuer] = true;
    persist_nonces(g);
    remember(g, cmd->command_id);
    g->accepted++;

    if (!clock_ok) {
        g->accepted_without_clock++;
        /* Se dice lo que NO se ha comprobado. El backend lo ve en
         * module/…/status.last_command.detail. */
        return verdict(DIANA_CMD_RESULT_ACCEPTED,
                       "caducidad no verificada: sin hora sincronizada; "
                       "defensa por nonce persistido");
    }
    return verdict(DIANA_CMD_RESULT_ACCEPTED, NULL);
}
