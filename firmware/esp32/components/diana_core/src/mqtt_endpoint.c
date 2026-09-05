/**
 * @file mqtt_endpoint.c
 * @brief Identidad, transporte y CA del cliente MQTT. Ver mqtt_endpoint.h.
 *
 * Logica pura: sin ESP-IDF, sin red, sin reloj. Todo lo de aqui se EJECUTA en
 * la suite de host, que es el unico motivo por el que existe este fichero.
 */
#include "diana/mqtt_endpoint.h"

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
