/**
 * @file queue.h
 * @brief Cola local persistente de eventos no confirmados (dosier 13.5, 14.3).
 *
 * Guarda el evento en forma ESTRUCTURADA, no serializado, para que al reenviar
 * se pueda marcar replay=true sin reescribir JSON ni tocar el event_id: el
 * identificador es estable entre reintentos (ADR-0003) y el reenvio NO es un
 * duplicado.
 *
 * Politica de cola llena: configurable. Por defecto DROP_OLDEST, porque en una
 * partida el impacto reciente vale mas que el antiguo; en ambos casos se emite
 * un diagnostico queue_overflow y se contabiliza. Ninguna politica es silenciosa.
 */
#ifndef DIANA_QUEUE_H
#define DIANA_QUEUE_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/event.h"
#include "diana/hal.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DIANA_QUEUE_DROP_OLDEST = 0, /**< descarta el mas antiguo y encola el nuevo */
    DIANA_QUEUE_REJECT_NEW       /**< conserva el historico y rechaza el nuevo */
} diana_queue_policy;

/** Numero de event_id recordados para deduplicar en el propio modulo. */
#define DIANA_DEDUP_CACHE 64

typedef struct {
    const diana_hal *hal;
    diana_queue_policy policy;
    uint32_t pushed;
    uint32_t dropped;       /* perdidos por cola llena */
    uint32_t replayed;      /* reenviados desde la cola */
    uint32_t duplicates;    /* rechazados por event_id ya visto */
    uint32_t overflow_events;

    char     dedup[DIANA_DEDUP_CACHE][DIANA_EVENTID_LEN];
    uint16_t dedup_next;
    uint16_t dedup_used;
} diana_event_queue;

void diana_queue_init(diana_event_queue *q, const diana_hal *hal,
                      diana_queue_policy policy);

/** Profundidad actual (eventos pendientes de confirmacion). */
size_t diana_queue_depth(const diana_event_queue *q);
size_t diana_queue_capacity(const diana_event_queue *q);

/** true si el event_id ya fue visto por este modulo. */
bool diana_queue_seen(const diana_event_queue *q, const char *event_id);
/** Registra un event_id como visto. */
void diana_queue_remember(diana_event_queue *q, const char *event_id);

/**
 * Encola un evento no confirmado.
 * Devuelve DIANA_HAL_OK, DIANA_HAL_ERR_NO_SPACE (politica REJECT_NEW con cola
 * llena) o DIANA_HAL_ERR_INVALID (event_id repetido: no se duplica).
 * Con DROP_OLDEST y cola llena descarta el frente, incrementa 'dropped' y
 * devuelve DIANA_HAL_OK.
 */
int diana_queue_push(diana_event_queue *q, const diana_hit_event *ev);

/** Lee el evento n-esimo desde el frente sin retirarlo. */
int diana_queue_peek(const diana_event_queue *q, size_t index, diana_hit_event *out);

/** Retira el frente (confirmado). */
int diana_queue_pop(diana_event_queue *q);

/**
 * Reenvia hasta 'max' eventos del frente por MQTT marcando replay=true.
 * Solo retira un evento cuando la publicacion se acepta. Si no hay conexion se
 * detiene y deja la cola intacta.
 * Devuelve el numero de eventos reenviados con exito.
 */
int diana_queue_flush(diana_event_queue *q, const char *topic, size_t max);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_QUEUE_H */
