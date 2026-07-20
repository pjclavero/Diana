/**
 * @file test_crosstalk.c
 * @brief Clasificacion de vibracion cruzada (dosier 9.6).
 *
 * AVISO: los umbrales usados aqui son los valores PROVISIONALES de config.h.
 * Estas pruebas verifican la LOGICA de decision, no que los umbrales sean
 * correctos: eso solo puede establecerse en banco con hardware real.
 */
#include <string.h>

#include "diana/event.h"
#include "diana/sensors.h"
#include "hal_host.h"
#include "test_util.h"

int run_crosstalk(void)
{
    TEST_SUITE("crosstalk");
    int before = g_tests_failed;

    diana_config cfg;
    diana_config_defaults(&cfg);

    SECTION("impacto principal + vecino por debajo del ratio -> rechazado");
    /* Canal 7 golpeado fuerte (2710), canal 4 acompana debil (410).
     * 410/2710 = 0.151 < 0.35 -> el 4 es vibracion cruzada. */
    diana_piezo_trigger trigs[2] = {
        {7, 1832456712, 2710},
        {4, 1832456712 + 620, 410},
    };
    diana_hit_group g;
    diana_sensor_classify(&cfg, trigs, 2, &g);

    CHECK(g.accepted, "el grupo produce un impacto valido");
    CHECK_EQ_INT(g.target_index, 7, "canal principal = 7 (mayor amplitud)");
    CHECK_EQ_STR(diana_hit_classification_str(g.classification), "valid_hit",
                 "clasificacion valid_hit para el principal");
    CHECK_EQ_INT(g.neighbour_count, 1, "1 vecino registrado para auditoria");
    CHECK_EQ_INT(g.neighbours[0].target_index, 4, "el vecino es el canal 4");
    CHECK_EQ_INT(g.neighbours[0].amplitude, 410, "amplitud del vecino registrada");
    CHECK_EQ_INT(g.neighbours[0].delta_us, 620, "delta_us con signo");
    CHECK_EQ_INT(g.rejected_count, 1, "1 canal descartado por crosstalk");
    CHECK_EQ_INT(g.rejected_index[0], 4, "el descartado es el canal 4");
    CHECK(strlen(g.rejected_reason[0]) > 0, "el descarte lleva motivo legible");
    CHECK(strstr(g.rejected_reason[0], "0.15") != NULL,
          "el motivo cita el cociente de amplitud");
    printf("       motivo: %s\n", g.rejected_reason[0]);

    SECTION("el evento del canal descartado se publica con crosstalk_rejected");
    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 16);
    host_hal_init(&ctx, &nv, &hal, 5);
    diana_identity id;
    diana_identity_load(&id, &hal, "0.1.0");
    diana_identity_provision(&id, &hal, "module-03", "system-a", "S", "protoA",
                             "u", "p");

    diana_hit_event rej;
    CHECK(diana_hit_event_build_rejected(&rej, &hal, &id, &g, 0,
                                         DIANA_TARGET_ACTIVE, 1832457400),
          "se construye el evento del canal descartado");
    CHECK_EQ_INT(rej.target_index, 4, "el evento es del canal 4");
    CHECK_EQ_STR(diana_hit_classification_str(rej.classification),
                 "crosstalk_rejected", "classification crosstalk_rejected");
    CHECK(rej.classification_reason[0] != '\0',
          "classification_reason obligatorio y presente");
    CHECK_EQ_INT(diana_hit_event_check(&rej), 0, "el evento pasa la comprobacion local");
    CHECK_EQ_INT(rej.neighbours[0].target_index, 7,
                 "el vecino auditable es el canal principal");
    CHECK_EQ_INT(rej.neighbours[0].delta_us, -620, "delta invertido respecto al principal");

    char json[DIANA_HIT_JSON_MAX];
    size_t n = diana_hit_event_to_json(&rej, json, sizeof(json));
    CHECK(n > 0, "se serializa a JSON");
    dump_message("hit-event.schema.json", "hit_crosstalk_rejected", json);

    SECTION("vecino POR ENCIMA del ratio -> grupo ambiguo, no se puntua");
    diana_piezo_trigger amb[2] = {
        {7, 1000000, 2000},
        {4, 1000900, 1600},   /* 0.80 > 0.35 */
    };
    diana_hit_group ga;
    diana_sensor_classify(&cfg, amb, 2, &ga);
    CHECK(!ga.accepted, "el grupo NO se acepta como impacto valido");
    CHECK_EQ_STR(diana_hit_classification_str(ga.classification), "ambiguous",
                 "clasificacion ambiguous");
    CHECK(strlen(ga.reason) > 0, "la ambiguedad lleva motivo");
    printf("       motivo: %s\n", ga.reason);

    SECTION("disparo fuera de la ventana de agrupacion no es vecino");
    diana_piezo_trigger far[2] = {
        {7, 1000000, 2710},
        {4, 1000000 + 5000, 410},  /* 5 ms > group_window_us (2 ms) */
    };
    diana_hit_group gf;
    diana_sensor_classify(&cfg, far, 2, &gf);
    CHECK(gf.accepted, "el principal sigue siendo valido");
    CHECK_EQ_INT(gf.neighbour_count, 0, "el disparo lejano no cuenta como vecino");
    CHECK_EQ_INT(gf.rejected_count, 0, "no se descarta nada por crosstalk");

    SECTION("empate de amplitud: gana el mas temprano");
    diana_piezo_trigger tie[2] = {
        {5, 2000000 + 300, 1500},
        {2, 2000000, 1500},
    };
    diana_hit_group gt;
    diana_sensor_classify(&cfg, tie, 2, &gt);
    CHECK_EQ_INT(gt.target_index, 2, "el canal 2 (mas temprano) es el principal");

    SECTION("por debajo del umbral no hay impacto");
    diana_piezo_trigger low[1] = {{1, 3000000, 500}};  /* < 900 + 80 */
    diana_hit_group gl;
    diana_sensor_classify(&cfg, low, 1, &gl);
    CHECK(!gl.accepted, "amplitud por debajo del umbral: sin impacto");
    CHECK(strstr(gl.reason, "umbral") != NULL, "el motivo cita el umbral");

    SECTION("antirrebote y blanking por canal");
    diana_sensor_state st;
    diana_sensor_state_init(&st);
    const char *why = NULL;

    diana_piezo_trigger t1 = {3, 5000000, 3000};
    CHECK(diana_sensor_admit(&st, &cfg, &t1, &why), "primer disparo admitido");

    diana_piezo_trigger t2 = {3, 5000000 + 500, 3000};  /* dentro de 2 ms */
    CHECK(!diana_sensor_admit(&st, &cfg, &t2, &why), "rebote a 0,5 ms rechazado");
    CHECK(why && strstr(why, "rebote") != NULL, "motivo: rebote");

    diana_sensor_mark_hit(&st, &cfg, 3, 5000000);
    diana_piezo_trigger t3 = {3, 5000000 + 30000, 3000};  /* 30 ms < 60 ms */
    CHECK(!diana_sensor_admit(&st, &cfg, &t3, &why), "disparo dentro del blanking rechazado");
    CHECK(why && strstr(why, "blanking") != NULL, "motivo: blanking");

    diana_piezo_trigger t4 = {3, 5000000 + 61000, 3000};  /* 61 ms > 60 ms */
    CHECK(diana_sensor_admit(&st, &cfg, &t4, &why), "disparo tras el blanking admitido");

    SECTION("canal deshabilitado no admite disparos");
    diana_config cfg2 = cfg;
    cfg2.calibration[8].enabled = false;
    diana_sensor_state st2;
    diana_sensor_state_init(&st2);
    diana_piezo_trigger t9 = {9, 7000000, 5000};
    CHECK(!diana_sensor_admit(&st2, &cfg2, &t9, &why), "canal 9 deshabilitado rechaza");
    CHECK(why && strstr(why, "deshabilitado") != NULL, "motivo: deshabilitado");

    SECTION("los valores usados son PROVISIONALES, no calibrados");
    CHECK(!cfg.calibration[0].has_calibrated_at,
          "ningun canal viene con fecha de calibracion por defecto");
    CHECK_EQ_INT(cfg.calibration[0].group_window_us, 2000,
                 "ventana de agrupacion 2 ms (centro del rango de ensayo 1-3 ms)");
    CHECK_EQ_INT(cfg.calibration[0].blanking_us, 60000,
                 "blanking 60 ms (centro del rango de ensayo 30-100 ms)");

    return g_tests_failed - before;
}
