/**
 * @file config_parse.c
 * @brief Deserializa module-config.schema.json (config/desired) a diana_config.
 *
 * POR QUE VIVE EN diana_core Y NO EN main/ CON cJSON.
 *
 * Es la misma razon que llevo prov_parse.c aqui: `main/app_commands.c` NO se
 * compila en la suite de host. Mientras el parseo de la configuracion vivio
 * alli, lo unico que el firmware hacia con un `config/desired` era leer
 * `config_version` y copiar el numero -- el resto de los campos se descartaba
 * con un comentario ("el resto se aplicaria aqui") y NINGUNA prueba podia
 * notarlo, porque ninguna prueba puede ejecutar ese fichero. El defecto era
 * invisible por construccion.
 *
 * QUE HACE Y QUE NO:
 *
 *  - Los campos AUSENTES conservan el valor de `base`. El esquema los declara
 *    opcionales y un mensaje parcial no puede borrar lo que no menciona.
 *  - `null` se trata como AUSENCIA (el backend emite `system_id: null` y
 *    `network.ip: null` para "sin valor"), salvo en `position: null`, que SI
 *    significa "sin posicion" y limpia has_position: esa es la unica lectura
 *    compatible con el emisor.
 *  - NO valida rangos: de eso se ocupa diana_config_validate(), que ya esta
 *    probada. Un parser que ademas "arregla" valores firma otra cosa distinta
 *    de la que llego.
 *  - FALLO CERRADO: ante cualquier error devuelve false y `out` queda sin
 *    tocar. No hay parseo a medias aplicable.
 */
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#include "diana/config.h"

/* -------------------------------------------------------------- escaner -- */

typedef struct {
    const char *p;
    const char *end;
    bool        err;
} cp;

static void cp_fail(cp *j) { j->err = true; j->p = j->end; }

static void cp_ws(cp *j)
{
    while (j->p < j->end &&
           (*j->p == ' ' || *j->p == '\t' || *j->p == '\n' || *j->p == '\r'))
        j->p++;
}

static bool cp_eat(cp *j, char c)
{
    cp_ws(j);
    if (j->p < j->end && *j->p == c) { j->p++; return true; }
    return false;
}

static bool cp_peek(cp *j, char c)
{
    cp_ws(j);
    return j->p < j->end && *j->p == c;
}

/** Literal `null`, `true` o `false`. */
static bool cp_lit(cp *j, const char *lit)
{
    size_t n = strlen(lit);
    cp_ws(j);
    if ((size_t)(j->end - j->p) < n) return false;
    if (memcmp(j->p, lit, n) != 0) return false;
    j->p += n;
    return true;
}

static bool cp_is_null(cp *j) { return cp_lit(j, "null"); }

/** Cadena JSON. Sin escapes Unicode fuera de ASCII, como en prov_parse.c: no
 *  hay campo del esquema que los necesite. Si no cabe es ERROR, no recorte. */
static bool cp_string(cp *j, char *out, size_t cap)
{
    size_t n = 0;
    if (!cp_eat(j, '"')) { cp_fail(j); return false; }
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
            default: cp_fail(j); return false;
            }
        } else if ((unsigned char)c < 0x20u) {
            cp_fail(j); return false;
        }
        if (out != NULL) {
            if (n + 1u >= cap) { cp_fail(j); return false; }
            out[n++] = c;
        }
    }
    cp_fail(j);
    return false;
}

/** Numero JSON a double. Acepta signo y fraccion: `neighbour_ratio` lo es. */
static bool cp_number(cp *j, double *out)
{
    cp_ws(j);
    const char *s = j->p;
    bool neg = false;
    if (j->p < j->end && (*j->p == '-' || *j->p == '+')) {
        neg = (*j->p == '-');
        j->p++;
    }
    double v = 0.0;
    const char *digits = j->p;
    while (j->p < j->end && *j->p >= '0' && *j->p <= '9') {
        v = v * 10.0 + (double)(*j->p - '0');
        j->p++;
    }
    if (j->p == digits) { j->p = s; cp_fail(j); return false; }
    if (j->p < j->end && *j->p == '.') {
        j->p++;
        double scale = 0.1;
        const char *frac = j->p;
        while (j->p < j->end && *j->p >= '0' && *j->p <= '9') {
            v += (double)(*j->p - '0') * scale;
            scale *= 0.1;
            j->p++;
        }
        if (j->p == frac) { cp_fail(j); return false; }
    }
    /* Exponente: NO se acepta. Ningun campo del contrato lo usa y admitirlo
     * daria dos escrituras del mismo valor sin ninguna necesidad. */
    if (j->p < j->end && (*j->p == 'e' || *j->p == 'E')) { cp_fail(j); return false; }
    *out = neg ? -v : v;
    return true;
}

static bool cp_skip_value(cp *j, int depth);

static bool cp_skip_container(cp *j, char close, int depth)
{
    if (cp_peek(j, close)) { j->p++; return true; }
    for (;;) {
        if (close == '}') {
            if (!cp_string(j, NULL, 0)) return false;
            if (!cp_eat(j, ':')) { cp_fail(j); return false; }
        }
        if (!cp_skip_value(j, depth + 1)) return false;
        if (cp_eat(j, ',')) continue;
        if (cp_eat(j, close)) return true;
        cp_fail(j);
        return false;
    }
}

/** Descarta un valor cualquiera. El limite de profundidad evita que un payload
 *  anidado a proposito agote la pila de la tarea de red. */
static bool cp_skip_value(cp *j, int depth)
{
    if (depth > 8) { cp_fail(j); return false; }
    cp_ws(j);
    if (j->p >= j->end) { cp_fail(j); return false; }
    char c = *j->p;
    if (c == '"') return cp_string(j, NULL, 0);
    if (c == '{') { j->p++; return cp_skip_container(j, '}', depth); }
    if (c == '[') { j->p++; return cp_skip_container(j, ']', depth); }
    if (c == 't' || c == 'f' || c == 'n' || c == '-' || c == '+' ||
        (c >= '0' && c <= '9')) {
        while (j->p < j->end && *j->p != ',' && *j->p != '}' && *j->p != ']' &&
               *j->p != ' ' && *j->p != '\n' && *j->p != '\r' && *j->p != '\t')
            j->p++;
        return true;
    }
    cp_fail(j);
    return false;
}

/* ------------------------------------------------------------- secciones -- */

static bool parse_position(cp *j, diana_config *cfg)
{
    if (cp_is_null(j)) {
        /* `position: null` es "sin posicion", no "no lo menciono". */
        cfg->has_position = false;
        cfg->position_x = 0;
        cfg->position_y = 0;
        return true;
    }
    if (!cp_eat(j, '{')) { cp_fail(j); return false; }
    double x = 0, y = 0;
    bool hx = false, hy = false;
    if (cp_peek(j, '}')) { j->p++; }
    else for (;;) {
        char key[32];
        if (!cp_string(j, key, sizeof(key))) return false;
        if (!cp_eat(j, ':')) { cp_fail(j); return false; }
        if (strcmp(key, "x") == 0)      { if (!cp_number(j, &x)) return false; hx = true; }
        else if (strcmp(key, "y") == 0) { if (!cp_number(j, &y)) return false; hy = true; }
        else if (!cp_skip_value(j, 1)) return false;
        if (cp_eat(j, ',')) continue;
        if (cp_eat(j, '}')) break;
        cp_fail(j);
        return false;
    }
    if (hx && hy) {
        cfg->has_position = true;
        cfg->position_x = (int8_t)x;
        cfg->position_y = (int8_t)y;
    }
    return true;
}

static bool parse_network(cp *j, diana_config *cfg)
{
    if (cp_is_null(j)) return true;
    if (!cp_eat(j, '{')) { cp_fail(j); return false; }
    if (cp_peek(j, '}')) { j->p++; return true; }
    for (;;) {
        char key[32];
        if (!cp_string(j, key, sizeof(key))) return false;
        if (!cp_eat(j, ':')) { cp_fail(j); return false; }
        if (strcmp(key, "mode") == 0) {
            if (!cp_is_null(j)) {
                char mode[16];
                if (!cp_string(j, mode, sizeof(mode))) return false;
                if (strcmp(mode, "static") == 0)    cfg->network.mode = DIANA_NET_STATIC;
                else if (strcmp(mode, "dhcp") == 0) cfg->network.mode = DIANA_NET_DHCP;
                else { cp_fail(j); return false; }
            }
        } else if (strcmp(key, "ip") == 0 || strcmp(key, "netmask") == 0 ||
                   strcmp(key, "gateway") == 0) {
            char *dst = (key[0] == 'i') ? cfg->network.ip
                      : (key[0] == 'n') ? cfg->network.netmask
                                        : cfg->network.gateway;
            if (cp_is_null(j)) {
                dst[0] = '\0';
            } else if (!cp_string(j, dst, sizeof(cfg->network.ip))) {
                return false;
            }
        } else if (!cp_skip_value(j, 1)) {
            return false;
        }
        if (cp_eat(j, ',')) continue;
        if (cp_eat(j, '}')) return true;
        cp_fail(j);
        return false;
    }
}

static bool parse_cal_entry(cp *j, diana_config *cfg)
{
    if (!cp_eat(j, '{')) { cp_fail(j); return false; }

    /* El canal se identifica por `target_index` y NO por la posicion en el
     * array: el backend solo emite los canales CALIBRADOS, asi que el array
     * puede venir con huecos o desordenado. Indexar por posicion escribiria la
     * calibracion del canal 5 en el 1. */
    double idx = 0;
    bool has_idx = false;
    double threshold = 0, hyst = 0, floor_ = 0, blank = 0, window = 0, ratio = 0;
    bool h_thr = false, h_hys = false, h_flo = false, h_bla = false,
         h_win = false, h_rat = false, h_ena = false, enabled = false;
    char cal_at[32];
    bool h_cal = false;
    cal_at[0] = '\0';

    if (cp_peek(j, '}')) { j->p++; }
    else for (;;) {
        char key[40];
        if (!cp_string(j, key, sizeof(key))) return false;
        if (!cp_eat(j, ':')) { cp_fail(j); return false; }
        if (strcmp(key, "target_index") == 0)        { if (!cp_number(j, &idx)) return false; has_idx = true; }
        else if (strcmp(key, "threshold") == 0)      { if (!cp_number(j, &threshold)) return false; h_thr = true; }
        else if (strcmp(key, "hysteresis") == 0)     { if (!cp_number(j, &hyst)) return false; h_hys = true; }
        else if (strcmp(key, "noise_floor") == 0)    { if (!cp_number(j, &floor_)) return false; h_flo = true; }
        else if (strcmp(key, "blanking_us") == 0)    { if (!cp_number(j, &blank)) return false; h_bla = true; }
        else if (strcmp(key, "group_window_us") == 0){ if (!cp_number(j, &window)) return false; h_win = true; }
        else if (strcmp(key, "neighbour_ratio") == 0){ if (!cp_number(j, &ratio)) return false; h_rat = true; }
        else if (strcmp(key, "enabled") == 0) {
            if (cp_lit(j, "true"))       { enabled = true;  h_ena = true; }
            else if (cp_lit(j, "false")) { enabled = false; h_ena = true; }
            else { cp_fail(j); return false; }
        } else if (strcmp(key, "calibrated_at") == 0) {
            if (cp_is_null(j)) { /* ausencia explicita: sigue sin calibrar */ }
            else { if (!cp_string(j, cal_at, sizeof(cal_at))) return false; h_cal = true; }
        } else if (!cp_skip_value(j, 1)) {
            return false;
        }
        if (cp_eat(j, ',')) continue;
        if (cp_eat(j, '}')) break;
        cp_fail(j);
        return false;
    }

    if (!has_idx) { cp_fail(j); return false; }
    if (idx < 1.0 || idx > (double)DIANA_TARGET_COUNT) { cp_fail(j); return false; }

    diana_target_calibration *c = &cfg->calibration[(size_t)idx - 1u];
    if (h_thr) c->threshold       = (uint16_t)threshold;
    if (h_hys) c->hysteresis      = (uint16_t)hyst;
    if (h_flo) c->noise_floor     = (uint16_t)floor_;
    if (h_bla) c->blanking_us     = (uint32_t)blank;
    if (h_win) c->group_window_us = (uint32_t)window;
    if (h_rat) c->neighbour_ratio = (float)ratio;
    if (h_ena) c->enabled         = enabled;
    if (h_cal) {
        /* Un canal solo se considera VALIDADO si trae `calibrated_at`. El sello
         * es informativo: NO ordena nada, no se compara con ningun reloj y no
         * participa en la decision de version. */
        memcpy(c->calibrated_at, cal_at, sizeof(c->calibrated_at) - 1u);
        c->calibrated_at[sizeof(c->calibrated_at) - 1u] = '\0';
        c->has_calibrated_at = true;
    }
    return true;
}

static bool parse_calibration(cp *j, diana_config *cfg)
{
    if (cp_is_null(j)) return true;
    if (!cp_eat(j, '[')) { cp_fail(j); return false; }
    if (cp_peek(j, ']')) { j->p++; return true; }
    for (;;) {
        if (!parse_cal_entry(j, cfg)) return false;
        if (cp_eat(j, ',')) continue;
        if (cp_eat(j, ']')) return true;
        cp_fail(j);
        return false;
    }
}

/* ----------------------------------------------------------------- api --- */

bool diana_config_parse(const char *payload, size_t len,
                        const diana_config *base, diana_config *out)
{
    if (payload == NULL || out == NULL) return false;

    /* Se trabaja sobre una copia: si algo falla, `out` no se toca. Ese es el
     * fallo cerrado, y es la razon de no escribir directamente en `out`. */
    diana_config tmp;
    if (base != NULL) tmp = *base;
    else              diana_config_defaults(&tmp);

    cp j = { payload, payload + len, false };
    if (!cp_eat(&j, '{')) return false;

    bool has_version = false;

    if (cp_peek(&j, '}')) { j.p++; }
    else for (;;) {
        char key[48];
        if (!cp_string(&j, key, sizeof(key))) return false;
        if (!cp_eat(&j, ':')) return false;

        if (strcmp(key, "config_version") == 0) {
            double v = 0;
            if (!cp_number(&j, &v)) return false;
            if (v < 0.0) return false;
            tmp.config_version = (uint32_t)v;
            has_version = true;
        } else if (strcmp(key, "system_id") == 0) {
            if (cp_is_null(&j)) { /* sin sistema: se conserva el actual */ }
            else if (!cp_string(&j, tmp.system_id, sizeof(tmp.system_id))) return false;
        } else if (strcmp(key, "friendly_name") == 0) {
            if (cp_is_null(&j)) { /* omitido == sin cambio */ }
            else if (!cp_string(&j, tmp.friendly_name, sizeof(tmp.friendly_name))) return false;
        } else if (strcmp(key, "rotation") == 0) {
            double v = 0;
            if (cp_is_null(&j)) { /* sin cambio */ }
            else { if (!cp_number(&j, &v)) return false; tmp.rotation = (uint16_t)v; }
        } else if (strcmp(key, "led_brightness_max") == 0) {
            double v = 0;
            if (cp_is_null(&j)) { }
            else { if (!cp_number(&j, &v)) return false; tmp.led_brightness_max = (uint8_t)v; }
        } else if (strcmp(key, "telemetry_interval_ms") == 0) {
            double v = 0;
            if (cp_is_null(&j)) { }
            else { if (!cp_number(&j, &v)) return false; tmp.telemetry_interval_ms = (uint32_t)v; }
        } else if (strcmp(key, "position") == 0) {
            if (!parse_position(&j, &tmp)) return false;
        } else if (strcmp(key, "network") == 0) {
            if (!parse_network(&j, &tmp)) return false;
        } else if (strcmp(key, "calibration") == 0) {
            if (!parse_calibration(&j, &tmp)) return false;
        } else {
            /* `schema_version`, `module_id`, `coordinator_module_id` y
             * cualquier campo futuro: se descartan sin fallar. Un mensaje del
             * contrato v1 con un campo de mas no es un mensaje corrupto. */
            if (!cp_skip_value(&j, 1)) return false;
        }

        if (cp_eat(&j, ',')) continue;
        if (cp_eat(&j, '}')) break;
        return false;
    }
    if (j.err) return false;

    /* Sin `config_version` no hay nada que reconciliar: el mensaje no dice que
     * version es, y aceptarlo obligaria a inventarse una. Se rechaza. */
    if (!has_version) return false;

    *out = tmp;
    return true;
}
