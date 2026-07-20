#include "diana/queue.h"

#include <string.h>

void diana_queue_init(diana_event_queue *q, const diana_hal *hal,
                      diana_queue_policy policy)
{
    memset(q, 0, sizeof(*q));
    q->hal = hal;
    q->policy = policy;
}

size_t diana_queue_depth(const diana_event_queue *q)
{
    if (!q->hal || !q->hal->q_count) return 0;
    return q->hal->q_count(q->hal->ctx);
}

size_t diana_queue_capacity(const diana_event_queue *q)
{
    if (!q->hal || !q->hal->q_capacity) return 0;
    return q->hal->q_capacity(q->hal->ctx);
}

bool diana_queue_seen(const diana_event_queue *q, const char *event_id)
{
    if (!event_id || !event_id[0]) return false;
    for (uint16_t i = 0; i < q->dedup_used; ++i) {
        if (strcmp(q->dedup[i], event_id) == 0) return true;
    }
    return false;
}

void diana_queue_remember(diana_event_queue *q, const char *event_id)
{
    if (!event_id || !event_id[0]) return;
    size_t n = strlen(event_id);
    if (n >= DIANA_EVENTID_LEN) n = DIANA_EVENTID_LEN - 1;
    memcpy(q->dedup[q->dedup_next], event_id, n);
    q->dedup[q->dedup_next][n] = '\0';
    q->dedup_next = (uint16_t)((q->dedup_next + 1) % DIANA_DEDUP_CACHE);
    if (q->dedup_used < DIANA_DEDUP_CACHE) q->dedup_used++;
}

int diana_queue_push(diana_event_queue *q, const diana_hit_event *ev)
{
    if (!q->hal || !q->hal->q_push) return DIANA_HAL_ERR_GENERIC;

    if (diana_queue_seen(q, ev->event_id)) {
        q->duplicates++;
        return DIANA_HAL_ERR_INVALID;
    }

    int rc = q->hal->q_push(q->hal->ctx, ev, sizeof(*ev));
    if (rc == DIANA_HAL_ERR_NO_SPACE) {
        q->overflow_events++;
        if (q->policy == DIANA_QUEUE_REJECT_NEW) return DIANA_HAL_ERR_NO_SPACE;
        /* DROP_OLDEST: hace sitio retirando el frente. */
        if (!q->hal->q_pop) return DIANA_HAL_ERR_NO_SPACE;
        if (q->hal->q_pop(q->hal->ctx) != DIANA_HAL_OK)
            return DIANA_HAL_ERR_NO_SPACE;
        q->dropped++;
        rc = q->hal->q_push(q->hal->ctx, ev, sizeof(*ev));
    }
    if (rc != DIANA_HAL_OK) return rc;

    q->pushed++;
    diana_queue_remember(q, ev->event_id);
    return DIANA_HAL_OK;
}

int diana_queue_peek(const diana_event_queue *q, size_t index,
                     diana_hit_event *out)
{
    size_t len = 0;
    if (!q->hal || !q->hal->q_peek) return DIANA_HAL_ERR_GENERIC;
    int rc = q->hal->q_peek(q->hal->ctx, index, out, sizeof(*out), &len);
    if (rc != DIANA_HAL_OK) return rc;
    if (len != sizeof(*out)) return DIANA_HAL_ERR_GENERIC;
    return DIANA_HAL_OK;
}

int diana_queue_pop(diana_event_queue *q)
{
    if (!q->hal || !q->hal->q_pop) return DIANA_HAL_ERR_GENERIC;
    return q->hal->q_pop(q->hal->ctx);
}

int diana_queue_flush(diana_event_queue *q, const char *topic, size_t max)
{
    if (!q->hal || !q->hal->mqtt_publish) return 0;
    int sent = 0;

    for (size_t i = 0; i < max; ++i) {
        if (diana_queue_depth(q) == 0) break;
        if (q->hal->mqtt_connected && !q->hal->mqtt_connected(q->hal->ctx)) break;

        diana_hit_event ev;
        if (diana_queue_peek(q, 0, &ev) != DIANA_HAL_OK) break;

        /* Marca de reenvio: NO implica duplicado (ADR-0003). */
        ev.replay = true;

        char json[DIANA_HIT_JSON_MAX];
        size_t n = diana_hit_event_to_json(&ev, json, sizeof(json));
        if (n == 0) {
            /* Evento imposible de serializar: se retira para no bloquear la
             * cola, pero queda contabilizado como descartado. */
            diana_queue_pop(q);
            q->dropped++;
            continue;
        }

        diana_hal_mqtt_msg msg = {
            .topic = topic,
            .payload = json,
            .payload_len = n,
            .qos = 1,
            .retain = false, /* los eventos NUNCA se retienen */
        };
        if (q->hal->mqtt_publish(q->hal->ctx, &msg) < 0) break;

        diana_queue_pop(q);
        q->replayed++;
        sent++;
    }
    return sent;
}
