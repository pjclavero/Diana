/**
 * @file test_reconnect.c
 * @brief Perdida de red: los eventos se encolan y se reenvian al reconectar
 *        (dosier 14.3). Incluye el Last Will exigido por el contrato §3.
 */
#include <string.h>

#include "diana/messages.h"
#include "diana/queue.h"
#include "hal_host.h"
#include "test_util.h"

/* Simula el camino real: detectar -> clasificar -> construir -> publicar o
 * encolar. Es la unica logica de "aplicacion" que necesitan estas pruebas. */
static bool emit_hit(const diana_hal *hal, diana_identity *id,
                     diana_event_queue *q, const diana_config *cfg,
                     const char *topic, uint8_t target, uint64_t t_us,
                     uint16_t amplitude)
{
    diana_piezo_trigger tr = {target, t_us, amplitude};
    diana_hit_group grp;
    diana_sensor_classify(cfg, &tr, 1, &grp);
    if (!grp.accepted) return false;

    diana_hit_event ev;
    diana_hit_event_build(&ev, hal, id, &grp, DIANA_TARGET_ACTIVE, t_us + 20);
    if (diana_hit_event_check(&ev) != DIANA_HAL_OK) return false;

    char json[DIANA_HIT_JSON_MAX];
    size_t n = diana_hit_event_to_json(&ev, json, sizeof(json));
    if (n == 0) return false;

    if (hal->mqtt_connected(hal->ctx)) {
        diana_hal_mqtt_msg m = {topic, json, n, 1, false};
        if (hal->mqtt_publish(hal->ctx, &m) >= 0) {
            diana_queue_remember(q, ev.event_id);
            return true;
        }
    }
    /* Sin conexion: a la cola local. */
    return diana_queue_push(q, &ev) == DIANA_HAL_OK;
}

int run_reconnect(void)
{
    TEST_SUITE("reconnect");
    int before = g_tests_failed;

    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 32);
    host_hal_init(&ctx, &nv, &hal, 314);

    diana_identity id;
    diana_identity_load(&id, &hal, "0.1.0");
    diana_identity_provision(&id, &hal, "module-05", "system-a", "DIANA-M05",
                             "protoA", "module-module-05", "secreto");

    diana_config cfg;
    diana_config_defaults(&cfg);

    diana_event_queue q;
    diana_queue_init(&q, &hal, DIANA_QUEUE_DROP_OLDEST);

    char topic[DIANA_TOPIC_MAXLEN];
    diana_topic_build(topic, sizeof(topic), DIANA_TOPIC_HIT, id.module_id);

    SECTION("Last Will EXACTO del contrato §3");
    char lwt[256];
    size_t n = diana_presence_lwt_json(id.module_id, lwt, sizeof(lwt));
    CHECK(n > 0, "se genera el payload de LWT");
    CHECK_EQ_STR(lwt,
                 "{\"schema_version\":1,\"module_id\":\"module-05\","
                 "\"online\":false,\"reason\":\"lwt\"}",
                 "payload LWT literal del contrato");

    char ptopic[DIANA_TOPIC_MAXLEN];
    diana_topic_build(ptopic, sizeof(ptopic), DIANA_TOPIC_PRESENCE, id.module_id);
    CHECK_EQ_STR(ptopic, "targets/v1/module/module-05/presence", "topico de presencia");
    CHECK_EQ_INT(diana_topic_qos(DIANA_TOPIC_PRESENCE), 1, "presence QoS 1");
    CHECK(diana_topic_retain(DIANA_TOPIC_PRESENCE), "presence retain=true");
    CHECK(!diana_topic_retain(DIANA_TOPIC_HIT), "hit retain=false");
    CHECK(!diana_topic_retain(DIANA_TOPIC_DIAGNOSTIC), "diagnostic retain=false");
    CHECK_EQ_INT(diana_topic_qos(DIANA_TOPIC_TELEMETRY), 0, "telemetry QoS 0");
    host_mqtt_set_lwt(&ctx, ptopic, lwt, 1, true);
    dump_message("module-presence.schema.json", "presence_lwt", lwt);

    SECTION("conectado: los impactos se publican directamente");
    host_mqtt_set_connected(&ctx, true);
    CHECK(emit_hit(&hal, &id, &q, &cfg, topic, 1, 1000000, 3000), "impacto 1 emitido");
    CHECK(emit_hit(&hal, &id, &q, &cfg, topic, 2, 1100000, 3000), "impacto 2 emitido");
    CHECK_EQ_INT(host_mqtt_count(&ctx, topic), 2, "2 publicados");
    CHECK_EQ_INT(diana_queue_depth(&q), 0, "cola vacia mientras hay red");

    const host_mqtt_record *live = host_mqtt_last(&ctx, topic);
    CHECK(live && strstr(live->payload, "\"replay\":false") != NULL,
          "un impacto en directo lleva replay=false");
    CHECK(live && strstr(live->payload, "\"coordinator\":null") != NULL,
          "un satelite publica coordinator=null (T2 no es suyo)");
    CHECK(live && strstr(live->payload, "received_at") == NULL,
          "el payload NO contiene received_at (ADR-0002)");
    dump_message("hit-event.schema.json", "hit_live", live ? live->payload : "{}");

    SECTION("cae la red: los impactos se encolan, no se pierden");
    host_mqtt_set_connected(&ctx, false);
    ctx.link_up = false;
    for (int i = 0; i < 5; ++i) {
        char d[64];
        snprintf(d, sizeof(d), "impacto %d encolado sin red", i + 1);
        CHECK(emit_hit(&hal, &id, &q, &cfg, topic, (uint8_t)(i + 1),
                       2000000 + (uint64_t)i * 100000, 3000), d);
    }
    CHECK_EQ_INT(diana_queue_depth(&q), 5, "5 eventos pendientes en la cola");
    CHECK_EQ_INT(host_mqtt_count(&ctx, topic), 2, "no se publica nada sin red");

    SECTION("vuelve la red: se reenvian todos marcados como replay");
    host_mqtt_set_connected(&ctx, true);
    ctx.link_up = true;
    int sent = diana_queue_flush(&q, topic, 100);
    CHECK_EQ_INT(sent, 5, "los 5 eventos se reenvian");
    CHECK_EQ_INT(diana_queue_depth(&q), 0, "cola vaciada");
    CHECK_EQ_INT(host_mqtt_count(&ctx, topic), 7, "7 publicaciones en total");

    int with_replay = 0;
    for (size_t i = 0; i < ctx.published_count; ++i) {
        if (strcmp(ctx.published[i].topic, topic) == 0 &&
            strstr(ctx.published[i].payload, "\"replay\":true"))
            with_replay++;
    }
    CHECK_EQ_INT(with_replay, 5, "exactamente 5 llevan replay=true");
    CHECK_EQ_INT(q.replayed, 5, "contador de reenvios");

    SECTION("un corte a mitad del vaciado deja el resto en la cola");
    host_mqtt_set_connected(&ctx, false);
    for (int i = 0; i < 4; ++i)
        emit_hit(&hal, &id, &q, &cfg, topic, 1, 5000000 + (uint64_t)i * 100000, 3000);
    CHECK_EQ_INT(diana_queue_depth(&q), 4, "4 eventos pendientes");
    host_mqtt_set_connected(&ctx, true);
    CHECK_EQ_INT(diana_queue_flush(&q, topic, 2), 2, "se vacian solo 2 (limite)");
    CHECK_EQ_INT(diana_queue_depth(&q), 2, "quedan 2 pendientes");
    host_mqtt_set_connected(&ctx, false);
    CHECK_EQ_INT(diana_queue_flush(&q, topic, 10), 0, "sin red no se vacia mas");
    CHECK_EQ_INT(diana_queue_depth(&q), 2, "los 2 restantes siguen ahi");

    SECTION("presencia de conexion y de apagado ordenado");
    host_mqtt_set_connected(&ctx, true);
    diana_hal_net_status net;
    hal.net_status(hal.ctx, &net);
    net.has_ip = true;
    char pj[1024];
    size_t pn = diana_presence_json(&id, DIANA_PRESENCE_CONNECT, &net, pj, sizeof(pj));
    CHECK(pn > 0, "presence connect generado");
    CHECK(strstr(pj, "\"online\":true") != NULL, "online=true al conectar");
    CHECK(strstr(pj, "\"reason\":\"connect\"") != NULL, "reason=connect");
    CHECK(strstr(pj, "secreto") == NULL, "la presencia NO expone la credencial MQTT");
    dump_message("module-presence.schema.json", "presence_online", pj);

    pn = diana_presence_json(&id, DIANA_PRESENCE_SHUTDOWN, &net, pj, sizeof(pj));
    CHECK(strstr(pj, "\"online\":false") != NULL, "online=false al apagar");
    CHECK(strstr(pj, "\"reason\":\"shutdown\"") != NULL, "reason=shutdown");
    dump_message("module-presence.schema.json", "presence_shutdown", pj);

    return g_tests_failed - before;
}
