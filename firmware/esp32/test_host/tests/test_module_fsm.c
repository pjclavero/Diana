/**
 * @file test_module_fsm.c
 * @brief Maquina de estados del modulo: transiciones VALIDAS e INVALIDAS.
 */
#include "diana/module_fsm.h"
#include "test_util.h"

int run_module_fsm(void)
{
    TEST_SUITE("module_fsm");
    int before = g_tests_failed;

    diana_module_fsm f;
    diana_module_fsm_init(&f, 0);

    SECTION("arranque nominal hasta LISTO (dosier 13.3)");
    CHECK_EQ_STR(diana_module_state_str(f.state), "boot", "estado inicial boot");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_SELFTEST_START, 1), "boot -> selftest");
    CHECK_EQ_STR(diana_module_state_str(f.state), "selftest", "estado selftest");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_SELFTEST_OK, 2), "selftest -> network");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_MQTT_CONNECTED, 3), "network -> registering");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_REGISTERED, 4), "registering -> ready");
    CHECK_EQ_STR(diana_module_state_str(f.state), "ready", "estado ready");

    SECTION("transiciones INVALIDAS se rechazan sin cambiar de estado");
    uint32_t rej = f.rejected;
    CHECK(!diana_module_fsm_apply(&f, DIANA_EV_GAME_START, 5),
          "ready -> game_start rechazado (falta preparacion)");
    CHECK_EQ_STR(diana_module_state_str(f.state), "ready", "sigue en ready tras rechazo");
    CHECK_EQ_INT(f.rejected, rej + 1, "contador de rechazos incrementado");
    CHECK(!diana_module_fsm_apply(&f, DIANA_EV_SELFTEST_OK, 5),
          "ready -> selftest_ok rechazado");
    CHECK(!diana_module_fsm_apply(&f, DIANA_EV_GAME_RESUME, 5),
          "ready -> game_resume rechazado");
    CHECK(!diana_module_fsm_apply(&f, DIANA_EV_REGISTERED, 5),
          "ready -> registered rechazado (ya registrado)");
    CHECK_EQ_INT(f.rejected, rej + 4, "cuatro rechazos contabilizados");

    SECTION("secuencia completa de partida");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_GAME_PREPARE, 10), "ready -> game_prepare");
    CHECK(diana_module_fsm_game_in_progress(&f), "game_prepare cuenta como partida en curso");
    CHECK(!diana_module_fsm_apply(&f, DIANA_EV_GAME_START, 11),
          "game_prepare -> game_start rechazado (falta cuenta atras)");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_GAME_COUNTDOWN, 12), "-> game_countdown");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_GAME_START, 13), "-> game_active");
    CHECK(diana_module_fsm_accepts_hits(&f), "game_active acepta impactos");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_GAME_PAUSE, 14), "-> game_paused");
    CHECK(!diana_module_fsm_accepts_hits(&f), "game_paused NO acepta impactos");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_GAME_RESUME, 15), "-> game_active");
    CHECK(diana_module_fsm_apply(&f, DIANA_EV_GAME_FINISH, 16), "-> game_finished");
    CHECK(!diana_module_fsm_game_in_progress(&f), "game_finished no es partida en curso");

    SECTION("perder MQTT en partida activa pausa, no finaliza (dosier 14.3)");
    diana_module_fsm g;
    diana_module_fsm_init(&g, 0);
    diana_module_fsm_apply(&g, DIANA_EV_SELFTEST_START, 0);
    diana_module_fsm_apply(&g, DIANA_EV_SELFTEST_OK, 0);
    diana_module_fsm_apply(&g, DIANA_EV_MQTT_CONNECTED, 0);
    diana_module_fsm_apply(&g, DIANA_EV_REGISTERED, 0);
    diana_module_fsm_apply(&g, DIANA_EV_GAME_PREPARE, 0);
    diana_module_fsm_apply(&g, DIANA_EV_GAME_COUNTDOWN, 0);
    diana_module_fsm_apply(&g, DIANA_EV_GAME_START, 0);
    CHECK(diana_module_fsm_apply(&g, DIANA_EV_MQTT_DISCONNECTED, 20),
          "game_active + mqtt_disconnected -> game_paused");
    CHECK_EQ_STR(diana_module_state_str(g.state), "game_paused",
                 "la ronda queda pausada, no finalizada");

    SECTION("autodiagnostico fallido lleva a error y solo sale con clear_error");
    diana_module_fsm e;
    diana_module_fsm_init(&e, 0);
    diana_module_fsm_apply(&e, DIANA_EV_SELFTEST_START, 0);
    CHECK(diana_module_fsm_apply(&e, DIANA_EV_SELFTEST_FAIL, 1), "selftest -> error");
    CHECK_EQ_STR(diana_module_state_str(e.state), "error", "estado error");
    CHECK(!diana_module_fsm_apply(&e, DIANA_EV_GAME_PREPARE, 2),
          "error -> game_prepare rechazado");
    CHECK(!diana_module_fsm_apply(&e, DIANA_EV_REGISTERED, 2),
          "error -> registered rechazado");
    CHECK(diana_module_fsm_apply(&e, DIANA_EV_ERROR_CLEARED, 3),
          "error -> selftest con clear_error");

    SECTION("cada estado tiene al menos una transicion de salida declarada");
    for (int s = 0; s < DIANA_MODULE_STATE_COUNT; ++s) {
        diana_module_fsm t;
        diana_module_fsm_init(&t, 0);
        t.state = (diana_module_state)s;
        bool any = false;
        for (int ev = 0; ev < DIANA_EV_COUNT; ++ev) {
            if (diana_module_fsm_can(&t, (diana_module_event)ev)) { any = true; break; }
        }
        char d[96];
        snprintf(d, sizeof(d), "estado '%s' tiene salida",
                 diana_module_state_str((diana_module_state)s));
        CHECK(any, d);
    }

    return g_tests_failed - before;
}
