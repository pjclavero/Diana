/**
 * @file platform_esp.h
 * @brief Implementacion del HAL de Diana sobre ESP-IDF (ESP32-S3 + W5500).
 *
 * ###########################################################################
 * # NO COMPILADO. Este componente NO se ha podido construir: en el entorno  #
 * # de desarrollo no hay ESP-IDF instalado ni hardware. Es codigo escrito   #
 * # contra la API documentada de ESP-IDF v5.x y esta PENDIENTE de su primer #
 * # `idf.py build`. La logica que si esta probada vive en diana_core y se   #
 * # ejecuta en host contra test_host/hal_host.c.                            #
 * ###########################################################################
 */
#ifndef DIANA_PLATFORM_ESP_H
#define DIANA_PLATFORM_ESP_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Contexto de la plataforma. Opaco para el core. */
typedef struct diana_platform diana_platform;

/**
 * Arranca los periféricos y rellena la tabla de operaciones del HAL.
 * Orden: NVS -> particion de cola -> HC165/entradas -> LED -> Ethernet -> MQTT.
 * Devuelve 0 en exito.
 */
int diana_platform_init(diana_platform **out, diana_hal *hal);

/**
 * Registra el Last Will ANTES de conectar y conecta al broker.
 * @param client_id  DEBE ser igual al module_id, sin prefijo (contrato §8).
 * @param uri        "mqtts://host:puerto" en produccion. Construyela con
 *                   diana_mqtt_uri(): el esquema no se decide aqui.
 * @param user       usuario MQTT. Es EXACTAMENTE el module_id, sin prefijo
 *                   (contrato §8; F-02 cerrado). Construyelo con
 *                   diana_mqtt_username(), que es la version comprobada contra
 *                   identities.json y contra el acl del broker.
 * @param ca_pem     CA que firma al broker, en PEM terminado en NUL.
 * @param ca_len     longitud del buffer de CA, NUL incluido.
 * @param ca_declared_fp  huella SHA-256 hex DECLARADA para esa CA (C-1), tal y
 *                   como la empota main/certs/broker_ca.sha256. Con mqtts://
 *                   tiene que coincidir con la huella real del PEM.
 *
 * FALLO CERRADO: con una URI mqtts:// y una CA ausente, invalida o NO DECLARADA
 * devuelve un codigo negativo y NO conecta. No degrada a texto en claro bajo
 * ninguna circunstancia.
 */
int diana_platform_mqtt_start(diana_platform *p, const char *client_id,
                              const char *uri, const char *user, const char *pass,
                              const char *ca_pem, size_t ca_len,
                              const char *ca_declared_fp,
                              const char *lwt_topic, const char *lwt_payload);

/** Suscribe a los topicos de entrada del modulo (command, config, ota, game). */
int diana_platform_mqtt_subscribe(diana_platform *p, const char *module_id);

/**
 * Activa o desactiva el rol de COORDINADOR en el transporte.
 *
 * Con `active` true suscribe a `system/{system_id}/command`, que es la entrada
 * del coordinador; con false se DESUSCRIBE y deja de recibirla. Es lo que hace
 * que mover el selector a SATELITE deje de coordinar de inmediato en vez de
 * seguir escuchando ordenes de juego.
 *
 * La intencion se recuerda: las suscripciones se reemiten en cada CONNACK.
 */
int diana_platform_mqtt_set_coordinator(diana_platform *p, bool active,
                                        const char *system_id);

/* Capacidad del receptor MQTT, en bytes de payload.
 *
 * NO es un numero redondo elegido a ojo: `tools/check_mqtt_rx_capacity.py`
 * construye el `config/desired` MAS GRANDE que el contrato admite --- nueve
 * dianas calibradas, identificadores y nombre al maximo, red estatica ---, lo
 * VALIDA contra `module-config.schema.json` y lo mide: 2640 bytes. Con el
 * margen declarado de 512 quedan 3152; se redondea a 4096 por alineacion.
 * Esa guarda se pone ROJA si esta cifra baja del peor caso medido.
 *
 * El valor anterior (2048) no llegaba ni al mensaje NORMAL de un modulo 3x3
 * completo (2239 bytes), asi que la configuracion no podia aplicarse nunca.
 *
 * Hueco DECLARADO: `neighbour_ratio` (decimales de un double), las marcas
 * `date-time` (sin maxLength) y `config_version` (entero sin maximo) no estan
 * realmente acotados por el esquema. Para ellos rige un limite de PRODUCTO
 * fijado en esa misma guarda. Un mensaje que lo exceda se rechaza limpiamente
 * por capacidad; nunca se trunca. */
#define DIANA_MQTT_RX_PAYLOAD_MAX 4096

/** Cola de mensajes MQTT recibidos, para consumir desde la tarea principal. */
typedef struct {
    char topic[DIANA_TOPIC_MAXLEN];
    /* +1 para el NUL: un payload de exactamente DIANA_MQTT_RX_PAYLOAD_MAX
     * bytes es ACEPTABLE, no un caso limite que se pierde por el terminador. */
    char payload[DIANA_MQTT_RX_PAYLOAD_MAX + 1];
    size_t payload_len;
    uint64_t recv_us;   /* reloj MONOTONICO de recepcion: base de la caducidad */

    /* Bandera de TRANSPORTE: no viaja en el payload, asi que ningun esquema
     * puede verla. Un mensaje RETENIDO es un replay servido por el broker al
     * suscribirse, y el plano DEVICE_MANAGEMENT lo rechaza ANTES incluso de
     * verificar la firma. Sin este campo esa guarda no puede existir. */
    bool retained;
} diana_platform_rx;

/** Extrae un mensaje recibido. Devuelve false si no hay ninguno. */
bool diana_platform_rx_pop(diana_platform *p, diana_platform_rx *out,
                           uint32_t timeout_ms);

/* --- sensores DO-only ------------------------------------------------------ */

/** Snapshot capturado por polling del 74HC165: bitmap crudo y reloj monotono. */
typedef struct {
    uint16_t raw_bitmap; /* bit 0=D1 ... bit 8=D9 tras orden de cascada */
    uint64_t t_us;
} diana_platform_trigger;

/** Extrae un snapshot activo/cambiado de la cola de polling. */
bool diana_platform_trigger_pop(diana_platform *p, diana_platform_trigger *out,
                                uint32_t timeout_ms);

int diana_platform_hc165_read_raw(diana_platform *p, uint16_t *out_raw);

/* --- led ------------------------------------------------------------------- */

int diana_platform_led_refresh(diana_platform *p);

/* --- ethernet -------------------------------------------------------------- */

int diana_platform_eth_start(diana_platform *p, bool use_static,
                             const char *ip, const char *netmask,
                             const char *gw);

bool diana_platform_eth_available(diana_platform *p);

/**
 * Clasificacion de la lectura de VERSIONR (registro 0x0039 del W5500).
 *
 * VERSIONR es un observable DISTINTO de la disponibilidad del driver: que
 * `diana_platform_eth_available()` devuelva true solo dice que el driver se
 * instalo, no que el SPI hable de verdad con el chip.
 */
typedef enum {
    DIANA_W5500_VERSION_OK = 0,     /* 0x04: el unico valor valido */
    DIANA_W5500_VERSION_INVALID,    /* 0x00: la incidencia historica */
    DIANA_W5500_VERSION_UNEXPECTED, /* cualquier otro valor */
    DIANA_W5500_VERSION_READ_ERROR, /* la transaccion SPI no se completo */
} diana_w5500_version_class;

const char *diana_w5500_version_class_str(diana_w5500_version_class c);

/**
 * Lee VERSIONR UNA vez, por el mismo camino SPI que usa el driver Ethernet y
 * bajo su mismo mutex.
 *
 * NO reintenta: si el chip devuelve 0x00, esta funcion devuelve 0x00. Envolver
 * esto en un bucle hasta obtener 0x04 destruiria su unico proposito.
 *
 * @return 0 si la transaccion SPI se completo, aunque el valor no sea 0x04.
 */
int diana_platform_eth_versionr(diana_platform *p, uint8_t *out_value,
                                diana_w5500_version_class *out_class);

/**
 * PRIMERA lectura de VERSIONR, tomada durante la inicializacion del SPI y
 * ANTES de que ESP-IDF ejecute su `w5500_verify_id()`.
 *
 * Esa funcion de ESP-IDF sondea VERSIONR en bucle hasta obtener 0x04 --- su
 * propio comentario dice que algunos W5500 devuelven 0 justo tras el reset ---
 * y solo registra el valor si agota el timeout. Es decir: el 0x00 historico
 * puede estar ocurriendo en cada arranque sin dejar rastro. Esta lectura es la
 * que lo delata, y se conserva aunque despues el chip responda 0x04.
 *
 * @return false si aun no se ha tomado.
 */
bool diana_platform_eth_versionr_first(diana_platform *p, uint8_t *out_value,
                                       diana_w5500_version_class *out_class);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_PLATFORM_ESP_H */
