/**
 * @file event.h
 * @brief Construccion y serializacion de eventos de impacto (hit-event.schema.json).
 *
 * Modelo temporal ADR-0002: el firmware SOLO rellena el bloque 'device' (T1).
 * El firmware NUNCA escribe received_at ni persisted_at: no existen en el
 * payload.
 *
 * ---------------------------------------------------------------------------
 * DONDE VIAJA T2 (hallazgo H-01 del supervisor)
 * ---------------------------------------------------------------------------
 * NINGUN modulo escribe jamas en el topico de otro modulo. El coordinador, por
 * tanto, NO reescribe el hit de un satelite:
 *
 *   - Detecta un SATELITE  -> publica en module/{suyo}/hit con coordinator=null.
 *                             El coordinador publica T2 aparte, en
 *                             system/{sys}/game/event con kind=target_hit y
 *                             hit_event_id apuntando al hit original.
 *   - Detecta el COORDINADOR -> publica en module/{suyo}/hit con el bloque
 *                             coordinator relleno: es su propio topico y su
 *                             propio T2, asi que va embebido.
 *
 * El guardian diana_hit_event_attach_coordinator() impone esa regla en codigo:
 * se niega a rellenar T2 si el evento no es del propio modulo o si el modulo no
 * es el coordinador. Asi la ACL estricta de Mosquitto es ejecutable.
 *
 * Idempotencia ADR-0003: event_id se genera aqui, en el modulo detector, y es
 * estable entre reintentos. local_sequence viene de la identidad persistida.
 */
#ifndef DIANA_EVENT_H
#define DIANA_EVENT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "diana/identity.h"
#include "diana/sensors.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** T1 · tiempo del dispositivo. common.schema.json#/$defs/deviceTime */
typedef struct {
    char     boot_id[DIANA_UUID_LEN];
    uint64_t uptime_us;
    uint64_t event_us;
    bool     has_epoch_ms;
    uint64_t epoch_ms;
} diana_device_time;

/** T2 · consolidacion del coordinador. Solo lo rellena el principal. */
typedef struct {
    uint64_t recv_us;
    uint64_t elapsed_us;
    int64_t  clock_offset_us;
    bool     has_uncertainty;
    uint64_t offset_uncertainty_us;
} diana_coordinator_time;

typedef struct {
    char     event_id[DIANA_EVENTID_LEN];
    char     system_id[DIANA_ID_MAXLEN];
    char     module_id[DIANA_ID_MAXLEN];
    bool     has_game;
    char     game_id[DIANA_UUID_LEN];
    bool     has_round;
    char     round_id[DIANA_UUID_LEN];
    uint8_t  target_index;
    bool     has_position;
    int8_t   position_x;
    int8_t   position_y;
    bool     has_rotation;
    uint16_t rotation;
    uint64_t local_sequence;
    diana_device_time device;
    bool     has_coordinator;
    diana_coordinator_time coordinator;
    /**
     * ADR-0007 · discriminador del perfil de deteccion. Se hereda del grupo,
     * que a su vez lo estampa la ruta que detecto el impacto.
     */
    diana_detection_method detection_method;
    bool     has_amplitude;
    uint16_t amplitude;
    bool     has_threshold;
    uint16_t threshold;
    bool     has_noise_floor;
    uint16_t noise_floor;
    diana_neighbour neighbours[DIANA_MAX_NEIGHBOURS];
    uint8_t  neighbour_count;
    diana_target_state target_state_before;
    diana_hit_classification classification;
    char     classification_reason[DIANA_REASON_MAXLEN];
    char     firmware_version[DIANA_SEMVER_MAXLEN];
    bool     replay;
} diana_hit_event;

/**
 * ADR-0007 · el evento se declara digital y ademas trae medidas analogicas
 * (amplitud, umbral, suelo de ruido o amplitud de vecino), o al reves. Es una
 * INCOHERENCIA del productor, no un evento mal formado: se distingue de
 * DIANA_HAL_ERR_INVALID a proposito.
 *
 * Rellenar amplitude con 0, con -1 o con el umbral nominal para que un
 * validador se ponga verde esta PROHIBIDO: seria un dato falso.
 */
#define DIANA_ERR_CONTRACT_PROFILE_MISMATCH (-20)

/** Tamano de buffer suficiente para el peor caso de un hit-event. */
#define DIANA_HIT_JSON_MAX 1600

/**
 * Rellena un evento a partir del grupo clasificado. Genera event_id nuevo y
 * consume un local_sequence. 'now_us' es el uptime en el momento de construir;
 * group->t_us es el instante de la interrupcion (event_us).
 */
void diana_hit_event_build(diana_hit_event *ev, const diana_hal *hal,
                           diana_identity *id, const diana_hit_group *group,
                           diana_target_state state_before, uint64_t now_us);

/**
 * Variante para un vecino descartado por vibracion cruzada: mismo grupo, otro
 * canal, classification crosstalk_rejected con motivo obligatorio.
 * 'nth' es el indice dentro de group->rejected_*.
 */
bool diana_hit_event_build_rejected(diana_hit_event *ev, const diana_hal *hal,
                                    diana_identity *id,
                                    const diana_hit_group *group, uint8_t nth,
                                    diana_target_state state_before,
                                    uint64_t now_us);

/**
 * Adjunta T2 al evento. SOLO es legitimo cuando el modulo que detecto el
 * impacto es el propio coordinador (hallazgo H-01).
 *
 * Devuelve false —y no toca el evento— si:
 *   - el modulo no tiene rol principal, o
 *   - el evento pertenece a otro module_id.
 *
 * Para el impacto de un satelite, el coordinador NO llama a esto: publica T2 en
 * system/{sys}/game/event mediante diana_game_event_target_hit().
 */
bool diana_hit_event_attach_coordinator(diana_hit_event *ev,
                                        diana_module_role own_role,
                                        const char *own_module_id,
                                        const diana_coordinator_time *t2);

/**
 * Serializa a JSON conforme a hit-event.schema.json.
 * Devuelve la longitud escrita, o 0 si no cabe (nunca trunca en silencio).
 */
size_t diana_hit_event_to_json(const diana_hit_event *ev, char *buf, size_t cap);

/**
 * ADR-0007 · true si el evento es COHERENTE con su perfil de deteccion:
 *   analog_envelope   -> amplitude y threshold presentes, y todo vecino con
 *                        amplitud (has_neighbour_amplitude).
 *   digital_threshold -> amplitude, threshold, noise_floor y amplitud de
 *                        vecino AUSENTES.
 * El serializador se niega a producir JSON si esto es false, para que un
 * payload incoherente no pueda llegar a existir.
 */
bool diana_hit_event_profile_coherent(const diana_hit_event *ev);

/**
 * Comprobacion local previa a publicar: verifica los invariantes que el
 * esquema exige y que el firmware puede romper por error de programacion
 * (event_id valido, identificadores validos, motivo obligatorio si la
 * clasificacion no es valid_hit, target_index en 1..9).
 * 0 si conforme, negativo si no. Un evento no conforme NO se publica.
 */
int diana_hit_event_check(const diana_hit_event *ev);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_EVENT_H */
