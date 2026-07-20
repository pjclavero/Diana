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

    diana_diagnostic cr;
    diana_diagnostic_init(&cr, &hal, DIANA_DIAG_COMMAND_REJECTED, DIANA_SEV_WARNING,
                          "nonce 41 <= ultimo aceptado 42 de backend");
    n = diana_diagnostic_json(&cr, &id, 1700000, buf, sizeof(buf));
    CHECK(n > 0, "diagnostic command_rejected serializado");
    dump_message("module-diagnostic.schema.json", "diag_command_rejected", buf);

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

    SECTION("hit-event completo, con coordinador (caso del modulo principal)");
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
    /* T2: lo rellena el PRINCIPAL al consolidar, nunca el backend. */
    ev.has_coordinator = true;
    ev.coordinator.recv_us = 1832459000;
    ev.coordinator.elapsed_us = 4210556;
    ev.coordinator.clock_offset_us = -312;
    ev.coordinator.has_uncertainty = true;
    ev.coordinator.offset_uncertainty_us = 90;

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
