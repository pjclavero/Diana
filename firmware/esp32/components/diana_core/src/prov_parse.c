/**
 * @file prov_parse.c
 * @brief Deserializa module-provision-command.schema.json a diana_prov_command
 *        y encadena el mensaje MQTT crudo con diana_prov_handle().
 *
 * POR QUE VIVE EN diana_core Y NO EN main/ CON cJSON:
 *
 * El resto de planos parsea en main/app_commands.c con cJSON, que es un
 * componente de ESP-IDF. Ese fichero NO se compila en host, asi que nada de lo
 * que viva alli puede probarse sin hardware. Para D1b eso era inaceptable: el
 * camino que va del payload al veredicto es precisamente lo que hay que
 * demostrar, y demostrarlo en el dispositivo es imposible hoy (HARDWARE
 * VALIDATION: NINGUNA). Aqui, en C puro y sin dependencias, la suite de host
 * ejercita payload -> parser -> diana_prov_handle -> NVS -> respuesta.
 *
 * QUE **NO** HACE ESTE PARSER, a proposito:
 *
 *  - No valida el mensaje. No conoce ninguna regla de presencia por accion, ni
 *    formatos, ni longitudes. Rellena la estructura y marca los `has_*`; quien
 *    dice si conforma es conforms() dentro de provisioning.c, que es el codigo
 *    ya probado contra los vectores del contrato. Un parser que "arregla" el
 *    mensaje es un parser que firma otra cosa distinta de la que llego.
 *  - No interpreta ausencias. Un campo que no viene se queda en "" o con su
 *    `has_*` a false, que es exactamente lo que la cadena canonica serializa
 *    como 0xFFFFFFFF. No hay ninguna rama "si falta X, asumir Y".
 *  - No acepta \uXXXX fuera de ASCII. Todos los campos del esquema son UUID,
 *    identificadores, hex o base64url: ninguno necesita escapes Unicode, y
 *    admitirlos abriria la puerta a dos codificaciones del mismo valor, que es
 *    justo lo que una cadena canonica no puede tolerar.
 *
 * FALLO CERRADO: cualquier error de sintaxis deja la estructura a cero. Con
 * todos los `has_*` en false el mensaje no conforma y muere con
 * malformed_provisioning_message. No existe ningun camino en el que un parseo
 * a medias produzca una orden aplicable.
 */
#include <stddef.h>
#include <string.h>

#include "diana/provisioning.h"

/* -------------------------------------------------------------- escaner -- */

typedef struct {
    const char *p;
    const char *end;
    bool        err;
} jp;

static void jp_fail(jp *j) { j->err = true; j->p = j->end; }

static void jp_ws(jp *j)
{
    while (j->p < j->end &&
           (*j->p == ' ' || *j->p == '\t' || *j->p == '\n' || *j->p == '\r'))
        j->p++;
}

static bool jp_eat(jp *j, char c)
{
    jp_ws(j);
    if (j->p < j->end && *j->p == c) { j->p++; return true; }
    return false;
}

static bool jp_peek(jp *j, char c)
{
    jp_ws(j);
    return j->p < j->end && *j->p == c;
}

static int hexval(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/**
 * Lee una cadena JSON a `out`. Si no cabe, es un ERROR, no un truncamiento:
 * una firma sobre un valor recortado verificaria contra otro mensaje.
 * `out` puede ser NULL para descartar el valor.
 */
static bool jp_string(jp *j, char *out, size_t cap)
{
    size_t n = 0;
    if (!jp_eat(j, '"')) { jp_fail(j); return false; }
    while (j->p < j->end) {
        char c = *j->p++;
        if (c == '"') {
            if (out != NULL) out[n] = '\0';
            return true;
        }
        if (c == '\\') {
            if (j->p >= j->end) break;
            char e = *j->p++;
            switch (e) {
            case '"': c = '"';  break;
            case '\\': c = '\\'; break;
            case '/': c = '/';  break;
            case 'b': c = '\b'; break;
            case 'f': c = '\f'; break;
            case 'n': c = '\n'; break;
            case 'r': c = '\r'; break;
            case 't': c = '\t'; break;
            case 'u': {
                if (j->end - j->p < 4) { jp_fail(j); return false; }
                int h0 = hexval(j->p[0]), h1 = hexval(j->p[1]);
                int h2 = hexval(j->p[2]), h3 = hexval(j->p[3]);
                if (h0 < 0 || h1 < 0 || h2 < 0 || h3 < 0) { jp_fail(j); return false; }
                int cp = (h0 << 12) | (h1 << 8) | (h2 << 4) | h3;
                /* Fuera de ASCII se RECHAZA: ningun campo del contrato lo
                 * necesita y dos codificaciones del mismo valor romperian la
                 * canonicalizacion. */
                if (cp == 0 || cp > 0x7f) { jp_fail(j); return false; }
                j->p += 4;
                c = (char)cp;
                break;
            }
            default: jp_fail(j); return false;
            }
        } else if ((unsigned char)c < 0x20u) {
            jp_fail(j); return false;    /* control sin escapar */
        }
        if (out != NULL) {
            if (n + 1u >= cap) { jp_fail(j); return false; }
            out[n++] = c;
        }
    }
    jp_fail(j);
    return false;
}

/** Entero sin signo. Se rechaza signo, punto y exponente: ningun campo
 *  numerico del esquema es fraccionario, y aceptarlos obligaria a decidir
 *  como se serializa 1e3 en la cadena canonica. */
static bool jp_uint(jp *j, uint64_t *out)
{
    jp_ws(j);
    const char *s = j->p;
    uint64_t v = 0;
    while (j->p < j->end && *j->p >= '0' && *j->p <= '9') {
        uint64_t d = (uint64_t)(*j->p - '0');
        if (v > (0xffffffffffffffffULL - d) / 10ULL) { jp_fail(j); return false; }
        v = v * 10ULL + d;
        j->p++;
    }
    if (j->p == s) { jp_fail(j); return false; }
    if (j->p < j->end && (*j->p == '.' || *j->p == 'e' || *j->p == 'E')) {
        jp_fail(j); return false;
    }
    *out = v;
    return true;
}

static bool jp_skip_value(jp *j, int depth);

static bool jp_skip_container(jp *j, char close, int depth)
{
    if (jp_peek(j, close)) { j->p++; return true; }
    for (;;) {
        if (close == '}') {
            if (!jp_string(j, NULL, 0)) return false;
            if (!jp_eat(j, ':')) { jp_fail(j); return false; }
        }
        if (!jp_skip_value(j, depth + 1)) return false;
        if (jp_eat(j, ',')) continue;
        if (jp_eat(j, close)) return true;
        jp_fail(j);
        return false;
    }
}

/** Descarta un valor cualquiera. El limite de profundidad evita que un
 *  payload anidado a proposito agote la pila de la tarea de red. */
static bool jp_skip_value(jp *j, int depth)
{
    if (depth > 8) { jp_fail(j); return false; }
    jp_ws(j);
    if (j->p >= j->end) { jp_fail(j); return false; }
    char c = *j->p;
    if (c == '"') return jp_string(j, NULL, 0);
    if (c == '{') { j->p++; return jp_skip_container(j, '}', depth); }
    if (c == '[') { j->p++; return jp_skip_container(j, ']', depth); }
    if (c == 't' || c == 'f' || c == 'n' || c == '-' ||
        (c >= '0' && c <= '9')) {
        while (j->p < j->end && *j->p != ',' && *j->p != '}' && *j->p != ']' &&
               *j->p != ' ' && *j->p != '\n' && *j->p != '\r' && *j->p != '\t')
            j->p++;
        return true;
    }
    jp_fail(j);
    return false;
}

/* ---------------------------------------------------------- delegacion --- */

static bool parse_delegation(jp *j, diana_prov_delegation *d)
{
    if (!jp_eat(j, '{')) { jp_fail(j); return false; }
    if (jp_eat(j, '}')) return true;

    for (;;) {
        char key[48];
        if (!jp_string(j, key, sizeof(key))) return false;
        if (!jp_eat(j, ':')) { jp_fail(j); return false; }

        if (strcmp(key, "delegation_version") == 0) {
            if (!jp_uint(j, &d->delegation_version)) return false;
        } else if (strcmp(key, "delegation_sequence") == 0) {
            if (!jp_uint(j, &d->delegation_sequence)) return false;
        } else if (strcmp(key, "delegation_id") == 0) {
            if (!jp_string(j, d->delegation_id, sizeof(d->delegation_id))) return false;
        } else if (strcmp(key, "root_key_id") == 0) {
            if (!jp_string(j, d->root_key_id, sizeof(d->root_key_id))) return false;
        } else if (strcmp(key, "operational_key_id") == 0) {
            if (!jp_string(j, d->operational_key_id,
                           sizeof(d->operational_key_id))) return false;
        } else if (strcmp(key, "operational_public_key") == 0) {
            if (!jp_string(j, d->operational_public_key,
                           sizeof(d->operational_public_key))) return false;
        } else if (strcmp(key, "scope") == 0) {
            if (!jp_string(j, d->scope, sizeof(d->scope))) return false;
        } else if (strcmp(key, "system_id") == 0) {
            if (!jp_string(j, d->system_id, sizeof(d->system_id))) return false;
        } else if (strcmp(key, "signature_alg") == 0) {
            if (!jp_string(j, d->signature_alg, sizeof(d->signature_alg))) return false;
        } else if (strcmp(key, "root_signature") == 0) {
            if (!jp_string(j, d->root_signature, sizeof(d->root_signature))) return false;
        } else if (!jp_skip_value(j, 1)) {
            return false;
        }

        if (jp_eat(j, ',')) continue;
        if (jp_eat(j, '}')) return true;
        jp_fail(j);
        return false;
    }
}

/* -------------------------------------------------------------- publico -- */

bool diana_prov_parse(const char *payload, size_t len, diana_prov_command *out)
{
    memset(out, 0, sizeof(*out));
    if (payload == NULL || len == 0u) return false;

    jp j = { payload, payload + len, false };
    if (!jp_eat(&j, '{')) return false;

    if (!jp_peek(&j, '}')) {
        for (;;) {
            char key[64];
            if (!jp_string(&j, key, sizeof(key))) goto fail;
            if (!jp_eat(&j, ':')) goto fail;

            if (strcmp(key, "schema_version") == 0) {
                uint64_t v = 0;
                if (!jp_uint(&j, &v)) goto fail;
                /* El indicador es "vale 1", no "viene": una version distinta no
                 * se negocia, hace el mensaje no conforme. */
                out->has_schema_version_1 = (v == 1u);
            } else if (strcmp(key, "command_plane") == 0) {
                char plane[32];
                if (!jp_string(&j, plane, sizeof(plane))) goto fail;
                out->has_command_plane_device_management =
                    (strcmp(plane, "DEVICE_MANAGEMENT") == 0);
            } else if (strcmp(key, "action") == 0) {
                char act[16];
                if (!jp_string(&j, act, sizeof(act))) goto fail;
                if (strcmp(act, "PROVISION") == 0)
                    out->action = DIANA_PROV_ACTION_PROVISION;
                else if (strcmp(act, "PREPARE") == 0)
                    out->action = DIANA_PROV_ACTION_PREPARE;
                else if (strcmp(act, "COMMIT") == 0)
                    out->action = DIANA_PROV_ACTION_COMMIT;
                else
                    goto fail;   /* accion desconocida: no hay valor por defecto */
            } else if (strcmp(key, "mode") == 0) {
                char m[16];
                if (!jp_string(&j, m, sizeof(m))) goto fail;
                if (strcmp(m, "NORMAL") == 0)      out->mode = DIANA_PROV_MODE_NORMAL;
                else if (strcmp(m, "EMERGENCY") == 0) out->mode = DIANA_PROV_MODE_EMERGENCY;
                else goto fail;
            } else if (strcmp(key, "provisioning_sequence") == 0) {
                if (!jp_uint(&j, &out->provisioning_sequence)) goto fail;
                out->has_provisioning_sequence = true;
            } else if (strcmp(key, "issued_at_ms") == 0) {
                if (!jp_uint(&j, &out->issued_at_ms)) goto fail;
                out->has_issued_at_ms = true;
            } else if (strcmp(key, "request_id") == 0) {
                if (!jp_string(&j, out->request_id, sizeof(out->request_id))) goto fail;
                out->has_request_id = true;
            } else if (strcmp(key, "device_id") == 0) {
                if (!jp_string(&j, out->device_id, sizeof(out->device_id))) goto fail;
            } else if (strcmp(key, "system_id") == 0) {
                if (!jp_string(&j, out->system_id, sizeof(out->system_id))) goto fail;
            } else if (strcmp(key, "rotation_id") == 0) {
                if (!jp_string(&j, out->rotation_id, sizeof(out->rotation_id))) goto fail;
            } else if (strcmp(key, "current_epoch") == 0) {
                if (!jp_string(&j, out->current_epoch, sizeof(out->current_epoch))) goto fail;
            } else if (strcmp(key, "next_epoch") == 0) {
                if (!jp_string(&j, out->next_epoch, sizeof(out->next_epoch))) goto fail;
            } else if (strcmp(key, "epoch") == 0) {
                if (!jp_string(&j, out->epoch, sizeof(out->epoch))) goto fail;
            } else if (strcmp(key, "provision_id") == 0) {
                if (!jp_string(&j, out->provision_id, sizeof(out->provision_id))) goto fail;
            } else if (strcmp(key, "provisioning_key_fingerprint") == 0) {
                if (!jp_string(&j, out->provisioning_key_fingerprint,
                               sizeof(out->provisioning_key_fingerprint))) goto fail;
            } else if (strcmp(key, "signature_alg") == 0) {
                if (!jp_string(&j, out->signature_alg, sizeof(out->signature_alg))) goto fail;
            } else if (strcmp(key, "signature") == 0) {
                if (!jp_string(&j, out->signature, sizeof(out->signature))) goto fail;
            } else if (strcmp(key, "delegation") == 0) {
                if (!parse_delegation(&j, &out->delegation)) goto fail;
                out->has_delegation = true;
            } else if (!jp_skip_value(&j, 1)) {
                goto fail;
            }

            if (jp_eat(&j, ',')) continue;
            if (jp_eat(&j, '}')) break;
            goto fail;
        }
    } else {
        j.p++;   /* objeto vacio */
    }

    jp_ws(&j);
    if (j.err || j.p != j.end) goto fail;
    return true;

fail:
    /* Fallo CERRADO: nada de "lo que se pudo leer". */
    memset(out, 0, sizeof(*out));
    return false;
}

void diana_prov_message(diana_prov_ctx *ctx, const char *payload, size_t len,
                        bool retained, diana_prov_command *cmd,
                        diana_prov_outcome *out)
{
    /* El parseo NO decide. Aunque falle, se entra en diana_prov_handle() con la
     * estructura a cero para que el veredicto lo dicte SIEMPRE el mismo codigo
     * y en el mismo orden. Si el parser cortocircuitase aqui con un rechazo
     * propio, existirian DOS sitios que deciden y solo uno estaria probado
     * contra los vectores del contrato.
     *
     * MEDIDO, y conviene decirlo porque no es lo que uno supone: en
     * diana_prov_handle() la comprobacion de request_id va ANTES que la de
     * retenido (provisioning.c, "request-id-missing"). Un mensaje ilegible —y
     * por tanto sin request_id— sale con publish=false, no con
     * retained_provisioning_rejected, aunque venga retenido. Es coherente: sin
     * request_id no existe respuesta REJECTED valida contra el esquema. Lo que
     * el contrato exige es que un mensaje BIEN FORMADO y retenido muera por
     * retenido antes que por firma o secuencia, y eso si se cumple. */
    (void)diana_prov_parse(payload, len, cmd);
    diana_prov_handle(ctx, cmd, retained, out);
}
