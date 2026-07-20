/**
 * @file config.h
 * @brief Configuracion del modulo, derivada de module-config.schema.json.
 *
 * ATENCION - VALORES PROVISIONALES:
 * Ningun umbral piezoelectrico de este fichero esta calibrado. No hay hardware.
 * Los valores por defecto son un PUNTO DE PARTIDA derivado de los rangos de
 * ensayo del dosier 9.6 (agrupacion 1-3 ms, bloqueo 30-100 ms) y deben medirse
 * en banco antes de cualquier uso real. Ver
 * docs/firmware/validacion-fisica-pendiente.md.
 */
#ifndef DIANA_CONFIG_H
#define DIANA_CONFIG_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/hal.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* --- Valores PROVISIONALES, sin calibrar, a validar en banco --------------
 * Justificacion de cada uno en docs/firmware/validacion-fisica-pendiente.md. */
#define DIANA_DEFAULT_THRESHOLD        900    /* cuentas ADC; INVENTADO, hay que medirlo */
#define DIANA_DEFAULT_HYSTERESIS        80
#define DIANA_DEFAULT_NOISE_FLOOR      140
#define DIANA_DEFAULT_BLANKING_US    60000    /* 60 ms, centro del rango 30-100 ms */
#define DIANA_DEFAULT_GROUP_WINDOW_US 2000    /* 2 ms, centro del rango 1-3 ms */
#define DIANA_DEFAULT_NEIGHBOUR_RATIO 0.35f   /* sin base experimental */
#define DIANA_DEFAULT_BRIGHTNESS_MAX   120    /* limite de potencia, dosier 10.4 */
#define DIANA_DEFAULT_TELEMETRY_MS    1000

typedef struct {
    uint8_t  target_index;      /* 1..9 */
    uint16_t threshold;
    uint16_t hysteresis;
    uint16_t noise_floor;
    uint32_t blanking_us;
    uint32_t group_window_us;
    float    neighbour_ratio;
    bool     enabled;
    bool     has_calibrated_at;
    char     calibrated_at[32]; /* RFC3339, vacio si nunca calibrado */
} diana_target_calibration;

typedef enum { DIANA_NET_DHCP = 0, DIANA_NET_STATIC } diana_net_mode;

typedef struct {
    diana_net_mode mode;
    char ip[16];
    char netmask[16];
    char gateway[16];
} diana_net_config;

typedef struct {
    uint32_t config_version;
    char     system_id[DIANA_ID_MAXLEN];
    bool     has_position;
    int8_t   position_x;        /* -1..1 */
    int8_t   position_y;
    uint16_t rotation;          /* 0, 90, 180, 270 */
    char     friendly_name[65];
    uint8_t  led_brightness_max;
    uint32_t telemetry_interval_ms;
    diana_net_config network;
    diana_target_calibration calibration[DIANA_TARGET_COUNT];
} diana_config;

/** Rellena con los valores provisionales por defecto (NO calibrados). */
void diana_config_defaults(diana_config *cfg);

/** Valida un config contra los limites del contrato. 0 si conforme. */
int diana_config_validate(const diana_config *cfg);

/**
 * Aplica una config recibida. Rechaza (DIANA_HAL_ERR_INVALID) si
 * config_version es menor o igual a la aplicada: el contrato exige monotonia.
 */
int diana_config_apply(diana_config *current, const diana_config *incoming);

/** Persiste / recupera de NVS. */
int diana_config_save(const diana_config *cfg, const diana_hal *hal);
int diana_config_load(diana_config *cfg, const diana_hal *hal);

const diana_target_calibration *diana_config_cal(const diana_config *cfg,
                                                 uint8_t target_index);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_CONFIG_H */
