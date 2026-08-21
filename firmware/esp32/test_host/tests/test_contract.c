/**
 * @file test_contract.c
 * @brief Conformidad con el contrato CONGELADO.
 *
 * Genera un ejemplar de CADA mensaje que el firmware publica y lo vuelca a
 * disco. La validacion contra los JSON Schema reales la ejecuta despues
 * tools/validate_messages.py (make contracts). Aqui se comprueban ademas los
 * invariantes que el firmware puede romper por su cuenta.
 */
#include <string.h>

#include "diana/ids.h"
#include "diana/messages.h"
#include "diana/queue.h"
#include "diana/command.h"
#include "hal_host.h"
#include "test_util.h"

int run_contract(void)
{
    TEST_SUITE("contract");
    int before = g_tests_failed;

    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 16);
    host_hal_init(&ctx, &nv, &hal, 20260720);
    host_mqtt_set_connected(&ctx, true);

    diana_identity id;
    diana_identity_load(&id, &hal, "0.1.0");
    diana_identity_provision(&id, &hal, "module-03", "system-a", "DIANA-M03-0001",
                             "protoA", "module-module-03", "secreto");

    diana_config cfg;
    diana_config_defaults(&cfg);
    cfg.config_version = 7;
    snprintf(cfg.system_id, sizeof(cfg.system_id), "system-a");
    cfg.has_position = true;
    cfg.position_x = -1;
    cfg.position_y = 0;
    cfg.rotation = 90;
    snprintf(cfg.friendly_name, sizeof(cfg.friendly_name), "Modulo izquierda");

    diana_module_fsm fsm;
    diana_module_fsm_init(&fsm, 0);
    diana_module_fsm_apply(&fsm, DIANA_EV_SELFTEST_START, 0);
    diana_module_fsm_apply(&fsm, DIANA_EV_SELFTEST_OK, 0);
    diana_module_fsm_apply(&fsm, DIANA_EV_MQTT_CONNECTED, 0);
    diana_module_fsm_apply(&fsm, DIANA_EV_REGISTERED, 0);

    diana_target_set targets;
    diana_target_set_init(&targets, 0);
    for (int i = 0; i < DIANA_TARGET_COUNT; ++i)
        diana_target_apply(&targets.t[i], DIANA_TEV_ENABLE, 0);

    char buf[DIANA_MSG_JSON_MAX];

    SECTION("module-status");
    diana_status_input si;
    memset(&si, 0, sizeof(si));
    si.id = &id;
    si.fsm = &fsm;
    si.targets = &targets;
    si.cfg = &cfg;
    si.selector = DIANA_SELECTOR_SATELITE;
    si.role = diana_role_from_selector(DIANA_SELECTOR_SATELITE);
    si.queue_depth = 0;
    si.uptime_s = 3600;
    si.has_last_command = true;
    snprintf(si.last_command_id, sizeof(si.last_command_id),
             "ad506082-af5e-4d6c-bf71-5e6f70819203");
    si.last_command_result = diana_command_result_str(DIANA_CMD_RESULT_ACCEPTED);

    size_t n = diana_status_json(&si, buf, sizeof(buf));
    CHECK(n > 0, "module-status serializado");
    CHECK(strstr(buf, "\"role\":\"satellite\"") != NULL,
          "selector SATELITE resuelve a rol satellite");
    CHECK(strstr(buf, "\"selector\":\"SATELITE\"") != NULL, "selector en mayusculas");
    dump_message("module-status.schema.json", "module_status_ready", buf);

    SECTION("selector PRINCIPAL y AUTO");
    CHECK_EQ_STR(diana_role_str(diana_role_from_selector(DIANA_SELECTOR_PRINCIPAL)),
                 "principal", "PRINCIPAL -> principal");
    CHECK_EQ_STR(diana_role_str(diana_role_from_selector(DIANA_SELECTOR_AUTO)),
                 "auto", "AUTO -> auto (se resuelve por eleccion, no es rol final)");

    si.selector = DIANA_SELECTOR_PRINCIPAL;
    si.role = diana_role_from_selector(DIANA_SELECTOR_PRINCIPAL);
    n = diana_status_json(&si, buf, sizeof(buf));
    CHECK(n > 0, "module-status con rol principal");
    dump_message("module-status.schema.json", "module_status_principal", buf);

    SECTION("module-telemetry");
    diana_telemetry_input ti;
    memset(&ti, 0, sizeof(ti));
    ti.id = &id;
    ti.uptime_s = 3600;
    ti.uptime_us = 3600000000ULL;
    hal.health(hal.ctx, &ti.health);
    ti.link_up = true;
    ti.mqtt_reconnects = 0;
    ti.queue_depth = 0;
    for (int c = 0; c < DIANA_LED_CHAINS; ++c) {
        ti.chain_ok[c] = true;
        ti.chain_current_ma[c] = 380;
    }
    ti.has_chain_current = true;
    n = diana_telemetry_json(&ti, buf, sizeof(buf));
    CHECK(n > 0, "module-telemetry serializado");
    dump_message("module-telemetry.schema.json", "telemetry_nominal", buf);

    SECTION("module-diagnostic: causa de reinicio y desbordamiento de cola");
    diana_diagnostic d;
    diana_diagnostic_init(&d, &hal, DIANA_DIAG_RESET_REASON, DIANA_SEV_INFO,
                          "arranque tras reinicio por watchdog");
    d.detail_keys[0] = "reset_reason";
    d.detail_str[0] = diana_reset_reason_str(DIANA_RESET_WATCHDOG);
    d.detail_count = 1;
    n = diana_diagnostic_json(&d, &id, 1500000, buf, sizeof(buf));
    CHECK(n > 0, "diagnostic reset_reason serializado");
    CHECK(strstr(buf, "watchdog") != NULL, "incluye la causa del reinicio");
    dump_message("module-diagnostic.schema.json", "diag_reset_reason", buf);

    diana_diagnostic q;
    diana_diagnostic_init(&q, &hal, DIANA_DIAG_QUEUE_OVERFLOW, DIANA_SEV_WARNING,
                          "cola local llena: se descarta el evento mas antiguo");
    q.detail_keys[0] = "dropped";
    q.detail_str[0] = NULL;
    q.detail_num[0] = 2;
    q.detail_keys[1] = "capacity";
    q.detail_str[1] = NULL;
    q.detail_num[1] = 4;
    q.detail_count = 2;
    n = diana_diagnostic_json(&q, &id, 1600000, buf, sizeof(buf));
    CHECK(n > 0, "diagnostic queue_overflow serializado");
    dump_message("module-diagnostic.schema.json", "diag_queue_overflow", buf);

    /* ------------------------------------------------------------------
     * command_rejected: el contrato exige request_id y detail{accepted,reason}.
     * El diagnostico se construye desde un RECHAZO REAL, no a mano: asi se
     * comprueba que el identificador y el motivo se PROPAGAN de verdad desde
     * el comando hasta el payload, y no solo que los campos existen.
     * ------------------------------------------------------------------ */
    SECTION("command_rejected correlado con la orden que lo causo");
    diana_command_guard guard;
    diana_command_guard_init(&guard, &hal);

    diana_command c1;
    memset(&c1, 0, sizeof(c1));
    snprintf(c1.command_id, sizeof(c1.command_id),
             "3f1c2b6a-77aa-4c1d-9e55-0b2d4a6c8e11");
    c1.schema_version = 1;
    c1.issued_at_ms = 1784500000000ULL;
    c1.expires_in_ms = 30000;
    c1.nonce = 42;
    c1.issuer = DIANA_ISSUER_BACKEND;
    snprintf(c1.module_id, sizeof(c1.module_id), "module-03");
    c1.action = DIANA_CMD_CLEAR_ERROR;
    /* {recv_us, now_us, epoch_ms}: recibido y procesado al instante, con
     * hora de pared justo posterior al issued_at del comando. */
    diana_command_clock k = {1000000, 1000500, 1784500000100ULL};
    diana_command_verdict ok = diana_command_validate(&guard, &c1, "module-03", &k);
    CHECK_EQ_INT(ok.result, DIANA_CMD_RESULT_ACCEPTED, "el primer comando entra");

    /* Reenvio con nonce viejo: rechazo REAL, con su motivo y su identificador. */
    diana_command c2 = c1;
    snprintf(c2.command_id, sizeof(c2.command_id),
             "9b7e4d21-5c33-4a90-8f21-6ad1c0e77b42");
    c2.nonce = 41;
    diana_command_verdict rej = diana_command_validate(&guard, &c2, "module-03", &k);
    CHECK(rej.result != DIANA_CMD_RESULT_ACCEPTED, "el reenvio se rechaza");
    CHECK_EQ_STR(diana_command_reject_reason_str(rej.reason), "duplicate",
                 "motivo del vocabulario CERRADO del contrato");

    diana_diagnostic cr;
    CHECK(diana_diagnostic_command_rejected(&cr, &hal, c2.command_id, rej.reason,
                                            rej.detail),
          "el diagnostico se construye desde el rechazo real");
    CHECK_EQ_STR(cr.request_id, c2.command_id,
                 "CORRELACION: request_id es el de LA orden rechazada");
    CHECK(strcmp(cr.request_id, c1.command_id) != 0,
          "y NO el de la orden anterior, que si se acepto");
    n = diana_diagnostic_json(&cr, &id, 1700000, buf, sizeof(buf));
    CHECK(n > 0, "diagnostic command_rejected serializado");
    {
        char want[128];
        snprintf(want, sizeof(want), "\"request_id\":\"%s\"", c2.command_id);
        CHECK(strstr(buf, want) != NULL,
              "el payload lleva el request_id de la orden rechazada");
        /* Aparece dos veces: al nivel superior y dentro de detail. */
        const char *first = strstr(buf, want);
        CHECK(first && strstr(first + 1, want) != NULL,
              "y se repite dentro de detail, como pide el contrato");
    }
    CHECK(strstr(buf, "\"accepted\":false") != NULL,
          "detail.accepted es false, no un texto libre");
    CHECK(strstr(buf, "\"reason\":\"duplicate\"") != NULL,
          "detail.reason con el literal exacto del enum");
    CHECK(strstr(buf, "nonce 41") != NULL,
          "la explicacion literal NO se pierde: viaja en message");
    dump_message("module-diagnostic.schema.json", "diag_command_rejected", buf);

    SECTION("un command_rejected incorrelable NO se puede publicar");
    diana_diagnostic bad_diag;
    CHECK(!diana_diagnostic_command_rejected(&bad_diag, &hal, "no-es-un-uuid",
                                             DIANA_REJECT_DUPLICATE, "x"),
          "sin UUID valido no se construye: no se inventa un identificador");
    diana_diagnostic naked;
    diana_diagnostic_init(&naked, &hal, DIANA_DIAG_COMMAND_REJECTED,
                          DIANA_SEV_WARNING, "rechazo sin correlacion");
    CHECK_EQ_INT(diana_diagnostic_json(&naked, &id, 1700000, buf, sizeof(buf)), 0,
                 "el serializador se NIEGA: no hay camino alternativo");

    SECTION("los diagnosticos espontaneos siguen SIN request_id");
    diana_diagnostic boot;
    diana_diagnostic_init(&boot, &hal, DIANA_DIAG_BOOT, DIANA_SEV_INFO,
                          "arranque");
    n = diana_diagnostic_json(&boot, &id, 1700000, buf, sizeof(buf));
    CHECK(n > 0, "el diagnostico espontaneo se serializa");
    CHECK(strstr(buf, "request_id") == NULL,
          "no responde a ninguna orden: el campo NO se inventa");

    SECTION("cada rechazo elige su motivo en el punto de rechazo");
    {
        diana_command_guard g2;
        diana_command_guard_init(&g2, &hal);
        diana_command other = c1;
        snprintf(other.command_id, sizeof(other.command_id),
                 "11111111-2222-4333-8444-555555555555");
        snprintf(other.module_id, sizeof(other.module_id), "module-07");
        other.nonce = 100;
        diana_command_verdict vm =
            diana_command_validate(&g2, &other, "module-03", &k);
        CHECK_EQ_STR(diana_command_reject_reason_str(vm.reason), "module_mismatch",
                     "orden dirigida a otro modulo -> module_mismatch");

        diana_command bad_ver = c1;
        snprintf(bad_ver.command_id, sizeof(bad_ver.command_id),
                 "22222222-3333-4444-8555-666666666666");
        bad_ver.schema_version = 2;
        diana_command_verdict vv =
            diana_command_validate(&g2, &bad_ver, "module-03", &k);
        CHECK_EQ_STR(diana_command_reject_reason_str(vv.reason), "unknown_command",
                     "sobre de una version que este firmware no interpreta");

        diana_command bad_exp = c1;
        snprintf(bad_exp.command_id, sizeof(bad_exp.command_id),
                 "33333333-4444-4555-8666-777777777777");
        bad_exp.expires_in_ms = 10;
        diana_command_verdict ve =
            diana_command_validate(&g2, &bad_exp, "module-03", &k);
        CHECK_EQ_STR(diana_command_reject_reason_str(ve.reason),
                     "params_out_of_range", "expires_in_ms fuera de rango");
    }

    diana_diagnostic ot;
    diana_diagnostic_init(&ot, &hal, DIANA_DIAG_OTA_RESULT, DIANA_SEV_ERROR,
                          "OTA rechazada: partida en curso");
    n = diana_diagnostic_json(&ot, &id, 1800000, buf, sizeof(buf));
    CHECK(n > 0, "diagnostic ota_result serializado");
    dump_message("module-diagnostic.schema.json", "diag_ota_result", buf);

    SECTION("config/reported refleja lo aplicado, sin fingir calibracion");
    n = diana_config_reported_json(&cfg, id.module_id, NULL, buf, sizeof(buf));
    CHECK(n > 0, "config/reported serializado");
    CHECK(strstr(buf, "\"calibrated_at\":null") != NULL,
          "sin calibrar => calibrated_at null, no una fecha inventada");
    dump_message("module-config.schema.json", "config_reported", buf);

    SECTION("hit-event completo del COORDINADOR sobre su propio impacto");
    /* H-01: el bloque coordinator solo va embebido cuando el detector ES el
     * coordinador. Aqui module-03 actua como principal sobre su propio hit. */
    diana_hit_group grp;
    diana_piezo_trigger trigs[2] = {{7, 1832456712, 2710}, {4, 1832457332, 410}};
    diana_sensor_classify(&cfg, trigs, 2, &grp);
    diana_hit_event ev;
    diana_hit_event_build(&ev, &hal, &id, &grp, DIANA_TARGET_ACTIVE, 1832456789);
    ev.has_game = true;
    diana_uuid4(&hal, ev.game_id);
    ev.has_round = true;
    diana_uuid4(&hal, ev.round_id);
    ev.has_position = true;
    ev.position_x = -1;
    ev.position_y = 0;
    ev.has_rotation = true;
    ev.rotation = 90;

    diana_coordinator_time t2 = {
        .recv_us = 1832459000,
        .elapsed_us = 4210556,
        .clock_offset_us = -312,   /* 0 si el propio principal detecto */
        .has_uncertainty = true,
        .offset_uncertainty_us = 90,
    };
    CHECK(diana_hit_event_attach_coordinator(&ev, DIANA_ROLE_PRINCIPAL,
                                             id.module_id, &t2),
          "el coordinador adjunta T2 a su propio impacto");

    CHECK_EQ_INT(diana_hit_event_check(&ev), 0, "el evento pasa la comprobacion local");
    n = diana_hit_event_to_json(&ev, buf, sizeof(buf));
    CHECK(n > 0, "hit-event consolidado serializado");
    CHECK(strstr(buf, "\"elapsed_us\":4210556") != NULL,
          "elapsed_us lo aporta el coordinador (ADR-0002)");
    dump_message("hit-event.schema.json", "hit_consolidated", buf);

    SECTION("un evento no conforme NO se publica");
    diana_hit_event bad = ev;
    bad.classification = DIANA_HIT_ON_SAFE;
    bad.classification_reason[0] = '\0';
    CHECK(diana_hit_event_check(&bad) != 0,
          "clasificacion distinta de valid_hit sin motivo se rechaza");

    diana_hit_event bad2 = ev;
    bad2.target_index = 12;
    CHECK(diana_hit_event_check(&bad2) != 0, "target_index fuera de 1..9 se rechaza");

    diana_hit_event bad3 = ev;
    snprintf(bad3.module_id, sizeof(bad3.module_id), "Module_03");
    CHECK(diana_hit_event_check(&bad3) != 0,
          "module_id que no cumple el patron identifier se rechaza");

    diana_hit_event bad4 = ev;
    snprintf(bad4.firmware_version, sizeof(bad4.firmware_version), "v0.1");
    CHECK(diana_hit_event_check(&bad4) != 0, "firmware_version no semver se rechaza");

    SECTION("validadores de patron del contrato");
    CHECK(diana_is_identifier("module-03"), "identifier valido");
    CHECK(!diana_is_identifier("Module-03"), "mayusculas invalidas");
    CHECK(!diana_is_identifier("mo"), "menos de 3 caracteres invalido");
    CHECK(!diana_is_identifier("-module"), "no puede empezar por guion");
    CHECK(!diana_is_identifier("module/03"), "la barra invalida (romperia el topico)");
    CHECK(!diana_is_identifier("module+03"), "el + invalido (comodin MQTT)");
    CHECK(!diana_is_identifier("module#03"), "el # invalido (comodin MQTT)");
    CHECK(diana_is_uuid("9c4f5f71-9e4d-4c5b-ae60-4d5e6f708192"), "uuid valido");
    CHECK(!diana_is_uuid("9c4f5f71-9e4d-4c5b-ae60-4d5e6f70819"), "uuid corto invalido");
    CHECK(diana_is_semver("0.1.0"), "semver valido");
    CHECK(diana_is_semver("1.2.3-rc.1"), "semver con prerelease valido");
    CHECK(!diana_is_semver("0.1"), "semver incompleto invalido");
    CHECK(diana_is_sha256_hex(
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
          "sha256 valido");
    CHECK(!diana_is_sha256_hex("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"),
          "sha256 en mayusculas invalido (el patron exige minusculas)");

    SECTION("ULID tambien es un event_id valido");
    char ulid[27];
    diana_ulid(&hal, 1784500000000ULL, ulid);
    CHECK(diana_is_event_id(ulid), "el ULID generado cumple el patron eventId");
    CHECK_EQ_INT(strlen(ulid), 26, "ULID de 26 caracteres");

    return g_tests_failed - before;
}
