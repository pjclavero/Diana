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
 * @param client_id  DEBE ser igual al module_id, sin prefijo: la ACL de
 *                   Mosquitto usa el patron %c para acotar cada modulo a su
 *                   propio subarbol (contrato §8).
 * @param user       usuario MQTT, 'module-{module_id}' (contrato §8).
 */
int diana_platform_mqtt_start(diana_platform *p, const char *client_id,
                              const char *uri, const char *user, const char *pass,
                              const char *lwt_topic, const char *lwt_payload);

/** Suscribe a los topicos de entrada del modulo (command, config, ota, game). */
int diana_platform_mqtt_subscribe(diana_platform *p, const char *module_id);

/** Cola de mensajes MQTT recibidos, para consumir desde la tarea principal. */
typedef struct {
    char topic[DIANA_TOPIC_MAXLEN];
    char payload[2048];
    size_t payload_len;
    uint64_t recv_us;   /* reloj MONOTONICO de recepcion: base de la caducidad */
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

#ifdef __cplusplus
}
#endif
#endif /* DIANA_PLATFORM_ESP_H */
