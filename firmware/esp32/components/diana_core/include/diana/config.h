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
#include <stddef.h>
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
 * Veredicto de RECONCILIACION de versiones. Espejo exacto de
 * `decideConfigVersion()` en server/backend/src/domain/modules/config-version.ts.
 *
 * Es una comparacion de ENTEROS y nada mas. El reloj NO es autoridad de orden:
 * ni `calibrated_at`, ni la hora de pared, ni el instante de recepcion
 * intervienen en esta decision. Un modulo cuyo NTP no ha sincronizado todavia
 * tiene que reconciliar igual.
 */
typedef enum {
    DIANA_CFG_APPLY  = 0,   /**< remota > local  -> se aplica          */
    DIANA_CFG_NOOP   = 1,   /**< remota == local -> ya aplicada, nada  */
    DIANA_CFG_REJECT = 2,   /**< remota <  local -> retroceso, rechazo */
} diana_config_decision;

/** remota vs local. Sin efectos, sin reloj, sin excepciones. */
diana_config_decision diana_config_decide(uint32_t remote, uint32_t local);

/**
 * Aplica una config recibida SI `diana_config_decide()` dice APPLY y la config
 * es valida. Devuelve DIANA_HAL_OK si `*current` cambio; DIANA_HAL_ERR_INVALID
 * en cualquier otro caso (noop, retroceso o config no conforme).
 *
 * Para distinguir un NOOP de un RECHAZO --que el contrato trata distinto-- hay
 * que llamar antes a diana_config_decide(). `diana_config_apply` es la accion,
 * no el diagnostico.
 */
int diana_config_apply(diana_config *current, const diana_config *incoming);

/**
 * Deserializa un payload `module-config.schema.json` (config/desired) a
 * `diana_config`.
 *
 * VIVE EN diana_core, NO en main/ con cJSON, por la misma razon que
 * prov_parse.c: `main/app_commands.c` no se compila en la suite de host, asi
 * que nada parseado alli puede probarse sin hardware. Aqui, el camino
 * payload -> struct -> decision -> aplicacion se ejercita entero en host.
 *
 * `base` es la configuracion sobre la que se aplica el payload: los campos que
 * el mensaje NO trae conservan su valor actual (el esquema los declara
 * opcionales), y los canales de calibracion que no vengan en el array se
 * quedan como estaban. `base` puede ser NULL, y entonces se parte de
 * diana_config_defaults().
 *
 * FALLO CERRADO: cualquier error de sintaxis, un `config_version` ausente o un
 * `target_index` fuera de 1..DIANA_TARGET_COUNT devuelven false y `out` queda
 * SIN USAR. No existe ningun camino en el que un parseo a medias produzca una
 * configuracion aplicable.
 */
bool diana_config_parse(const char *payload, size_t len,
                        const diana_config *base, diana_config *out);

/** Persiste / recupera de NVS. */
int diana_config_save(const diana_config *cfg, const diana_hal *hal);
int diana_config_load(diana_config *cfg, const diana_hal *hal);

const diana_target_calibration *diana_config_cal(const diana_config *cfg,
                                                 uint8_t target_index);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_CONFIG_H */
