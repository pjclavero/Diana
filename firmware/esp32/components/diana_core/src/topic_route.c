#include "diana/topic_route.h"

#include <string.h>

/** Prefijo comun. Se compara ENTERO: un topico que no empiece asi no es v1. */
static const char ROOT[] = "targets/v1/";

/** Ambito de la entrada de la tabla. */
typedef enum { SC_SYSTEM = 0, SC_MODULE = 1 } route_scope;

typedef struct {
    route_scope             scope;
    const char             *tail;   /**< cola EXACTA tras `<ambito>/<id>/` */
    diana_topic_route_kind  kind;
    const char             *name;   /**< nombre de contrato (topics.ts) */
} route_entry;

/*
 * Espejo de parseTopic() en server/backend/src/contracts/topics.ts. El orden
 * de la tabla es IRRELEVANTE porque la comparacion es total: no hay prefijos
 * que se coman a otros, que era justamente el defecto de strstr.
 *
 * OJO A "command" Y "maintenance/command": son DOS entradas distintas, y esa
 * es la razon de ser de este fichero. Con emparejado por subcadena la segunda
 * caia en la primera.
 */
static const route_entry TABLE[] = {
    { SC_SYSTEM, "status",              DIANA_ROUTE_SYSTEM_STATUS,              "system-status" },
    { SC_SYSTEM, "command",             DIANA_ROUTE_SYSTEM_COMMAND,             "system-command" },
    { SC_SYSTEM, "game/state",          DIANA_ROUTE_GAME_STATE,                 "game-state" },
    { SC_SYSTEM, "game/event",          DIANA_ROUTE_GAME_EVENT,                 "game-event" },
    { SC_MODULE, "presence",            DIANA_ROUTE_MODULE_PRESENCE,            "module-presence" },
    { SC_MODULE, "status",              DIANA_ROUTE_MODULE_STATUS,              "module-status" },
    { SC_MODULE, "telemetry",           DIANA_ROUTE_MODULE_TELEMETRY,           "module-telemetry" },
    { SC_MODULE, "config/desired",      DIANA_ROUTE_MODULE_CONFIG_DESIRED,      "module-config-desired" },
    { SC_MODULE, "config/reported",     DIANA_ROUTE_MODULE_CONFIG_REPORTED,     "module-config-reported" },
    { SC_MODULE, "command",             DIANA_ROUTE_MODULE_COMMAND,             "module-command" },
    { SC_MODULE, "maintenance/command", DIANA_ROUTE_MODULE_MAINTENANCE_COMMAND, "module-maintenance-command" },
    { SC_MODULE, "hit",                 DIANA_ROUTE_MODULE_HIT,                 "module-hit" },
    { SC_MODULE, "diagnostic",          DIANA_ROUTE_MODULE_DIAGNOSTIC,          "module-diagnostic" },
    { SC_MODULE, "ota",                 DIANA_ROUTE_MODULE_OTA,                 "module-ota" },
    { SC_MODULE, "provision",           DIANA_ROUTE_MODULE_PROVISION_COMMAND,   "module-provision-command" },
    { SC_MODULE, "provision/state",     DIANA_ROUTE_MODULE_PROVISION_STATE,     "module-provision-state" },
};
#define TABLE_LEN (sizeof(TABLE) / sizeof(TABLE[0]))

/** IDENTIFIER_PATTERN de topics.ts: ^[a-z0-9][a-z0-9-]{2,62}$ .
 *  Rechaza de paso los comodines '+' y '#', que no son identidades. */
static bool id_valid(const char *s, size_t len)
{
    if (len < 3u || len > 63u) return false;
    if (!((s[0] >= 'a' && s[0] <= 'z') || (s[0] >= '0' && s[0] <= '9'))) return false;
    for (size_t i = 1; i < len; ++i) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'))
            return false;
    }
    return true;
}

diana_topic_route_kind diana_topic_route(const char *topic,
                                         char *id_out, size_t id_cap)
{
    if (id_out != NULL && id_cap > 0u) id_out[0] = '\0';
    if (topic == NULL) return DIANA_ROUTE_UNKNOWN;

    const size_t rootlen = sizeof(ROOT) - 1u;
    if (strncmp(topic, ROOT, rootlen) != 0) return DIANA_ROUTE_UNKNOWN;

    const char *p = topic + rootlen;

    /* <ambito> */
    const char *slash = strchr(p, '/');
    if (slash == NULL) return DIANA_ROUTE_UNKNOWN;
    size_t scope_len = (size_t)(slash - p);
    route_scope scope;
    if (scope_len == 6u && strncmp(p, "system", 6) == 0)      scope = SC_SYSTEM;
    else if (scope_len == 6u && strncmp(p, "module", 6) == 0) scope = SC_MODULE;
    else return DIANA_ROUTE_UNKNOWN;

    /* <id> */
    const char *idp = slash + 1;
    const char *slash2 = strchr(idp, '/');
    if (slash2 == NULL) return DIANA_ROUTE_UNKNOWN;
    size_t idlen = (size_t)(slash2 - idp);
    if (!id_valid(idp, idlen)) return DIANA_ROUTE_UNKNOWN;

    /* <cola>: comparacion TOTAL, nunca de prefijo ni de subcadena. */
    const char *tail = slash2 + 1;
    for (size_t i = 0; i < TABLE_LEN; ++i) {
        if (TABLE[i].scope != scope) continue;
        if (strcmp(tail, TABLE[i].tail) != 0) continue;
        if (id_out != NULL && id_cap > idlen) {
            memcpy(id_out, idp, idlen);
            id_out[idlen] = '\0';
        }
        return TABLE[i].kind;
    }
    return DIANA_ROUTE_UNKNOWN;
}

const char *diana_topic_route_str(diana_topic_route_kind k)
{
    for (size_t i = 0; i < TABLE_LEN; ++i)
        if (TABLE[i].kind == k) return TABLE[i].name;
    return NULL;
}
