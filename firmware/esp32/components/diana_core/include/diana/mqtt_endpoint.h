/**
 * @file mqtt_endpoint.h
 * @brief Construccion del PUNTO FINAL MQTT del modulo: usuario, URI y CA.
 *
 * Por que esto vive en diana_core y no en main/app_main.c:
 *
 *   La identidad MQTT del modulo es una propiedad de SEGURIDAD (hallazgo F-02,
 *   cerrado). Mientras estuvo escrita como un `snprintf` dentro de app_main.c
 *   era INFALSABLE: app_main.c no se compila en la suite de host, asi que
 *   ninguna prueba podia ejecutarla, y el prefijo `module-` sobrevivio al
 *   cierre de F-02 sin que nada se pusiera rojo. Extraida aqui, la propiedad
 *   se puede EJECUTAR contra las identidades reales del broker
 *   (infrastructure/mosquitto/identities.json y el acl generado).
 *
 * Invariantes que fija este modulo:
 *
 *   1. IDENTIDAD (contrato mqtt/README §8, F-02): el usuario MQTT es
 *      EXACTAMENTE el module_id, literal, sin prefijo ni sufijo. Cualquier
 *      decoracion reabre F-02 sin sintoma visible (todo sigue conectando).
 *
 *   2. TRANSPORTE (P0-2): el esquema por defecto es `mqtts://`. `mqtt://` solo
 *      es alcanzable a traves del perfil de laboratorio EXPLICITO
 *      (DIANA_MQTT_INSECURE_LAB), nunca como consecuencia de un fallo.
 *
 *   3. FALLO CERRADO: si la CA no esta o no es una CA valida, no hay conexion.
 *      No existe ningun camino que convierta ausencia o error de CA en MQTT
 *      sin validar. En particular NO hay degradacion a `mqtt://`.
 */
#ifndef DIANA_MQTT_ENDPOINT_H
#define DIANA_MQTT_ENDPOINT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Usuario MQTT: cabe un module_id completo (identifier de hasta 63 chars). */
#define DIANA_MQTT_USER_MAXLEN 64

/** "mqtts://" + host + ':' + puerto + NUL, con holgura para un IPv6 literal. */
#define DIANA_MQTT_URI_MAXLEN 96

/** Longitud minima plausible de un PEM de CA. Por debajo no se intenta nada. */
#define DIANA_MQTT_CA_MINLEN 128

/** Codigos de retorno. Negativos = rechazo; NUNCA hay un camino "a medias". */
#define DIANA_MQTT_OK          0
#define DIANA_MQTT_ERR_INVALID (-1)
#define DIANA_MQTT_ERR_SPACE   (-2)

/** Transporte. El valor 0 (por defecto de cualquier struct a cero) es TLS. */
typedef enum {
    DIANA_MQTT_TRANSPORT_TLS = 0,
    /* Perfil de banco. Solo se alcanza si alguien lo activa a proposito en
     * Kconfig; jamas como consecuencia de un error en tiempo de ejecucion. */
    DIANA_MQTT_TRANSPORT_INSECURE_LAB = 1,
} diana_mqtt_transport;

/**
 * Escribe en `out` el usuario MQTT correspondiente a `module_id`.
 *
 * Es una COPIA LITERAL, deliberadamente. La funcion existe justamente para que
 * la ausencia de prefijo sea comprobable por una prueba, no por lectura.
 *
 * Rechaza (DIANA_MQTT_ERR_INVALID) module_id nulo, vacio, o con caracteres que
 * no pueden formar parte ni de un usuario de Mosquitto ni de un tramo de
 * topico: espacios, control, '/', '+', '#', ':'.
 * Rechaza (DIANA_MQTT_ERR_SPACE) si no cabe: nunca trunca una identidad, que
 * es lo mismo que suplantar a otra.
 */
int diana_mqtt_username(const char *module_id, char *out, size_t cap);

/**
 * Escribe en `out` la URI del broker: "mqtts://host:port", o "mqtt://host:port"
 * SOLO si `transport` es DIANA_MQTT_TRANSPORT_INSECURE_LAB.
 *
 * Rechaza host nulo/vacio, host que ya trae esquema ("://"), host con '/' o
 * espacios, y puerto 0.
 */
int diana_mqtt_uri(const char *host, uint16_t port, diana_mqtt_transport transport,
                   char *out, size_t cap);

/**
 * true solo si `pem` es plausiblemente una CA en PEM: delimitadores BEGIN/END
 * CERTIFICATE en orden y cuerpo no vacio.
 *
 * NO valida criptograficamente el certificado -- eso lo hace mbedTLS en el
 * handshake, y esa es la validacion que de verdad cuenta. Esta comprobacion
 * existe para que el modulo se NIEGUE A ARRANCAR MQTT cuando la CA falta o
 * esta vacia, en vez de entregarle a esp-mqtt un `certificate = NULL` que
 * desactiva silenciosamente la verificacion del servidor.
 */
bool diana_mqtt_ca_is_valid(const char *pem, size_t len);

/**
 * Decision unica de arranque: ¿se puede conectar con estos parametros?
 *
 * Concentra la regla de fallo cerrado en un solo sitio para que solo haya una
 * cosa que probar y una sola que romper:
 *   - transporte TLS  -> exige CA valida;
 *   - transporte LAB  -> no exige CA, pero es un perfil que hay que pedir.
 * Devuelve false tambien si no hay identidad utilizable.
 */
bool diana_mqtt_may_connect(diana_mqtt_transport transport, const char *ca_pem,
                            size_t ca_len, const char *module_id);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_MQTT_ENDPOINT_H */
