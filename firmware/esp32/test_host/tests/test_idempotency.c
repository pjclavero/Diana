/**
 * @file test_idempotency.c
 * @brief ADR-0003: event_id no se duplica y (module_id, boot_id, local_sequence)
 *        es unico.
 */
#include <string.h>

#include "diana/ids.h"
#include "diana/messages.h"
#include "diana/queue.h"
#include "hal_host.h"
#include "test_util.h"

#define N_EVENTS 200

typedef struct {
    char module_id[DIANA_ID_MAXLEN];
    char boot_id[DIANA_UUID_LEN];
    uint64_t seq;
} tuple;

static void build(diana_hit_event *ev, const diana_hal *hal, diana_identity *id,
                  uint8_t target, uint64_t t)
{
    diana_config cfg;
    diana_config_defaults(&cfg);
    diana_hit_group g;
    diana_piezo_trigger tr = {target, t, 4000};
    diana_sensor_classify(&cfg, &tr, 1, &g);
    diana_hit_event_build(ev, hal, id, &g, DIANA_TARGET_ACTIVE, t + 5);
}

int run_idempotency(void)
{
    TEST_SUITE("idempotency");
    int before = g_tests_failed;

    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 64);
    host_hal_init(&ctx, &nv, &hal, 2026);

    diana_identity id;
    diana_identity_load(&id, &hal, "0.1.0");
    diana_identity_provision(&id, &hal, "module-03", "system-a", "S1", "protoA",
                             "u", "p");

    SECTION("event_id unico y con formato de contrato");
    static char ids[N_EVENTS][DIANA_EVENTID_LEN];
    static tuple tuples[N_EVENTS];
    int dup_ids = 0, bad_format = 0, dup_tuples = 0;

    for (int i = 0; i < N_EVENTS; ++i) {
        diana_hit_event ev;
        build(&ev, &hal, &id, (uint8_t)(i % 9 + 1), 1000 + (uint64_t)i * 100);
        memcpy(ids[i], ev.event_id, DIANA_EVENTID_LEN);
        if (!diana_is_event_id(ev.event_id)) bad_format++;
        snprintf(tuples[i].module_id, DIANA_ID_MAXLEN, "%s", ev.module_id);
        snprintf(tuples[i].boot_id, DIANA_UUID_LEN, "%s", ev.device.boot_id);
        tuples[i].seq = ev.local_sequence;
        for (int k = 0; k < i; ++k) {
            if (strcmp(ids[k], ids[i]) == 0) dup_ids++;
            if (tuples[k].seq == tuples[i].seq &&
                strcmp(tuples[k].boot_id, tuples[i].boot_id) == 0 &&
                strcmp(tuples[k].module_id, tuples[i].module_id) == 0)
                dup_tuples++;
        }
    }
    CHECK_EQ_INT(bad_format, 0, "los 200 event_id cumplen el patron eventId");
    CHECK_EQ_INT(dup_ids, 0, "no hay event_id repetidos en 200 eventos");
    CHECK_EQ_INT(dup_tuples, 0,
                 "(module_id, boot_id, local_sequence) unico en 200 eventos");

    SECTION("local_sequence es estrictamente monotonica");
    int non_monotonic = 0;
    for (int i = 1; i < N_EVENTS; ++i)
        if (tuples[i].seq <= tuples[i - 1].seq) non_monotonic++;
    CHECK_EQ_INT(non_monotonic, 0, "local_sequence crece siempre");

    SECTION("la cola NO admite el mismo event_id dos veces");
    diana_event_queue q;
    diana_queue_init(&q, &hal, DIANA_QUEUE_DROP_OLDEST);
    diana_hit_event ev;
    build(&ev, &hal, &id, 3, 99000);
    CHECK_EQ_INT(diana_queue_push(&q, &ev), DIANA_HAL_OK, "primer push aceptado");
    CHECK_EQ_INT(diana_queue_push(&q, &ev), DIANA_HAL_ERR_INVALID,
                 "segundo push del MISMO event_id rechazado");
    CHECK_EQ_INT(diana_queue_depth(&q), 1, "solo un evento en la cola");
    CHECK_EQ_INT(q.duplicates, 1, "duplicado contabilizado");
    CHECK(diana_queue_seen(&q, ev.event_id), "el event_id queda memorizado");

    SECTION("boot_id CAMBIA al reiniciar y local_sequence NO retrocede");
    char boot_before[DIANA_UUID_LEN];
    snprintf(boot_before, sizeof(boot_before), "%s", id.boot_id);
    uint64_t seq_before = id.local_sequence;

    host_reboot(&ctx, &hal, 777, DIANA_RESET_SOFTWARE);
    diana_identity id2;
    diana_identity_load(&id2, &hal, "0.1.0");

    CHECK(strcmp(id2.boot_id, boot_before) != 0, "boot_id distinto tras reiniciar");
    CHECK(diana_is_uuid(id2.boot_id), "el nuevo boot_id es un UUID valido");
    CHECK_EQ_STR(id2.module_id, "module-03", "module_id persiste en NVS");
    CHECK(id2.local_sequence >= seq_before,
          "local_sequence no retrocede tras reiniciar");

    SECTION("la reserva de secuencia evita repetir tras corte de corriente");
    /* Se emitieron seq_before valores; la frontera reservada era mayor, asi que
     * tras el reinicio la secuencia arranca por encima de lo ya emitido. */
    CHECK(id2.local_sequence >= seq_before,
          "la nueva secuencia arranca en o por encima de la frontera");
    uint64_t s1 = diana_identity_next_sequence(&id2, &hal);
    uint64_t s2 = diana_identity_next_sequence(&id2, &hal);
    CHECK_EQ_INT(s2, s1 + 1, "secuencia consecutiva tras el reinicio");
    CHECK(s1 >= seq_before, "ningun valor emitido antes se reutiliza");

    return g_tests_failed - before;
}
