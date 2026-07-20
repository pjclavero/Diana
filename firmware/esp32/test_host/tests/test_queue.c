/**
 * @file test_queue.c
 * @brief Cola persistente: encolar, reenviar, cola llena, replay.
 */
#include <string.h>

#include "diana/messages.h"
#include "diana/queue.h"
#include "hal_host.h"
#include "test_util.h"

static void make_identity(diana_identity *id, const diana_hal *hal)
{
    diana_identity_load(id, hal, "0.1.0");
    diana_identity_provision(id, hal, "module-03", "system-a", "DIANA-M03-0001",
                             "protoA", "module-module-03", "secreto");
}

static void make_event(diana_hit_event *ev, const diana_hal *hal,
                       diana_identity *id, uint8_t target, uint64_t t_us)
{
    diana_config cfg;
    diana_config_defaults(&cfg);
    diana_hit_group g;
    diana_piezo_trigger tr = {target, t_us, 3000};
    diana_sensor_classify(&cfg, &tr, 1, &g);
    diana_hit_event_build(ev, hal, id, &g, DIANA_TARGET_ACTIVE, t_us + 10);
}

int run_queue(void)
{
    TEST_SUITE("queue");
    int before = g_tests_failed;

    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 4);   /* capacidad pequena a proposito */
    host_hal_init(&ctx, &nv, &hal, 42);

    diana_identity id;
    make_identity(&id, &hal);

    diana_event_queue q;
    diana_queue_init(&q, &hal, DIANA_QUEUE_DROP_OLDEST);

    SECTION("encolar sin red");
    host_mqtt_set_connected(&ctx, false);
    CHECK_EQ_INT(diana_queue_depth(&q), 0, "cola vacia al inicio");
    CHECK_EQ_INT(diana_queue_capacity(&q), 4, "capacidad reportada");

    diana_hit_event ev1, ev2;
    make_event(&ev1, &hal, &id, 1, 1000);
    make_event(&ev2, &hal, &id, 2, 2000);
    CHECK_EQ_INT(diana_queue_push(&q, &ev1), DIANA_HAL_OK, "encola evento 1");
    CHECK_EQ_INT(diana_queue_push(&q, &ev2), DIANA_HAL_OK, "encola evento 2");
    CHECK_EQ_INT(diana_queue_depth(&q), 2, "profundidad 2");

    SECTION("el evento encolado NO lleva replay; el reenviado SI");
    diana_hit_event peeked;
    CHECK_EQ_INT(diana_queue_peek(&q, 0, &peeked), DIANA_HAL_OK, "peek del frente");
    CHECK(!peeked.replay, "el evento almacenado tiene replay=false");
    CHECK_EQ_STR(peeked.event_id, ev1.event_id, "el frente es el primero encolado (FIFO)");

    SECTION("reenvio al recuperar la conexion");
    char topic[DIANA_TOPIC_MAXLEN];
    diana_topic_build(topic, sizeof(topic), DIANA_TOPIC_HIT, id.module_id);
    CHECK_EQ_STR(topic, "targets/v1/module/module-03/hit", "topico segun contrato");

    CHECK_EQ_INT(diana_queue_flush(&q, topic, 10), 0,
                 "sin conexion no se reenvia nada");
    CHECK_EQ_INT(diana_queue_depth(&q), 2, "la cola queda intacta");

    host_mqtt_set_connected(&ctx, true);
    CHECK_EQ_INT(diana_queue_flush(&q, topic, 10), 2, "se reenvian los 2 eventos");
    CHECK_EQ_INT(diana_queue_depth(&q), 0, "cola vacia tras confirmar");
    CHECK_EQ_INT(host_mqtt_count(&ctx, topic), 2, "2 publicaciones registradas");

    const host_mqtt_record *r = host_mqtt_last(&ctx, topic);
    CHECK(r != NULL, "hay mensaje publicado");
    CHECK(r && strstr(r->payload, "\"replay\":true") != NULL,
          "el reenvio lleva replay=true");
    CHECK(r && r->qos == 1, "QoS 1 segun contrato");
    CHECK(r && r->retain == false, "retain=false: un hit NUNCA se retiene");
    dump_message("hit-event.schema.json", "hit_replay", r ? r->payload : "{}");

    SECTION("cola llena con politica DROP_OLDEST");
    host_mqtt_set_connected(&ctx, false);
    diana_hit_event e[6];
    for (int i = 0; i < 6; ++i) {
        make_event(&e[i], &hal, &id, (uint8_t)(i % 9 + 1), 10000 + (uint64_t)i * 1000);
        int rc = diana_queue_push(&q, &e[i]);
        char d[80];
        snprintf(d, sizeof(d), "push %d aceptado con DROP_OLDEST", i);
        CHECK_EQ_INT(rc, DIANA_HAL_OK, d);
    }
    CHECK_EQ_INT(diana_queue_depth(&q), 4, "la cola no supera su capacidad");
    CHECK_EQ_INT(q.dropped, 2, "2 eventos antiguos descartados");
    CHECK_EQ_INT(q.overflow_events, 2, "2 desbordamientos contabilizados");
    diana_queue_peek(&q, 0, &peeked);
    CHECK_EQ_STR(peeked.event_id, e[2].event_id,
                 "el frente es el 3er evento: se perdieron los 2 mas antiguos");

    SECTION("cola llena con politica REJECT_NEW");
    host_persistent nv2;
    host_hal_ctx ctx2;
    diana_hal hal2;
    host_persistent_reset(&nv2, 2);
    host_hal_init(&ctx2, &nv2, &hal2, 7);
    diana_identity id2;
    make_identity(&id2, &hal2);
    diana_event_queue q2;
    diana_queue_init(&q2, &hal2, DIANA_QUEUE_REJECT_NEW);

    diana_hit_event f[3];
    for (int i = 0; i < 3; ++i)
        make_event(&f[i], &hal2, &id2, 1, 100 + (uint64_t)i);
    CHECK_EQ_INT(diana_queue_push(&q2, &f[0]), DIANA_HAL_OK, "push 1 aceptado");
    CHECK_EQ_INT(diana_queue_push(&q2, &f[1]), DIANA_HAL_OK, "push 2 aceptado");
    CHECK_EQ_INT(diana_queue_push(&q2, &f[2]), DIANA_HAL_ERR_NO_SPACE,
                 "push 3 rechazado: cola llena");
    CHECK_EQ_INT(diana_queue_depth(&q2), 2, "no se pierde el historico");
    CHECK_EQ_INT(q2.dropped, 0, "REJECT_NEW no descarta nada antiguo");
    CHECK_EQ_INT(q2.overflow_events, 1, "el desbordamiento se contabiliza igualmente");

    SECTION("la cola SOBREVIVE a un reinicio (persistencia NVS)");
    host_persistent nv3;
    host_hal_ctx ctx3;
    diana_hal hal3;
    host_persistent_reset(&nv3, 8);
    host_hal_init(&ctx3, &nv3, &hal3, 99);
    diana_identity id3;
    make_identity(&id3, &hal3);
    diana_event_queue q3;
    diana_queue_init(&q3, &hal3, DIANA_QUEUE_DROP_OLDEST);
    diana_hit_event g1;
    make_event(&g1, &hal3, &id3, 5, 500);
    diana_queue_push(&q3, &g1);
    CHECK_EQ_INT(diana_queue_depth(&q3), 1, "1 evento pendiente antes del reinicio");

    host_reboot(&ctx3, &hal3, 100, DIANA_RESET_PANIC);
    diana_event_queue q3b;
    diana_queue_init(&q3b, &hal3, DIANA_QUEUE_DROP_OLDEST);
    CHECK_EQ_INT(diana_queue_depth(&q3b), 1, "el evento sigue en la cola tras reiniciar");
    diana_hit_event survivor;
    diana_queue_peek(&q3b, 0, &survivor);
    CHECK_EQ_STR(survivor.event_id, g1.event_id,
                 "mismo event_id tras el reinicio: estable entre reintentos");

    return g_tests_failed - before;
}
