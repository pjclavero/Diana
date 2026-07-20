#include "hal_host.h"

#include <stdio.h>
#include <string.h>

#include "diana/types.h"

/* ------------------------------------------------------------------ tiempo */

static uint64_t h_now_us(void *c) { return ((host_hal_ctx *)c)->now_us; }
static uint64_t h_epoch_ms(void *c) { return ((host_hal_ctx *)c)->epoch_ms; }

/* --------------------------------------------------------------------- rng */

static void h_random(void *c, uint8_t *buf, size_t len)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    for (size_t i = 0; i < len; ++i) {
        /* xorshift64*: determinista, reproducible con la misma semilla. */
        ctx->rng_state ^= ctx->rng_state >> 12;
        ctx->rng_state ^= ctx->rng_state << 25;
        ctx->rng_state ^= ctx->rng_state >> 27;
        buf[i] = (uint8_t)((ctx->rng_state * 0x2545F4914F6CDD1DULL) >> 33);
    }
}

/* ---------------------------------------------------------------------- kv */

static host_kv_entry *kv_find(host_persistent *nv, const char *ns, const char *key)
{
    for (int i = 0; i < HOST_KV_MAX; ++i) {
        if (nv->kv[i].used && strcmp(nv->kv[i].ns, ns) == 0 &&
            strcmp(nv->kv[i].key, key) == 0)
            return &nv->kv[i];
    }
    return NULL;
}

static int h_kv_get(void *c, const char *ns, const char *key, void *out,
                    size_t out_size, size_t *out_len)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    host_kv_entry *e = kv_find(ctx->nv, ns, key);
    if (!e) return DIANA_HAL_ERR_NOT_FOUND;
    if (e->len > out_size) return DIANA_HAL_ERR_NO_SPACE;
    memcpy(out, e->val, e->len);
    if (out_len) *out_len = e->len;
    return DIANA_HAL_OK;
}

static int h_kv_set(void *c, const char *ns, const char *key, const void *data,
                    size_t len)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    if (len > HOST_KV_VALMAX) return DIANA_HAL_ERR_NO_SPACE;
    host_kv_entry *e = kv_find(ctx->nv, ns, key);
    if (!e) {
        for (int i = 0; i < HOST_KV_MAX; ++i) {
            if (!ctx->nv->kv[i].used) { e = &ctx->nv->kv[i]; break; }
        }
        if (!e) return DIANA_HAL_ERR_NO_SPACE;
        e->used = true;
        snprintf(e->ns, sizeof(e->ns), "%s", ns);
        snprintf(e->key, sizeof(e->key), "%s", key);
    }
    memcpy(e->val, data, len);
    e->len = len;
    return DIANA_HAL_OK;
}

static int h_kv_erase(void *c, const char *ns, const char *key)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    host_kv_entry *e = kv_find(ctx->nv, ns, key);
    if (!e) return DIANA_HAL_ERR_NOT_FOUND;
    e->used = false;
    return DIANA_HAL_OK;
}

/* -------------------------------------------------------------------- cola */

static int h_q_push(void *c, const void *data, size_t len)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    host_persistent *nv = ctx->nv;
    if (len > HOST_Q_RECMAX) return DIANA_HAL_ERR_NO_SPACE;
    if (nv->q_count >= nv->q_capacity) return DIANA_HAL_ERR_NO_SPACE;
    size_t slot = (nv->q_head + nv->q_count) % nv->q_capacity;
    memcpy(nv->q[slot].data, data, len);
    nv->q[slot].len = len;
    nv->q_count++;
    return DIANA_HAL_OK;
}

static int h_q_peek(void *c, size_t index, void *out, size_t out_size,
                    size_t *out_len)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    host_persistent *nv = ctx->nv;
    if (index >= nv->q_count) return DIANA_HAL_ERR_NOT_FOUND;
    size_t slot = (nv->q_head + index) % nv->q_capacity;
    if (nv->q[slot].len > out_size) return DIANA_HAL_ERR_NO_SPACE;
    memcpy(out, nv->q[slot].data, nv->q[slot].len);
    if (out_len) *out_len = nv->q[slot].len;
    return DIANA_HAL_OK;
}

static int h_q_pop(void *c)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    host_persistent *nv = ctx->nv;
    if (nv->q_count == 0) return DIANA_HAL_ERR_NOT_FOUND;
    nv->q_head = (nv->q_head + 1) % nv->q_capacity;
    nv->q_count--;
    return DIANA_HAL_OK;
}

static size_t h_q_count(void *c) { return ((host_hal_ctx *)c)->nv->q_count; }
static size_t h_q_capacity(void *c) { return ((host_hal_ctx *)c)->nv->q_capacity; }

/* --------------------------------------------------------------------- red */

static int h_net_status(void *c, diana_hal_net_status *out)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    out->link_up = ctx->link_up;
    out->has_ip = ctx->has_ip;
    snprintf(out->ip, sizeof(out->ip), "%s", ctx->ip);
    snprintf(out->mac, sizeof(out->mac), "%s", ctx->mac);
    return DIANA_HAL_OK;
}

static int h_net_reconnect(void *c)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    ctx->link_up = true;
    ctx->has_ip = true;
    return DIANA_HAL_OK;
}

/* -------------------------------------------------------------------- mqtt */

static int h_mqtt_publish(void *c, const diana_hal_mqtt_msg *msg)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    if (!ctx->mqtt_connected) return DIANA_HAL_ERR_GENERIC;
    if (ctx->published_count >= HOST_MQTT_MAX) return DIANA_HAL_ERR_NO_SPACE;
    if (msg->payload_len >= HOST_MQTT_PAYMAX) return DIANA_HAL_ERR_NO_SPACE;

    host_mqtt_record *r = &ctx->published[ctx->published_count++];
    snprintf(r->topic, sizeof(r->topic), "%s", msg->topic);
    memcpy(r->payload, msg->payload, msg->payload_len);
    r->payload[msg->payload_len] = '\0';
    r->payload_len = msg->payload_len;
    r->qos = msg->qos;
    r->retain = msg->retain;
    return (int)ctx->published_count;
}

static bool h_mqtt_connected(void *c) { return ((host_hal_ctx *)c)->mqtt_connected; }

/* ------------------------------------------------------------------- piezo */

static int h_piezo(void *c, uint8_t channel, uint16_t *out)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    if (channel >= DIANA_TARGET_COUNT) return DIANA_HAL_ERR_INVALID;
    *out = ctx->piezo_amplitude[channel];
    return DIANA_HAL_OK;
}

/* --------------------------------------------------------------------- led */

static int h_led_write(void *c, uint8_t chain, const diana_hal_rgb *px, size_t n)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    if (chain >= DIANA_LED_CHAINS) return DIANA_HAL_ERR_INVALID;
    if (n > DIANA_LEDS_PER_CHAIN) n = DIANA_LEDS_PER_CHAIN;
    memcpy(ctx->led[chain], px, n * sizeof(diana_hal_rgb));
    return DIANA_HAL_OK;
}

/* ---------------------------------------------------------------- entradas */

static int h_selector(void *c, int *out)
{
    *out = ((host_hal_ctx *)c)->selector;
    return DIANA_HAL_OK;
}
static bool h_button(void *c) { return ((host_hal_ctx *)c)->button; }

/* ------------------------------------------------------------- diagnostico */

static int h_reset_reason(void *c) { return ((host_hal_ctx *)c)->reset_reason; }

static int h_watchdog(void *c)
{
    ((host_hal_ctx *)c)->watchdog_feeds++;
    return DIANA_HAL_OK;
}

static int h_reboot(void *c)
{
    ((host_hal_ctx *)c)->reboots++;
    return DIANA_HAL_OK;
}

static int h_health(void *c, diana_hal_health *out)
{
    *out = ((host_hal_ctx *)c)->health;
    return DIANA_HAL_OK;
}

/* --------------------------------------------------------------------- ota */

static int h_ota_verify(void *c, const uint8_t *image, size_t len,
                        const char *sig)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    (void)image; (void)len;
    if (!sig || !sig[0]) return DIANA_HAL_ERR_INVALID;
    return ctx->signature_valid ? DIANA_HAL_OK : DIANA_HAL_ERR_INVALID;
}

static int h_ota_activate(void *c)
{
    host_hal_ctx *ctx = (host_hal_ctx *)c;
    if (!ctx->activate_ok) return DIANA_HAL_ERR_GENERIC;
    ctx->activations++;
    return DIANA_HAL_OK;
}

static int h_ota_rollback(void *c)
{
    ((host_hal_ctx *)c)->rollbacks++;
    return DIANA_HAL_OK;
}

static void h_log(void *c, int level, const char *tag, const char *msg)
{
    (void)c; (void)level; (void)tag; (void)msg;
}

/* ------------------------------------------------------------------- setup */

void host_persistent_reset(host_persistent *nv, size_t queue_capacity)
{
    memset(nv, 0, sizeof(*nv));
    if (queue_capacity == 0 || queue_capacity > HOST_Q_MAX)
        queue_capacity = HOST_Q_MAX;
    nv->q_capacity = queue_capacity;
}

static void wire(host_hal_ctx *ctx, diana_hal *hal)
{
    memset(hal, 0, sizeof(*hal));
    hal->ctx = ctx;
    hal->now_us = h_now_us;
    hal->epoch_ms = h_epoch_ms;
    hal->random_bytes = h_random;
    hal->kv_get = h_kv_get;
    hal->kv_set = h_kv_set;
    hal->kv_erase = h_kv_erase;
    hal->q_push = h_q_push;
    hal->q_peek = h_q_peek;
    hal->q_pop = h_q_pop;
    hal->q_count = h_q_count;
    hal->q_capacity = h_q_capacity;
    hal->net_status = h_net_status;
    hal->net_reconnect = h_net_reconnect;
    hal->mqtt_publish = h_mqtt_publish;
    hal->mqtt_connected = h_mqtt_connected;
    hal->piezo_amplitude = h_piezo;
    hal->led_write = h_led_write;
    hal->selector_read = h_selector;
    hal->button_pressed = h_button;
    hal->reset_reason = h_reset_reason;
    hal->watchdog_feed = h_watchdog;
    hal->reboot = h_reboot;
    hal->health = h_health;
    hal->ota_verify_signature = h_ota_verify;
    hal->ota_activate = h_ota_activate;
    hal->ota_rollback = h_ota_rollback;
    hal->log = h_log;
}

void host_hal_init(host_hal_ctx *ctx, host_persistent *nv, diana_hal *hal,
                   uint64_t seed)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->nv = nv;
    ctx->now_us = 1000000;
    ctx->epoch_ms = 0;
    ctx->rng_state = seed ? seed : 0x123456789ABCDEFULL;
    ctx->link_up = false;
    ctx->has_ip = false;
    ctx->mqtt_connected = false;
    snprintf(ctx->mac, sizeof(ctx->mac), "BC:24:11:00:00:03");
    snprintf(ctx->ip, sizeof(ctx->ip), "192.168.1.61");
    ctx->selector = DIANA_SELECTOR_SATELITE;
    ctx->reset_reason = DIANA_RESET_POWERON;
    ctx->signature_valid = true;
    ctx->activate_ok = true;
    ctx->health.free_heap_bytes = 214000;
    ctx->health.min_free_heap_bytes = 198000;
    ctx->health.cpu_load_pct = 12.5f;
    ctx->health.has_temperature = true;
    ctx->health.temperature_c = 41.2f;
    ctx->health.has_voltage = true;
    ctx->health.voltage_5v_mv = 4980;
    ctx->health.voltage_12v_mv = 12080;
    wire(ctx, hal);
}

void host_advance_us(host_hal_ctx *ctx, uint64_t us) { ctx->now_us += us; }

void host_reboot(host_hal_ctx *ctx, diana_hal *hal, uint64_t seed,
                 int reset_reason)
{
    host_persistent *nv = ctx->nv;
    host_hal_init(ctx, nv, hal, seed);
    ctx->reset_reason = reset_reason;
}

void host_mqtt_set_lwt(host_hal_ctx *ctx, const char *topic, const char *payload,
                       int qos, bool retain)
{
    snprintf(ctx->lwt_topic, sizeof(ctx->lwt_topic), "%s", topic);
    snprintf(ctx->lwt_payload, sizeof(ctx->lwt_payload), "%s", payload);
    ctx->lwt_qos = qos;
    ctx->lwt_retain = retain;
}

void host_mqtt_set_connected(host_hal_ctx *ctx, bool connected)
{
    if (connected && !ctx->mqtt_connected) ctx->mqtt_reconnects++;
    ctx->mqtt_connected = connected;
}

const host_mqtt_record *host_mqtt_last(const host_hal_ctx *ctx, const char *topic)
{
    for (size_t i = ctx->published_count; i > 0; --i) {
        if (strcmp(ctx->published[i - 1].topic, topic) == 0)
            return &ctx->published[i - 1];
    }
    return NULL;
}

size_t host_mqtt_count(const host_hal_ctx *ctx, const char *topic)
{
    size_t n = 0;
    for (size_t i = 0; i < ctx->published_count; ++i) {
        if (strcmp(ctx->published[i].topic, topic) == 0) n++;
    }
    return n;
}

void host_mqtt_clear(host_hal_ctx *ctx) { ctx->published_count = 0; }
