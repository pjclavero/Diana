/**
 * @file test_command.c
 * @brief Caducidad, repeticion de command_id, nonce persistido y params por
 *        accion. Cubre los hallazgos H-05 y H-07 del supervisor.
 */
#include <string.h>

#include "diana/command.h"
#include "hal_host.h"
#include "test_util.h"

/* Hora de pared de referencia para las pruebas. */
#define T0_MS 1784500000000ULL

static diana_command mk(const char *cid, uint64_t nonce, uint32_t expires,
                        diana_issuer issuer, diana_command_action action,
                        uint64_t issued_at_ms)
{
    diana_command c;
    memset(&c, 0, sizeof(c));
    snprintf(c.command_id, sizeof(c.command_id), "%s", cid);
    c.issued_at_ms = issued_at_ms;
    c.expires_in_ms = expires;
    c.nonce = nonce;
    c.issuer = issuer;
    snprintf(c.module_id, sizeof(c.module_id), "module-03");
    c.action = action;
    c.schema_version = 1;

    /* Params obligatorios segun la accion, para que las pruebas de caducidad no
     * choquen con la validacion de params (H-07). */
    c.has_params = true;
    switch (action) {
    case DIANA_CMD_IDENTIFY:        c.param_duration_ms = true; break;
    case DIANA_CMD_SET_TARGETS:     c.param_targets = true;
                                    c.param_targets_count = 2; break;
    case DIANA_CMD_SET_ALL_TARGETS: c.param_state = true; break;
    case DIANA_CMD_SET_MAINTENANCE: c.param_enabled = true; break;
    default: break;
    }
    return c;
}

static diana_command_clock clk(uint64_t recv_us, uint64_t now_us, uint64_t epoch_ms)
{
    diana_command_clock c = {recv_us, now_us, epoch_ms};
    return c;
}

int run_command(void)
{
    TEST_SUITE("command");
    int before = g_tests_failed;

    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 8);
    host_hal_init(&ctx, &nv, &hal, 4242);

    diana_command_guard g;
    diana_command_guard_init(&g, &hal);
    const char *me = "module-03";

    SECTION("comando valido aceptado");
    diana_command c1 = mk("ad506082-af5e-4d6c-bf71-5e6f70819203", 42, 5000,
                          DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY, T0_MS);
    diana_command_clock k = clk(1000000, 1000500, T0_MS + 100);
    diana_command_verdict v = diana_command_validate(&g, &c1, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted", "identify aceptado");
    CHECK_EQ_STR(v.detail, "", "sin salvedades: la caducidad se pudo verificar");
    CHECK_EQ_INT(g.accepted, 1, "1 comando aceptado");

    SECTION("command_id repetido -> duplicate (cache de los ultimos 128)");
    k = clk(2000000, 2000500, T0_MS + 200);
    v = diana_command_validate(&g, &c1, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "duplicate",
                 "mismo command_id rechazado como duplicado");
    CHECK_EQ_INT(g.rejected_duplicate, 1, "duplicado contabilizado");

    SECTION("H-05: la caducidad se mide desde issued_at_ms, no desde la recepcion");
    /* Este es EXACTAMENTE el ataque que la regla anterior no detenia: un comando
     * legitimo capturado y reinyectado. Llega "ahora" (recv_us reciente), pero
     * fue emitido hace 10 minutos con una validez de 5 s. */
    diana_command captured = mk("6f1c2c4e-6b1a-4f2e-9b3d-1a2b3c4d5e6f", 43, 5000,
                                DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS,
                                T0_MS);
    k = clk(3000000, 3000100, T0_MS + 600000);   /* 10 min despues */
    v = diana_command_validate(&g, &captured, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "expired",
                 "comando reinyectado 10 min despues: CADUCADO");
    CHECK(strstr(v.detail, "issued_at_ms") != NULL,
          "el detalle cita issued_at_ms como referencia");
    printf("       detalle: %s\n", v.detail);
    CHECK_EQ_INT(g.rejected_expired, 1, "caducidad contabilizada");

    SECTION("el mismo comando, recien emitido, si se acepta");
    diana_command fresh = mk("6f1c2c4e-6b1a-4f2e-9b3d-1a2b3c4d5e70", 43, 5000,
                             DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS,
                             T0_MS + 700000);
    k = clk(3100000, 3100100, T0_MS + 700500);   /* 500 ms de edad */
    v = diana_command_validate(&g, &fresh, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "500 ms de edad: dentro de los 5 s de validez");

    SECTION("nonce no monotonico rechazado (proteccion de reenvio)");
    diana_command old = mk("7a2d3d5f-7c2b-4a3f-8c4e-2b3c4d5e6f70", 42, 5000,
                           DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS,
                           T0_MS + 700600);
    k = clk(3200000, 3200100, T0_MS + 700700);
    v = diana_command_validate(&g, &old, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "nonce 42 <= 43 rechazado");
    CHECK(strstr(v.detail, "nonce") != NULL, "el detalle cita el nonce");
    CHECK_EQ_INT(g.rejected_nonce, 1, "rechazo por nonce contabilizado");

    diana_command same = mk("7a2d3d5f-7c2b-4a3f-8c4e-2b3c4d5e6f71", 43, 5000,
                            DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS,
                            T0_MS + 700800);
    k = clk(3300000, 3300100, T0_MS + 700900);
    v = diana_command_validate(&g, &same, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "nonce IGUAL al ultimo tambien se rechaza");

    SECTION("el nonce es POR EMISOR: el coordinador tiene el suyo");
    diana_command coord = mk("9c4f5f71-9e4d-4c5b-ae60-4d5e6f708192", 1, 5000,
                             DIANA_ISSUER_COORDINATOR, DIANA_CMD_SET_TARGETS,
                             T0_MS + 701000);
    k = clk(3400000, 3400100, T0_MS + 701100);
    v = diana_command_validate(&g, &coord, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "nonce 1 del coordinador aceptado pese a backend=43");

    SECTION("H-05: el nonce SOBREVIVE al reinicio (persistido en NVS)");
    CHECK_EQ_INT(diana_command_last_nonce(&g, DIANA_ISSUER_BACKEND), 43,
                 "ultimo nonce del backend en RAM");

    host_reboot(&ctx, &hal, 99, DIANA_RESET_POWERON);
    diana_command_guard g2;
    diana_command_guard_init(&g2, &hal);
    CHECK_EQ_INT(diana_command_last_nonce(&g2, DIANA_ISSUER_BACKEND), 43,
                 "tras reiniciar, el nonce del backend se recupera de NVS");
    CHECK_EQ_INT(diana_command_last_nonce(&g2, DIANA_ISSUER_COORDINATOR), 1,
                 "tras reiniciar, el nonce del coordinador se recupera de NVS");

    /* El ataque que la cache solo-en-RAM permitia: reiniciar el modulo y
     * reinyectar un comando antiguo con un nonce ya consumido. */
    diana_command replay_after_boot =
        mk("ad506082-af5e-4d6c-bf71-5e6f70819250", 40, 5000,
           DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS, T0_MS + 702000);
    k = clk(100000, 100100, T0_MS + 702100);
    v = diana_command_validate(&g2, &replay_after_boot, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "nonce antiguo rechazado TAMBIEN despues de reiniciar");
    printf("       detalle: %s\n", v.detail);

    SECTION("H-05: sin reloj sincronizado se acepta, pero se DICE");
    host_persistent nv3;
    host_hal_ctx ctx3;
    diana_hal hal3;
    host_persistent_reset(&nv3, 8);
    host_hal_init(&ctx3, &nv3, &hal3, 7);
    diana_command_guard g3;
    diana_command_guard_init(&g3, &hal3);

    diana_command noclock = mk("ad506082-af5e-4d6c-bf71-5e6f70819260", 1, 5000,
                               DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY, T0_MS);
    k = clk(1000000, 1000100, 0);   /* epoch_ms = 0: sin sincronizar */
    v = diana_command_validate(&g3, &noclock, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "sin hora, el comando se acepta (no se deja inoperante el modulo)");
    CHECK(strstr(v.detail, "sin hora sincronizada") != NULL,
          "el veredicto declara que la caducidad NO se ha verificado");
    CHECK_EQ_INT(g3.accepted_without_clock, 1,
                 "se contabiliza cuantos se aceptaron sin poder verificar");
    printf("       detalle: %s\n", v.detail);

    /* Sin reloj, la defensa es el nonce persistido: sigue aplicandose. */
    diana_command noclock_replay = mk("ad506082-af5e-4d6c-bf71-5e6f70819261", 1,
                                      5000, DIANA_ISSUER_BACKEND,
                                      DIANA_CMD_IDENTIFY, T0_MS);
    k = clk(2000000, 2000100, 0);
    v = diana_command_validate(&g3, &noclock_replay, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "sin reloj, el nonce sigue bloqueando la reproduccion");

    SECTION("comando emitido en el FUTURO: reloj descuadrado o sobre falso");
    diana_command future = mk("ad506082-af5e-4d6c-bf71-5e6f70819270", 100, 5000,
                              DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY,
                              T0_MS + 120000);   /* 2 min por delante */
    k = clk(4000000, 4000100, T0_MS);
    v = diana_command_validate(&g, &future, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "issued_at_ms muy por delante del modulo se rechaza");
    CHECK_EQ_INT(g.rejected_skew, 1, "descuadre de reloj contabilizado");
    printf("       detalle: %s\n", v.detail);

    diana_command slight = mk("ad506082-af5e-4d6c-bf71-5e6f70819271", 101, 5000,
                              DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY,
                              T0_MS + 5000);   /* 5 s: dentro de tolerancia */
    k = clk(4100000, 4100100, T0_MS);
    v = diana_command_validate(&g, &slight, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "un adelanto pequeno se tolera (relojes nunca son exactos)");

    SECTION("guarda monotonica: orden retenida dentro del propio firmware");
    diana_command held = mk("ad506082-af5e-4d6c-bf71-5e6f70819280", 102, 2000,
                            DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY, T0_MS);
    /* Recibida en t=5 s y procesada en t=8 s: 3 s > 2 s de validez. */
    k = clk(5000000, 8000000, T0_MS + 100);
    v = diana_command_validate(&g, &held, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "expired",
                 "retenida demasiado tiempo por el propio modulo");
    CHECK(strstr(v.detail, "retenido") != NULL, "el detalle lo distingue");

    SECTION("H-07: params obligatorios por accion");
    diana_command_guard g4;
    diana_command_guard_init(&g4, NULL);
    k = clk(1000, 1100, T0_MS + 10);

    diana_command st_no_targets = mk("ad506082-af5e-4d6c-bf71-5e6f70819290", 1,
                                     5000, DIANA_ISSUER_BACKEND,
                                     DIANA_CMD_SET_TARGETS, T0_MS);
    st_no_targets.param_targets = false;
    st_no_targets.param_targets_count = 0;
    v = diana_command_validate(&g4, &st_no_targets, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "set_targets sin params.targets rechazado");
    CHECK_EQ_STR(v.detail, "set_targets exige params.targets", "motivo exacto");

    diana_command st_empty = mk("ad506082-af5e-4d6c-bf71-5e6f70819291", 1, 5000,
                                DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS,
                                T0_MS);
    st_empty.param_targets_count = 0;
    v = diana_command_validate(&g4, &st_empty, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "set_targets con targets vacio rechazado (minItems 1)");

    diana_command all_no_state = mk("ad506082-af5e-4d6c-bf71-5e6f70819292", 1,
                                    5000, DIANA_ISSUER_BACKEND,
                                    DIANA_CMD_SET_ALL_TARGETS, T0_MS);
    all_no_state.param_state = false;
    v = diana_command_validate(&g4, &all_no_state, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "set_all_targets sin params.state rechazado");

    diana_command id_no_dur = mk("ad506082-af5e-4d6c-bf71-5e6f70819293", 1, 5000,
                                 DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY, T0_MS);
    id_no_dur.param_duration_ms = false;
    v = diana_command_validate(&g4, &id_no_dur, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "identify sin params.duration_ms rechazado");

    diana_command mnt_no_en = mk("ad506082-af5e-4d6c-bf71-5e6f70819294", 1, 5000,
                                 DIANA_ISSUER_BACKEND, DIANA_CMD_SET_MAINTENANCE,
                                 T0_MS);
    mnt_no_en.param_enabled = false;
    v = diana_command_validate(&g4, &mnt_no_en, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "set_maintenance sin params.enabled rechazado");
    CHECK_EQ_INT(g4.rejected_params, 5, "5 rechazos por params contabilizados");

    diana_command no_params_ok = mk("ad506082-af5e-4d6c-bf71-5e6f70819295", 1,
                                    5000, DIANA_ISSUER_BACKEND,
                                    DIANA_CMD_SELF_TEST, T0_MS);
    no_params_ok.has_params = false;
    v = diana_command_validate(&g4, &no_params_ok, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "self_test no exige params: aceptado sin ellos");

    SECTION("H-05 c: techo de validez para acciones criticas");
    CHECK(diana_command_is_critical(DIANA_CMD_REBOOT), "reboot es critica");
    CHECK(diana_command_is_critical(DIANA_CMD_SET_MAINTENANCE),
          "set_maintenance es critica");
    CHECK(!diana_command_is_critical(DIANA_CMD_IDENTIFY), "identify no es critica");

    diana_command long_reboot = mk("ad506082-af5e-4d6c-bf71-5e6f708192a0", 2,
                                   600000, DIANA_ISSUER_OPERATOR_CLI,
                                   DIANA_CMD_REBOOT, T0_MS);
    v = diana_command_validate(&g4, &long_reboot, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "reboot con 10 min de validez rechazado (caso T18 del auditor)");
    printf("       detalle: %s\n", v.detail);

    diana_command short_reboot = mk("ad506082-af5e-4d6c-bf71-5e6f708192a1", 3,
                                    5000, DIANA_ISSUER_OPERATOR_CLI,
                                    DIANA_CMD_REBOOT, T0_MS);
    v = diana_command_validate(&g4, &short_reboot, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "reboot con 5 s de validez aceptado");

    diana_command long_identify = mk("ad506082-af5e-4d6c-bf71-5e6f708192a2", 4,
                                     600000, DIANA_ISSUER_BACKEND,
                                     DIANA_CMD_IDENTIFY, T0_MS);
    v = diana_command_validate(&g4, &long_identify, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "identify con 10 min si se acepta: no es critica");

    SECTION("validaciones estructurales");
    diana_command_guard g5;
    diana_command_guard_init(&g5, NULL);

    diana_command bad = mk("no-soy-un-uuid", 100, 5000, DIANA_ISSUER_BACKEND,
                           DIANA_CMD_IDENTIFY, T0_MS);
    v = diana_command_validate(&g5, &bad, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "command_id que no es UUID rechazado");

    diana_command other = mk("ad506082-af5e-4d6c-bf71-5e6f70819266", 101, 5000,
                             DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY, T0_MS);
    snprintf(other.module_id, sizeof(other.module_id), "module-07");
    v = diana_command_validate(&g5, &other, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "comando dirigido a otro modulo rechazado");

    diana_command futver = mk("ad506082-af5e-4d6c-bf71-5e6f70819255", 102, 5000,
                              DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY, T0_MS);
    futver.schema_version = 2;
    v = diana_command_validate(&g5, &futver, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "schema_version superior rechazada (contrato §7)");

    diana_command shortexp = mk("ad506082-af5e-4d6c-bf71-5e6f70819244", 103, 50,
                                DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY, T0_MS);
    v = diana_command_validate(&g5, &shortexp, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "expires_in_ms < 100 rechazado (fuera del rango del contrato)");

    SECTION("la cache de command_id recuerda al menos 128 ordenes");
    diana_command_guard g6;
    diana_command_guard_init(&g6, NULL);
    CHECK_EQ_INT(DIANA_CMD_CACHE, 128, "la cache es de 128, como fija el contrato");

    char cid[DIANA_UUID_LEN];
    for (int i = 0; i < 128; ++i) {
        snprintf(cid, sizeof(cid), "00000000-0000-4000-8000-%012d", i);
        diana_command c = mk(cid, (uint64_t)(i + 1), 5000, DIANA_ISSUER_BACKEND,
                             DIANA_CMD_IDENTIFY, T0_MS);
        diana_command_clock kk = clk(1000, 1100, T0_MS + 10);
        diana_command_validate(&g6, &c, me, &kk);
    }
    CHECK_EQ_INT(g6.accepted, 128, "128 comandos distintos aceptados");
    snprintf(cid, sizeof(cid), "00000000-0000-4000-8000-%012d", 0);
    diana_command replay0 = mk(cid, 200, 5000, DIANA_ISSUER_BACKEND,
                               DIANA_CMD_IDENTIFY, T0_MS);
    v = diana_command_validate(&g6, &replay0, me, &k);
    CHECK_EQ_STR(diana_command_result_str(v.result), "duplicate",
                 "el primero de los 128 sigue recordado");

    return g_tests_failed - before;
}
