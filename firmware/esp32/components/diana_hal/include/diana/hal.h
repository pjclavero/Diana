/**
 * @file hal.h
 * @brief Capa de abstraccion de hardware de Diana.
 *
 * TODA la logica de negocio (diana_core) depende solo de esta interfaz, nunca de
 * ESP-IDF. Existen dos implementaciones:
 *   - diana_platform_esp : real, sobre ESP-IDF (ESP32-S3 + W5500).
 *   - test_host/hal_host : simulacion en PC, permite compilar y ejecutar la
 *                          logica con gcc sin hardware ni toolchain de Espressif.
 *
 * Convenciones:
 *   - Todos los tiempos en microsegundos monotonicos (no epoch).
 *   - Todas las funciones devuelven 0 en exito y negativo en error salvo que se
 *     indique lo contrario.
 */
#ifndef DIANA_HAL_H
#define DIANA_HAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define DIANA_HAL_OK             0
#define DIANA_HAL_ERR_GENERIC   -1
#define DIANA_HAL_ERR_NOT_FOUND -2
#define DIANA_HAL_ERR_NO_SPACE  -3
#define DIANA_HAL_ERR_INVALID   -4

/* ------------------------------------------------------------------ tiempo */

/** Reloj monotonico local en microsegundos. Nunca retrocede, no es epoch. */
typedef uint64_t (*diana_hal_now_us_fn)(void *ctx);

/** Hora de pared en ms desde epoch, o 0 si el modulo no la ha sincronizado. */
typedef uint64_t (*diana_hal_epoch_ms_fn)(void *ctx);

/* ------------------------------------------------------------- aleatoriedad */

/** Rellena buf con len bytes aleatorios (hardware RNG en ESP32). */
typedef void (*diana_hal_random_fn)(void *ctx, uint8_t *buf, size_t len);

/* ------------------------------------------------- almacenamiento clave-valor
 * En ESP32 lo implementa NVS. Guarda identidad, config, calibracion y
 * local_sequence. */

typedef int (*diana_hal_kv_get_fn)(void *ctx, const char *ns, const char *key,
                                   void *out, size_t out_size, size_t *out_len);
typedef int (*diana_hal_kv_set_fn)(void *ctx, const char *ns, const char *key,
                                   const void *data, size_t len);
typedef int (*diana_hal_kv_erase_fn)(void *ctx, const char *ns, const char *key);

/* ----------------------------------------------- almacenamiento de cola (FIFO)
 * En ESP32 lo implementa la particion 'evtqueue'. Registros opacos de longitud
 * variable, orden FIFO, con confirmacion explicita del frente. */

/** Anade un registro al final. DIANA_HAL_ERR_NO_SPACE si la cola esta llena. */
typedef int (*diana_hal_q_push_fn)(void *ctx, const void *data, size_t len);
/** Lee el registro n-esimo desde el frente sin retirarlo (0 = frente). */
typedef int (*diana_hal_q_peek_fn)(void *ctx, size_t index, void *out,
                                   size_t out_size, size_t *out_len);
/** Retira el registro del frente (confirmado por el broker). */
typedef int (*diana_hal_q_pop_fn)(void *ctx);
/** Numero de registros pendientes. */
typedef size_t (*diana_hal_q_count_fn)(void *ctx);
/** Capacidad maxima en registros. */
typedef size_t (*diana_hal_q_capacity_fn)(void *ctx);

/* -------------------------------------------------------------------- red */

typedef struct {
    bool link_up;      /**< enlace fisico W5500 detectado */
    bool has_ip;       /**< DHCP concedido o IP estatica aplicada */
    char ip[16];
    char mac[18];      /**< formato AA:BB:CC:DD:EE:FF, mayusculas */
} diana_hal_net_status;

typedef int (*diana_hal_net_status_fn)(void *ctx, diana_hal_net_status *out);
typedef int (*diana_hal_net_reconnect_fn)(void *ctx);

/* ------------------------------------------------------------------- MQTT */

typedef struct {
    const char *topic;
    const void *payload;
    size_t payload_len;
    int qos;
    bool retain;
} diana_hal_mqtt_msg;

/** Devuelve >=0 (id del mensaje) si se ha entregado al cliente, negativo si no
 *  hay conexion. Un negativo hace que el core encole el evento. */
typedef int (*diana_hal_mqtt_publish_fn)(void *ctx, const diana_hal_mqtt_msg *msg);
typedef bool (*diana_hal_mqtt_connected_fn)(void *ctx);

/* ------------------------------------------------------------------ piezo */

/** Lee la amplitud de envolvente del canal (0..8) a traves del multiplexor.
 *  Interfaz sustituible por un ADC externo SPI sin tocar el core. */
typedef int (*diana_hal_piezo_amplitude_fn)(void *ctx, uint8_t channel,
                                            uint16_t *out_counts);

/* -------------------------------------------------------------------- LED */

typedef struct {
    uint8_t r, g, b;
} diana_hal_rgb;

/** Escribe el buffer completo de una cadena (0..2) de 24 LED. */
typedef int (*diana_hal_led_write_fn)(void *ctx, uint8_t chain,
                                      const diana_hal_rgb *pixels, size_t count);

/* ----------------------------------------------------------------- entradas */

typedef int (*diana_hal_selector_read_fn)(void *ctx, int *out_position); /* 0=SAT 1=AUTO 2=PRINCIPAL */
typedef bool (*diana_hal_button_pressed_fn)(void *ctx);

/* ------------------------------------------------------------- diagnostico */

typedef int (*diana_hal_reset_reason_fn)(void *ctx);   /* diana_reset_reason */
typedef int (*diana_hal_watchdog_feed_fn)(void *ctx);
typedef int (*diana_hal_reboot_fn)(void *ctx);

typedef struct {
    uint32_t free_heap_bytes;
    uint32_t min_free_heap_bytes;
    float cpu_load_pct;
    bool has_temperature;
    float temperature_c;
    bool has_voltage;
    uint32_t voltage_5v_mv;
    uint32_t voltage_12v_mv;
} diana_hal_health;

typedef int (*diana_hal_health_fn)(void *ctx, diana_hal_health *out);

/* -------------------------------------------------------------------- OTA */

/** Verifica la firma del binario ya descargado en la particion inactiva.
 *  En ESP32 delega en el esquema de firma de ESP-IDF (secure boot / signed app).
 *  Devuelve 0 si la firma es valida. El core NUNCA activa sin este 0. */
typedef int (*diana_hal_ota_verify_signature_fn)(void *ctx, const uint8_t *image,
                                                 size_t len, const char *signature_b64);
/** Marca la particion inactiva como arrancable. */
typedef int (*diana_hal_ota_activate_fn)(void *ctx);
/** Vuelve a la particion anterior. */
typedef int (*diana_hal_ota_rollback_fn)(void *ctx);

/* --------------------------------------------------------------- registro */

typedef void (*diana_hal_log_fn)(void *ctx, int level, const char *tag, const char *msg);

/**
 * Tabla de operaciones. El core recibe un puntero const a esta estructura.
 * Cualquier puntero puede ser NULL: el core comprueba antes de llamar y degrada
 * la funcionalidad correspondiente en vez de fallar.
 */
typedef struct {
    void *ctx;

    diana_hal_now_us_fn                now_us;
    diana_hal_epoch_ms_fn              epoch_ms;
    diana_hal_random_fn                random_bytes;

    diana_hal_kv_get_fn                kv_get;
    diana_hal_kv_set_fn                kv_set;
    diana_hal_kv_erase_fn              kv_erase;

    diana_hal_q_push_fn                q_push;
    diana_hal_q_peek_fn                q_peek;
    diana_hal_q_pop_fn                 q_pop;
    diana_hal_q_count_fn               q_count;
    diana_hal_q_capacity_fn            q_capacity;

    diana_hal_net_status_fn            net_status;
    diana_hal_net_reconnect_fn         net_reconnect;

    diana_hal_mqtt_publish_fn          mqtt_publish;
    diana_hal_mqtt_connected_fn        mqtt_connected;

    diana_hal_piezo_amplitude_fn       piezo_amplitude;
    diana_hal_led_write_fn             led_write;

    diana_hal_selector_read_fn         selector_read;
    diana_hal_button_pressed_fn        button_pressed;

    diana_hal_reset_reason_fn          reset_reason;
    diana_hal_watchdog_feed_fn         watchdog_feed;
    diana_hal_reboot_fn                reboot;
    diana_hal_health_fn                health;

    diana_hal_ota_verify_signature_fn  ota_verify_signature;
    diana_hal_ota_activate_fn          ota_activate;
    diana_hal_ota_rollback_fn          ota_rollback;

    diana_hal_log_fn                   log;
} diana_hal;

#ifdef __cplusplus
}
#endif
#endif /* DIANA_HAL_H */
