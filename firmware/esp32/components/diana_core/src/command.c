#include "diana/command.h"

#include <stdio.h>
#include <string.h>

#include "diana/ids.h"

void diana_command_guard_init(diana_command_guard *g)
{
    memset(g, 0, sizeof(*g));
}

bool diana_command_seen(const diana_command_guard *g, const char *command_id)
{
    for (uint16_t i = 0; i < g->used; ++i) {
        if (strcmp(g->ids[i], command_id) == 0) return true;
    }
    return false;
}

static void remember(diana_command_guard *g, const char *command_id,
                     uint64_t recv_us)
{
    size_t n = strlen(command_id);
    if (n >= DIANA_UUID_LEN) n = DIANA_UUID_LEN - 1;
    memcpy(g->ids[g->next], command_id, n);
    g->ids[g->next][n] = '\0';
    g->recv_us[g->next] = recv_us;
    g->next = (uint16_t)((g->next + 1) % DIANA_CMD_CACHE);
    if (g->used < DIANA_CMD_CACHE) g->used++;
}

static diana_command_verdict verdict(diana_command_result r, const char *detail)
{
    diana_command_verdict v;
    v.result = r;
    v.detail[0] = '\0';
    if (detail) {
        size_t n = strlen(detail);
        if (n >= sizeof(v.detail)) n = sizeof(v.detail) - 1;
        memcpy(v.detail, detail, n);
        v.detail[n] = '\0';
    }
    return v;
}

diana_command_verdict diana_command_validate(diana_command_guard *g,
                                             const diana_command *cmd,
                                             const char *own_module_id,
                                             uint64_t recv_us, uint64_t now_us)
{
    /* Version de esquema: se rechaza una superior a la soportada (contrato §7). */
    if (cmd->schema_version > DIANA_SCHEMA_VERSION) {
        g->rejected_schema++;
        return verdict(DIANA_CMD_RESULT_REJECTED,
                       "schema_version superior a la soportada");
    }
    if (cmd->schema_version != DIANA_SCHEMA_VERSION) {
        g->rejected_schema++;
        return verdict(DIANA_CMD_RESULT_REJECTED, "schema_version desconocida");
    }

    if (!diana_is_uuid(cmd->command_id)) {
        g->rejected_invalid++;
        return verdict(DIANA_CMD_RESULT_REJECTED, "command_id no es un UUID");
    }
    if ((int)cmd->issuer < 0 || cmd->issuer >= DIANA_ISSUER_COUNT) {
        g->rejected_invalid++;
        return verdict(DIANA_CMD_RESULT_REJECTED, "issuer desconocido");
    }
    if ((int)cmd->action < 0 || cmd->action >= DIANA_CMD_ACTION_COUNT) {
        g->rejected_invalid++;
        return verdict(DIANA_CMD_RESULT_REJECTED, "accion desconocida");
    }
    /* Mensaje dirigido a otro modulo o a otra instalacion (dosier 23.3). */
    if (own_module_id && own_module_id[0] &&
        strcmp(cmd->module_id, own_module_id) != 0) {
        g->rejected_invalid++;
        return verdict(DIANA_CMD_RESULT_REJECTED, "module_id no coincide");
    }
    if (cmd->expires_in_ms < 100 || cmd->expires_in_ms > 600000) {
        g->rejected_invalid++;
        return verdict(DIANA_CMD_RESULT_REJECTED, "expires_in_ms fuera de rango");
    }

    /* 1. Duplicado por command_id. */
    if (diana_command_seen(g, cmd->command_id)) {
        g->rejected_duplicate++;
        return verdict(DIANA_CMD_RESULT_DUPLICATE, "command_id ya ejecutado");
    }

    /* 2. Nonce monotonico por emisor. */
    if (g->nonce_seen[cmd->issuer] && cmd->nonce <= g->last_nonce[cmd->issuer]) {
        g->rejected_nonce++;
        char d[121];
        snprintf(d, sizeof(d), "nonce %llu <= ultimo aceptado %llu de %s",
                 (unsigned long long)cmd->nonce,
                 (unsigned long long)g->last_nonce[cmd->issuer],
                 diana_issuer_str(cmd->issuer));
        return verdict(DIANA_CMD_RESULT_REJECTED, d);
    }

    /* 3. Caducidad medida con el reloj monotonico sobre la recepcion. */
    uint64_t age_us = (now_us >= recv_us) ? (now_us - recv_us) : 0;
    if (age_us > (uint64_t)cmd->expires_in_ms * 1000ULL) {
        g->rejected_expired++;
        char d[121];
        snprintf(d, sizeof(d), "caducado: %llu ms > expires_in_ms %u",
                 (unsigned long long)(age_us / 1000ULL),
                 (unsigned)cmd->expires_in_ms);
        return verdict(DIANA_CMD_RESULT_EXPIRED, d);
    }

    /* Aceptado: consume nonce y registra el command_id. */
    g->last_nonce[cmd->issuer] = cmd->nonce;
    g->nonce_seen[cmd->issuer] = true;
    remember(g, cmd->command_id, recv_us);
    g->accepted++;
    return verdict(DIANA_CMD_RESULT_ACCEPTED, NULL);
}
