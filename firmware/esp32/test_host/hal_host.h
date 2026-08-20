/**
 * @file hal_host.h
 * @brief Implementacion del HAL para PC (gcc), sin ESP-IDF ni hardware.
 *
 * Permite compilar y EJECUTAR toda la logica de negocio del firmware en host:
 *  - reloj virtual controlado por el test (nada de sleeps),
 *  - RNG determinista con semilla (para reproducir fallos),
 *  - NVS simulada en memoria, con "reboot" que conserva el contenido,
 *  - cola FIFO persistente con capacidad configurable,
 *  - broker MQTT falso que registra lo publicado y se puede desconectar,
 *  - piezo, LED, selector, boton y OTA simulados.
 *
 * No pretende emular el hardware: emula el CONTRATO del HAL. Lo que no se puede
 * comprobar asi (temporizacion real de la ISR, ruido del piezo, corriente de los
 * LED) queda listado en docs/firmware/validacion-fisica-pendiente.md.
 */
#ifndef DIANA_HAL_HOST_H
#define DIANA_HAL_HOST_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define HOST_KV_MAX      64
#define HOST_KV_VALMAX   1024
#define HOST_Q_MAX       64
#define HOST_Q_RECMAX    1024
#define HOST_MQTT_MAX    256
#define HOST_MQTT_PAYMAX 3072

typedef struct {
    char   ns[24];
    char   key[24];
    uint8_t val[HOST_KV_VALMAX];
    size_t len;
    bool   used;
} host_kv_entry;

typedef struct {
    uint8_t data[HOST_Q_RECMAX];
    size_t  len;
} host_q_record;

typedef struct {
    char    topic[DIANA_TOPIC_MAXLEN];
    char    payload[HOST_MQTT_PAYMAX];
    size_t  payload_len;
    int     qos;
    bool    retain;
} host_mqtt_record;

/** Almacenamiento que SOBREVIVE a un reinicio simulado. */
typedef struct {
    host_kv_entry kv[HOST_KV_MAX];
    host_q_record q[HOST_Q_MAX];
    size_t q_head, q_count, q_capacity;
} host_persistent;

typedef struct {
    host_persistent *nv;      /* apunta a almacenamiento externo persistente */

    uint64_t now_us;
    uint64_t epoch_ms;
    uint64_t rng_state;

    bool link_up, has_ip;
    char ip[16], mac[18];
    bool mqtt_connected;
    uint32_t mqtt_reconnects;

    host_mqtt_record published[HOST_MQTT_MAX];
    size_t published_count;
    /* LWT registrado en CONNECT: el test comprueba que es el del contrato. */
    char lwt_topic[DIANA_TOPIC_MAXLEN];
    char lwt_payload[HOST_MQTT_PAYMAX];
    int  lwt_qos;
    bool lwt_retain;

    uint16_t piezo_amplitude[DIANA_TARGET_COUNT];
    /* Cuantas veces se ha llamado a hal->piezo_amplitude. Instrumento de la
     * prueba antirregresion: la ruta de impacto DO-only debe dejarlo a CERO
     * incluso con el ADC disponible. */
    uint32_t piezo_reads;
    diana_hal_rgb led[DIANA_LED_CHAINS][DIANA_LEDS_PER_CHAIN];
    int  selector;
    bool button;

    int  reset_reason;
    uint32_t watchdog_feeds;
    uint32_t reboots;

    /* OTA simulada. signature_valid decide el veredicto de la firma: el host NO
     * implementa criptografia real, solo el CAMINO de decision. */
    bool signature_valid;
    bool activate_ok;
    uint32_t activations;
    uint32_t rollbacks;

    diana_hal_health health;
} host_hal_ctx;

/** Inicializa el contexto y la tabla de operaciones. */
void host_hal_init(host_hal_ctx *ctx, host_persistent *nv, diana_hal *hal,
                   uint64_t seed);

/** Almacenamiento persistente limpio. */
void host_persistent_reset(host_persistent *nv, size_t queue_capacity);

/** Avanza el reloj virtual. */
void host_advance_us(host_hal_ctx *ctx, uint64_t us);

/** Simula un reinicio: conserva 'nv', reinicia todo lo demas. */
void host_reboot(host_hal_ctx *ctx, diana_hal *hal, uint64_t seed,
                 int reset_reason);

/** Simula el registro del Last Will en CONNECT. */
void host_mqtt_set_lwt(host_hal_ctx *ctx, const char *topic, const char *payload,
                       int qos, bool retain);

void host_mqtt_set_connected(host_hal_ctx *ctx, bool connected);

/** Ultimo mensaje publicado en un topico, o NULL. */
const host_mqtt_record *host_mqtt_last(const host_hal_ctx *ctx, const char *topic);
size_t host_mqtt_count(const host_hal_ctx *ctx, const char *topic);
void   host_mqtt_clear(host_hal_ctx *ctx);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_HAL_HOST_H */
