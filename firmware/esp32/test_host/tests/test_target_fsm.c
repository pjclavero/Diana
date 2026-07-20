/**
 * @file test_target_fsm.c
 * @brief Maquina de estados de una diana (dosier 13.4).
 */
#include "diana/target_fsm.h"
#include "test_util.h"

int run_target_fsm(void)
{
    TEST_SUITE("target_fsm");
    int before = g_tests_failed;

    diana_target t;
    diana_target_init(&t, 1, 0);

    SECTION("ciclo nominal APAGADA -> SEGURA -> ACTIVA -> ALCANZADA");
    CHECK_EQ_STR(diana_target_state_str(t.state), "off", "estado inicial off");
    CHECK(diana_target_apply(&t, DIANA_TEV_ENABLE, 1), "off -> safe");
    CHECK(diana_target_apply(&t, DIANA_TEV_ARM, 2), "safe -> active");
    CHECK(diana_target_is_scorable(&t), "active puntua");
    CHECK(diana_target_apply(&t, DIANA_TEV_HIT_VALID, 3), "active -> hit");
    CHECK_EQ_INT(t.hits, 1, "contador de impactos");
    CHECK(diana_target_apply(&t, DIANA_TEV_HIT_CLEARED, 4), "hit -> safe");
    CHECK(diana_target_apply(&t, DIANA_TEV_ARM, 5), "safe -> active de nuevo");
    CHECK(diana_target_apply(&t, DIANA_TEV_ROUND_END, 6), "active -> off al fin de ronda");

    SECTION("transiciones INVALIDAS rechazadas");
    diana_target u;
    diana_target_init(&u, 2, 0);
    CHECK(!diana_target_apply(&u, DIANA_TEV_HIT_VALID, 1),
          "off + hit_valid rechazado");
    CHECK_EQ_STR(diana_target_state_str(u.state), "off", "sigue en off");
    diana_target_apply(&u, DIANA_TEV_ENABLE, 2);
    CHECK(!diana_target_apply(&u, DIANA_TEV_HIT_VALID, 3),
          "safe + hit_valid rechazado (un impacto en segura no es acierto)");
    CHECK(!diana_target_is_scorable(&u), "safe no puntua");
    CHECK(diana_target_apply(&u, DIANA_TEV_HIT_PENALTY, 4),
          "safe + impacto -> penalty");
    CHECK_EQ_STR(diana_target_state_str(u.state), "penalty", "estado penalty");
    CHECK_EQ_INT(u.rejected, 2, "dos transiciones rechazadas");

    SECTION("estados de averia y administracion");
    diana_target v;
    diana_target_init(&v, 3, 0);
    diana_target_apply(&v, DIANA_TEV_ENABLE, 1);
    CHECK(diana_target_apply(&v, DIANA_TEV_SENSOR_FAULT, 2), "safe -> sensor_error");
    CHECK(!diana_target_apply(&v, DIANA_TEV_ARM, 3),
          "sensor_error + arm rechazado: no se arma una diana averiada");
    CHECK(diana_target_apply(&v, DIANA_TEV_ADMIN_DISABLE, 4), "-> disabled");
    CHECK(!v.enabled, "enabled=false tras admin_disable");
    CHECK(!diana_target_apply(&v, DIANA_TEV_ARM, 5), "disabled + arm rechazado");
    CHECK(diana_target_apply(&v, DIANA_TEV_ADMIN_ENABLE, 6), "disabled -> safe");
    CHECK(v.enabled, "enabled=true tras admin_enable");

    SECTION("bloqueo por el coordinador");
    diana_target w;
    diana_target_init(&w, 4, 0);
    diana_target_apply(&w, DIANA_TEV_ENABLE, 1);
    diana_target_apply(&w, DIANA_TEV_ARM, 2);
    CHECK(diana_target_apply(&w, DIANA_TEV_LOCK, 3), "active -> locked");
    CHECK(!diana_target_is_scorable(&w), "locked no puntua");
    CHECK(!diana_target_apply(&w, DIANA_TEV_HIT_VALID, 4), "locked + hit rechazado");
    CHECK(diana_target_apply(&w, DIANA_TEV_UNLOCK, 5), "locked -> safe");

    SECTION("conjunto de 9 dianas");
    diana_target_set set;
    diana_target_set_init(&set, 0);
    CHECK(diana_target_at(&set, 0) == NULL, "indice 0 invalido (el contrato es 1..9)");
    CHECK(diana_target_at(&set, 10) == NULL, "indice 10 invalido");
    CHECK(diana_target_at(&set, 1) != NULL, "indice 1 valido");
    CHECK(diana_target_at(&set, 9) != NULL, "indice 9 valido");
    CHECK_EQ_INT(diana_target_at(&set, 7)->index, 7, "indice interno coherente");

    SECTION("todos los estados del contrato son alcanzables");
    bool reachable[DIANA_TARGET_STATE_COUNT];
    for (int i = 0; i < DIANA_TARGET_STATE_COUNT; ++i) reachable[i] = false;
    reachable[DIANA_TARGET_OFF] = true;
    /* BFS sobre la tabla mediante prueba exhaustiva. */
    for (int pass = 0; pass < DIANA_TARGET_STATE_COUNT; ++pass) {
        for (int s = 0; s < DIANA_TARGET_STATE_COUNT; ++s) {
            if (!reachable[s]) continue;
            for (int ev = 0; ev < DIANA_TEV_COUNT; ++ev) {
                diana_target x;
                diana_target_init(&x, 1, 0);
                x.state = (diana_target_state)s;
                if (diana_target_apply(&x, (diana_target_event)ev, 0))
                    reachable[x.state] = true;
            }
        }
    }
    for (int s = 0; s < DIANA_TARGET_STATE_COUNT; ++s) {
        char d[96];
        snprintf(d, sizeof(d), "estado '%s' alcanzable",
                 diana_target_state_str((diana_target_state)s));
        CHECK(reachable[s], d);
    }

    return g_tests_failed - before;
}
