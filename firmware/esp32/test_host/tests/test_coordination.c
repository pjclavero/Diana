/**
 * @file test_coordination.c
 * @brief H-01: ningun modulo escribe jamas en el topico de otro.
 *
 * Comprueba las dos vias por las que T2 puede viajar:
 *   - detector = satelite     -> hit con coordinator:null + game-event aparte
 *   - detector = coordinador  -> hit con el bloque coordinator embebido
 */
#include <string.h>

#include "diana/event.h"
#include "diana/ids.h"
#include "diana/messages.h"
#include "hal_host.h"
#include "test_util.h"

static void mk_identity(diana_identity *id, const diana_hal *hal,
                        const char *module_id)
{
    diana_identity_load(id, hal, "0.1.0");
    diana_identity_provision(id, hal, module_id, "system-a", "S", "protoA",
                             "u", "p");
}

static void mk_hit(diana_hit_event *ev, const diana_hal *hal, diana_identity *id)
{
    diana_config cfg;
    diana_config_defaults(&cfg);
    diana_hit_group grp;
    diana_piezo_trigger tr = {7, 1832456712, 2710};
    diana_sensor_classify(&cfg, &tr, 1, &grp);
    diana_hit_event_build(ev, hal, id, &grp, DIANA_TARGET_ACTIVE, 1832456789);
}

int run_coordination(void)
{
    TEST_SUITE("coordination");
    int before = g_tests_failed;

    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 16);
    host_hal_init(&ctx, &nv, &hal, 1234);

    diana_coordinator_time t2 = {
        .recv_us = 1832459000,
        .elapsed_us = 4210556,
        .clock_offset_us = -312,
        .has_uncertainty = true,
        .offset_uncertainty_us = 90,
    };

    SECTION("un satelite NUNCA rellena el bloque coordinator");
    diana_identity sat;
    mk_identity(&sat, &hal, "module-05");
    diana_hit_event sat_hit;
    mk_hit(&sat_hit, &hal, &sat);

    CHECK(!sat_hit.has_coordinator, "el hit nace con coordinator=null");
    CHECK(!diana_hit_event_attach_coordinator(&sat_hit, DIANA_ROLE_SATELLITE,
                                              "module-05", &t2),
          "un satelite no puede adjuntar T2 ni a su propio impacto");
    CHECK(!sat_hit.has_coordinator, "el evento sigue con coordinator=null");

    char json[DIANA_HIT_JSON_MAX];
    size_t n = diana_hit_event_to_json(&sat_hit, json, sizeof(json));
    CHECK(n > 0, "el hit del satelite se serializa");
    CHECK(strstr(json, "\"coordinator\":null") != NULL,
          "el JSON publica coordinator:null");
    dump_message("hit-event.schema.json", "hit_satellite_null_coord", json);

    SECTION("el coordinador NO puede reescribir el hit de un satelite (H-01)");
    diana_identity coord;
    mk_identity(&coord, &hal, "module-01");
    CHECK(!diana_hit_event_attach_coordinator(&sat_hit, DIANA_ROLE_PRINCIPAL,
                                              "module-01", &t2),
          "ni siendo principal puede adjuntar T2 al impacto de otro modulo");
    CHECK(!sat_hit.has_coordinator,
          "el evento del satelite queda intacto: la ACL es ejecutable");

    SECTION("el coordinador SI adjunta T2 a su PROPIO impacto");
    diana_hit_event own_hit;
    mk_hit(&own_hit, &hal, &coord);
    CHECK(diana_hit_event_attach_coordinator(&own_hit, DIANA_ROLE_PRINCIPAL,
                                             "module-01", &t2),
          "el coordinador adjunta T2 a su propio hit");
    CHECK(own_hit.has_coordinator, "el bloque coordinator queda relleno");
    CHECK_EQ_INT(own_hit.coordinator.elapsed_us, 4210556, "elapsed_us consolidado");

    n = diana_hit_event_to_json(&own_hit, json, sizeof(json));
    CHECK(n > 0, "el hit del coordinador se serializa");
    CHECK(strstr(json, "\"elapsed_us\":4210556") != NULL,
          "T2 viaja embebido cuando el detector ES el coordinador");
    dump_message("hit-event.schema.json", "hit_coordinator_own", json);

    SECTION("T2 del impacto de un satelite viaja en game-event");
    char sys_topic[DIANA_TOPIC_MAXLEN];
    size_t tn = diana_system_topic_build(sys_topic, sizeof(sys_topic),
                                         DIANA_SYS_TOPIC_GAME_EVENT, "system-a");
    CHECK(tn > 0, "se construye el topico de system");
    CHECK_EQ_STR(sys_topic, "targets/v1/system/system-a/game/event",
                 "topico del contrato");

    char game_id[DIANA_UUID_LEN], round_id[DIANA_UUID_LEN];
    diana_uuid4(&hal, game_id);
    diana_uuid4(&hal, round_id);

    diana_game_event_hit ge;
    memset(&ge, 0, sizeof(ge));
    ge.system_id = "system-a";
    ge.coordinator_module_id = "module-01";
    ge.game_id = game_id;
    ge.round_id = round_id;
    ge.hit_event_id = sat_hit.event_id;      /* enlace con T1 del detector */
    ge.detector_module_id = sat_hit.module_id;
    ge.target_index = sat_hit.target_index;
    ge.elapsed_us = 4210556;
    snprintf(ge.device.boot_id, sizeof(ge.device.boot_id), "%s", coord.boot_id);
    ge.device.uptime_us = 1832459100;
    ge.device.event_us = 1832459000;
    ge.detail = "impacto de satelite consolidado";

    char gjson[DIANA_MSG_JSON_MAX];
    size_t gn = diana_game_event_target_hit(&hal, DIANA_ROLE_PRINCIPAL, &ge,
                                            gjson, sizeof(gjson));
    CHECK(gn > 0, "se genera el game-event");
    CHECK(strstr(gjson, "\"kind\":\"target_hit\"") != NULL, "kind=target_hit");
    CHECK(strstr(gjson, sat_hit.event_id) != NULL,
          "hit_event_id enlaza con el hit original del satelite");
    CHECK(strstr(gjson, "\"module_id\":\"module-05\"") != NULL,
          "declara quien detecto, sin escribir en su topico");
    CHECK(strstr(gjson, "\"elapsed_us\":4210556") != NULL, "transporta T2");
    dump_message("game-event.schema.json", "game_event_target_hit", gjson);

    SECTION("el game-event lleva event_id PROPIO, distinto del hit");
    CHECK(strstr(gjson, sat_hit.event_id) != NULL, "contiene el hit_event_id");
    /* El event_id del game-event no puede ser el mismo que el del hit: son dos
     * eventos distintos y el backend deduplica por event_id. */
    char needle[64];
    snprintf(needle, sizeof(needle), "\"event_id\":\"%s\"", sat_hit.event_id);
    CHECK(strstr(gjson, needle) == NULL,
          "el event_id del game-event NO es el del hit");

    SECTION("un satelite no puede publicar game-event");
    gn = diana_game_event_target_hit(&hal, DIANA_ROLE_SATELLITE, &ge, gjson,
                                     sizeof(gjson));
    CHECK_EQ_INT(gn, 0, "un satelite no genera game-event: no es su topico");

    gn = diana_game_event_target_hit(&hal, DIANA_ROLE_AUTO, &ge, gjson,
                                     sizeof(gjson));
    CHECK_EQ_INT(gn, 0, "un modulo en AUTO sin rol resuelto tampoco");

    SECTION("un target_hit sin enlace al hit original se rechaza");
    diana_game_event_hit orphan = ge;
    orphan.hit_event_id = NULL;
    gn = diana_game_event_target_hit(&hal, DIANA_ROLE_PRINCIPAL, &orphan, gjson,
                                     sizeof(gjson));
    CHECK_EQ_INT(gn, 0, "T2 huerfano rechazado: el backend no podria unirlo a T1");

    SECTION("topicos de sistema del contrato");
    diana_system_topic_build(sys_topic, sizeof(sys_topic),
                             DIANA_SYS_TOPIC_GAME_STATE, "system-a");
    CHECK_EQ_STR(sys_topic, "targets/v1/system/system-a/game/state",
                 "topico game/state");
    diana_system_topic_build(sys_topic, sizeof(sys_topic),
                             DIANA_SYS_TOPIC_COMMAND, "system-a");
    CHECK_EQ_STR(sys_topic, "targets/v1/system/system-a/command",
                 "topico system/command");

    return g_tests_failed - before;
}
