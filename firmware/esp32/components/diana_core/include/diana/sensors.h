/**
 * @file sensors.h
 * @brief Pipeline de sensores de impacto.
 *
 * Flujo:
 *   1. El comparador de cada canal genera un flanco -> ISR -> se registra
 *      (canal, t_us) con el reloj monotonico. Eso es T1 del ADR-0002.
 *   2. Se lee la amplitud de envolvente del canal por multiplexor (o ADC
 *      externo: la interfaz del HAL es la misma).
 *   3. Se agrupan los disparos dentro de group_window_us.
 *   4. Se elige el canal principal (mayor amplitud) y se comparan los vecinos:
 *      un vecino con amplitud < neighbour_ratio * principal se descarta como
 *      vibracion cruzada (classification crosstalk_rejected).
 *   5. Tras un impacto valido se aplica blanking_us al canal.
 *
 * ATENCION: los umbrales son PROVISIONALES y no estan calibrados (no hay
 * hardware). Ver diana/config.h y docs/firmware/validacion-fisica-pendiente.md.
 *
 * El prototipo fisico actual usa DO-only sobre 2 x 74HC165. La ruta analogica
 * se conserva para la PCB futura, pero el perfil DIANA_BOARD_PROTO_DO_W5500 no
 * depende de ADC ni de amplitud.
 */
#ifndef DIANA_SENSORS_H
#define DIANA_SENSORS_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/config.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Un disparo crudo del comparador, ya con amplitud leida. */
typedef struct {
    uint8_t  target_index;   /* 1..9 */
    uint64_t t_us;           /* reloj monotonico local, T1 */
    uint16_t amplitude;      /* cuentas crudas del ADC */
} diana_piezo_trigger;

typedef struct {
    uint8_t  target_index;
    uint16_t amplitude;
    int32_t  delta_us;       /* t_vecino - t_principal, con signo */
} diana_neighbour;

/** Resultado de clasificar un grupo de disparos. */
typedef struct {
    bool     accepted;                    /* true si hay un impacto principal */
    uint8_t  target_index;                /* canal principal */
    uint64_t t_us;
    uint16_t amplitude;
    uint16_t threshold;
    uint16_t noise_floor;
    bool     has_amplitude;
    bool     has_threshold;
    bool     has_noise_floor;
    uint16_t raw_bitmap;                    /* snapshot HC165 crudo, DO-only */
    uint16_t active_bitmap;                 /* bit 0=D1 ... bit 8=D9 */
    uint8_t  active_count;
    diana_hit_classification classification;
    char     reason[DIANA_REASON_MAXLEN]; /* vacio solo si valid_hit */
    diana_neighbour neighbours[DIANA_MAX_NEIGHBOURS];
    uint8_t  neighbour_count;
    /* Canales descartados como vibracion cruzada, para diagnostico. */
    uint8_t  rejected_index[DIANA_MAX_NEIGHBOURS];
    char     rejected_reason[DIANA_MAX_NEIGHBOURS][DIANA_REASON_MAXLEN];
    uint8_t  rejected_count;
} diana_hit_group;

/** Estado por canal: antirrebote y blanking. */
typedef struct {
    uint64_t blanking_until_us[DIANA_TARGET_COUNT];
    uint64_t last_trigger_us[DIANA_TARGET_COUNT];
    uint32_t suppressed_debounce[DIANA_TARGET_COUNT];
    uint32_t suppressed_blanking[DIANA_TARGET_COUNT];
    uint16_t do_last_active_bitmap;
} diana_sensor_state;

typedef enum {
    DIANA_DO_ACTIVE_HIGH = 0,
    DIANA_DO_ACTIVE_LOW
} diana_do_polarity;

typedef enum {
    DIANA_SELECTOR_2_POSITION = 0,
    DIANA_SELECTOR_3_POSITION
} diana_selector_profile;

typedef struct {
    uint16_t raw_bitmap;
    uint16_t active_bitmap;
    uint8_t active_count;
    uint8_t active_channels[DIANA_TARGET_COUNT]; /* valores 1..9 */
} diana_do_snapshot;

void diana_sensor_state_init(diana_sensor_state *st);

/**
 * Filtro de admision de un disparo crudo, previo a la agrupacion.
 * Rechaza si: canal deshabilitado, amplitud por debajo del umbral+histeresis,
 * canal en blanking, o rebote dentro de la ventana de agrupacion del canal.
 * Devuelve true si el disparo debe entrar en el grupo.
 */
bool diana_sensor_admit(diana_sensor_state *st, const diana_config *cfg,
                        const diana_piezo_trigger *trig, const char **why);

/**
 * Clasifica un grupo de disparos admitidos, ya ordenado o no, capturados dentro
 * de la ventana de agrupacion. Rellena 'out'.
 *
 * Reglas (dosier 9.6):
 *   - canal principal = mayor amplitud; empate = el mas temprano.
 *   - vecino con amplitud < neighbour_ratio * amplitud_principal -> descartado
 *     como crosstalk_rejected, con motivo legible.
 *   - vecino por encima del ratio -> el grupo es AMBIGUO: dos impactos reales
 *     simultaneos no se pueden distinguir de una transmision mecanica fuerte.
 *     Se emite classification 'ambiguous' y se registra diagnostico.
 */
void diana_sensor_classify(const diana_config *cfg,
                           const diana_piezo_trigger *trigs, uint8_t count,
                           diana_hit_group *out);

/** Marca el blanking del canal tras aceptar un impacto valido. */
void diana_sensor_mark_hit(diana_sensor_state *st, const diana_config *cfg,
                           uint8_t target_index, uint64_t now_us);

uint16_t diana_do_active_bitmap(uint16_t raw_bitmap, diana_do_polarity polarity);
void diana_do_decode(uint16_t raw_bitmap, diana_do_polarity polarity,
                     diana_do_snapshot *out);

/**
 * Clasifica un snapshot DO-only del 74HC165.
 *
 * Reglas del prototipo:
 *   - bit 0=D1 ... bit 8=D9; bits 9..15 se ignoran.
 *   - 0 bits activos: no hay impacto.
 *   - 1 bit activo: transicion candidata, con debounce/refractory por canal.
 *   - >1 bits activos: MULTI_TRIGGER diagnostico/no puntuable. No se elige un
 *     canal arbitrario.
 */
void diana_do_process_snapshot(diana_sensor_state *st, const diana_config *cfg,
                               uint16_t raw_bitmap, diana_do_polarity polarity,
                               uint64_t now_us, diana_hit_group *out);

int diana_selector_decode(int gpio15_level, int gpio16_level,
                          diana_selector_profile profile,
                          diana_selector_position *out);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_SENSORS_H */
