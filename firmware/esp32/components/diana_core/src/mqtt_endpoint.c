/**
 * @file mqtt_endpoint.c
 * @brief Identidad, transporte y CA del cliente MQTT. Ver mqtt_endpoint.h.
 *
 * Logica pura: sin ESP-IDF, sin red, sin reloj. Todo lo de aqui se EJECUTA en
 * la suite de host, que es el unico motivo por el que existe este fichero.
 */
#include "diana/mqtt_endpoint.h"

#include "diana/sha256.h"

#include <string.h>

/* Caracteres que no pueden aparecer en un module_id. ':' y '/' romperian la
 * URI o el arbol de topicos; '+' y '#' son comodines de MQTT y convertirian
 * una regla de ACL en un permiso ancho; el control y el espacio no sobreviven
 * a la comparacion literal que hace Mosquitto en `user <nombre>`. */
static bool id_char_ok(char c)
{
    unsigned char u = (unsigned char)c;
    if (u <= 0x20 || u == 0x7f) return false;   /* control y espacio */
    if (c == '/' || c == '+' || c == '#' || c == ':') return false;
    return true;
}

int diana_mqtt_username(const char *module_id, char *out, size_t cap)
{
    if (!out || cap == 0) return DIANA_MQTT_ERR_INVALID;
    out[0] = '\0';
    if (!module_id || module_id[0] == '\0') return DIANA_MQTT_ERR_INVALID;

    size_t n = strlen(module_id);
    for (size_t i = 0; i < n; ++i)
        if (!id_char_ok(module_id[i])) return DIANA_MQTT_ERR_INVALID;

    /* Truncar una identidad es suplantar otra: se rechaza, no se recorta. */
    if (n + 1 > cap) return DIANA_MQTT_ERR_SPACE;

    /* ===================================================================
     * F-02. El usuario ES el module_id. Sin prefijo `module-`, sin sufijo,
     * sin normalizar. Si alguien anade algo aqui, la prueba
     * test_mqtt_endpoint.c se pone roja contra identities.json y el acl.
     * =================================================================== */
    memcpy(out, module_id, n);
    out[n] = '\0';
    return DIANA_MQTT_OK;
}

static bool host_ok(const char *host)
{
    if (!host || host[0] == '\0') return false;
    if (strstr(host, "://") != NULL) return false;  /* ya trae esquema */
    for (const char *p = host; *p; ++p) {
        unsigned char u = (unsigned char)*p;
        if (u <= 0x20 || u == 0x7f) return false;
        if (*p == '/' || *p == '@') return false;
    }
    return true;
}

int diana_mqtt_uri(const char *host, uint16_t port, diana_mqtt_transport transport,
                   char *out, size_t cap)
{
    if (!out || cap == 0) return DIANA_MQTT_ERR_INVALID;
    out[0] = '\0';
    if (!host_ok(host) || port == 0) return DIANA_MQTT_ERR_INVALID;

    /* El esquema se decide UNICAMENTE por el perfil pedido en compilacion. No
     * hay ninguna otra entrada -- ni error, ni timeout, ni ausencia de CA --
     * que pueda llevar a "mqtt://". Esa es la invariante de P0-2. */
    const char *scheme;
    switch (transport) {
    case DIANA_MQTT_TRANSPORT_INSECURE_LAB:
        scheme = "mqtt://";
        break;
    case DIANA_MQTT_TRANSPORT_TLS:
        scheme = "mqtts://";
        break;
    default:
        /* Valor desconocido: no se adivina, se rechaza. */
        return DIANA_MQTT_ERR_INVALID;
    }

    /* Formateo a mano para no depender de snprintf y para poder devolver
     * ERR_SPACE en vez de truncar (un truncado daria un host distinto). */
    char portbuf[6];
    size_t pl = 0;
    {
        uint16_t v = port;
        char rev[6];
        size_t r = 0;
        while (v > 0 && r < sizeof(rev)) { rev[r++] = (char)('0' + (v % 10)); v = (uint16_t)(v / 10); }
        while (r > 0) portbuf[pl++] = rev[--r];
        portbuf[pl] = '\0';
    }

    size_t sl = strlen(scheme), hl = strlen(host);
    if (sl + hl + 1 + pl + 1 > cap) return DIANA_MQTT_ERR_SPACE;

    memcpy(out, scheme, sl);
    memcpy(out + sl, host, hl);
    out[sl + hl] = ':';
    memcpy(out + sl + hl + 1, portbuf, pl);
    out[sl + hl + 1 + pl] = '\0';
    return DIANA_MQTT_OK;
}

bool diana_mqtt_ca_is_valid(const char *pem, size_t len)
{
    static const char BEGIN[] = "-----BEGIN CERTIFICATE-----";
    static const char END[]   = "-----END CERTIFICATE-----";

    if (!pem || len < DIANA_MQTT_CA_MINLEN) return false;
    /* esp-mqtt acepta el PEM como cadena terminada en NUL; si el buffer no lo
     * esta, leer mas alla es un fallo de memoria, no una CA. */
    if (pem[len - 1] != '\0') return false;

    const char *b = strstr(pem, BEGIN);
    if (!b) return false;
    const char *e = strstr(b + sizeof(BEGIN) - 1, END);
    if (!e) return false;
    /* Cuerpo base64 no vacio entre delimitadores. Un PEM con los dos marcadores
     * pegados no es un certificado. */
    return (size_t)(e - (b + sizeof(BEGIN) - 1)) > 16;
}

bool diana_mqtt_may_connect(diana_mqtt_transport transport, const char *ca_pem,
                            size_t ca_len, const char *module_id)
{
    char user[DIANA_MQTT_USER_MAXLEN];
    if (diana_mqtt_username(module_id, user, sizeof(user)) != DIANA_MQTT_OK)
        return false;

    if (transport == DIANA_MQTT_TRANSPORT_INSECURE_LAB)
        return true;   /* perfil de banco, pedido a proposito en Kconfig */

    if (transport != DIANA_MQTT_TRANSPORT_TLS)
        return false;

    /* FALLO CERRADO. Sin CA valida no hay conexion, y no hay rama alternativa:
     * la unica salida de aqui con transporte TLS es "hay CA" o "no se conecta".
     * Deliberadamente NO se devuelve un transporte distinto ni se sugiere uno. */
    return diana_mqtt_ca_is_valid(ca_pem, ca_len);
}

/* ===========================================================================
 * HUELLA DE LA CA · la CA no puede degradarse en silencio
 * ===========================================================================
 *
 * diana_mqtt_ca_is_valid() solo exige que haya un PEM. Eso impide el fallo
 * SILENCIOSO de `certificate = NULL`, pero no impide el otro: que alguien
 * sustituya el marcador por un certificado de ejemplo cualquiera. Ese pasaria
 * la validez sintactica y el modulo intentaria conectar contra un broker que
 * no puede verificar, fallando mucho mas tarde y mucho peor.
 *
 * La huella se calcula sobre el DER -- es decir, se decodifica el base64 del
 * cuerpo PEM y se hashea el resultado -- para que sea EXACTAMENTE el valor que
 * imprime `openssl x509 -noout -fingerprint -sha256`. Si se hasheara el texto,
 * el operador no tendria forma de obtenerlo con herramientas normales y la
 * declaracion se convertiria en un numero magico que nadie sabe recalcular.
 * =========================================================================== */

/* base64 ESTANDAR (RFC 4648 §4: '+', '/', relleno '='), que es el que usa PEM.
 * No se reutiliza diana_base64url_decode: ese es base64URL sin relleno y
 * rechazaria todo PEM. Son alfabetos distintos y mezclarlos seria un error
 * silencioso. */
static int b64_val(char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

static bool b64_ws(char c)
{
    return c == '\n' || c == '\r' || c == '\t' || c == ' ';
}

/** Decodifica el base64 estandar de [begin,end) sobre `out`. Devuelve false si
 *  aparece cualquier caracter que no sea del alfabeto, relleno o espacio. */
static bool b64_decode(const char *begin, const char *end,
                       uint8_t *out, size_t cap, size_t *out_len)
{
    uint32_t acc = 0;
    int bits = 0;
    size_t n = 0;
    bool pad = false;

    for (const char *p = begin; p < end; ++p) {
        char c = *p;
        if (b64_ws(c)) continue;
        if (c == '=') { pad = true; continue; }
        if (pad) return false;              /* datos despues del relleno */
        int v = b64_val(c);
        if (v < 0) return false;
        acc = (acc << 6) | (uint32_t)v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            if (n >= cap) return false;
            out[n++] = (uint8_t)((acc >> bits) & 0xffu);
        }
    }
    if (n == 0) return false;
    *out_len = n;
    return true;
}

/** DER de un certificado X.509 de CA tipico: 1-2 KiB. 4 KiB deja holgura sin
 *  comprometer la pila del arranque. Un PEM mayor se RECHAZA (huella vacia),
 *  nunca se hashea a medias: media huella es una huella equivocada. */
#define DIANA_CA_DER_MAX 4096

bool diana_mqtt_ca_fingerprint(const char *pem, size_t len, char *out_hex)
{
    static const char BEGIN[] = "-----BEGIN CERTIFICATE-----";
    static const char END[]   = "-----END CERTIFICATE-----";

    if (!out_hex) return false;
    out_hex[0] = '\0';
    if (!diana_mqtt_ca_is_valid(pem, len)) return false;

    const char *b = strstr(pem, BEGIN);
    if (!b) return false;
    const char *body = b + sizeof(BEGIN) - 1;
    const char *e = strstr(body, END);
    if (!e) return false;

    /* static: el DER de una CA no cabe holgadamente en la pila de la tarea de
     * arranque de ESP-IDF, y esta funcion se llama una sola vez, antes de que
     * exista concurrencia. */
    static uint8_t der[DIANA_CA_DER_MAX];
    size_t der_len = 0;
    if (!b64_decode(body, e, der, sizeof(der), &der_len)) return false;

    diana_sha256_hex(der, der_len, out_hex);
    return true;
}

static int hex_val(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

bool diana_mqtt_ca_is_declared(const char *pem, size_t len,
                               const char *declared_hex)
{
    if (!declared_hex) return false;

    /* Normalizar la declaracion: se toleran espacios y saltos de linea (un
     * fichero de texto siempre acaba en '\n') y mayusculas, pero NADA mas.
     * Los ':' del formato de openssl se rechazan a proposito: la declaracion
     * es un valor canonico, no un pegado libre. El centinela "NONE" no es hex,
     * asi que cae aqui y devuelve false: no autoriza nada. */
    char want[DIANA_MQTT_CA_FP_HEXLEN + 1];
    size_t w = 0;
    for (const char *p = declared_hex; *p; ++p) {
        if (b64_ws(*p)) continue;
        int v = hex_val(*p);
        if (v < 0) return false;
        if (w >= DIANA_MQTT_CA_FP_HEXLEN) return false; /* declaracion larga */
        want[w++] = (char)(v < 10 ? ('0' + v) : ('a' + v - 10));
    }
    if (w != DIANA_MQTT_CA_FP_HEXLEN) return false;     /* corta o vacia */
    want[w] = '\0';

    char got[DIANA_MQTT_CA_FP_HEXLEN + 1];
    if (!diana_mqtt_ca_fingerprint(pem, len, got)) return false;

    return memcmp(got, want, DIANA_MQTT_CA_FP_HEXLEN) == 0;
}
