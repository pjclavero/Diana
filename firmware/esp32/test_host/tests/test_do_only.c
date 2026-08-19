#include <string.h>

#include "diana/event.h"
#include "diana/sensors.h"
#include "hal_host.h"
#include "test_util.h"

#define SPI2_HOST 2
#include "esp32s3_proto_do_w5500.h"

static uint16_t bit_for_target(uint8_t target)
{
    return (uint16_t)(1u << (target - 1u));
}

int run_do_only(void)
{
    TEST_SUITE("do_only");
    int before = g_tests_failed;

    diana_config cfg;
    diana_config_defaults(&cfg);
    diana_sensor_state st;
    diana_sensor_state_init(&st);

    SECTION("perfil DIANA_BOARD_PROTO_DO_W5500 sin ADC ni piezo analogico");
    CHECK_EQ_INT(DIANA_BOARD_PROTO_DO_W5500, 1, "perfil prototipo DO-only activo");
    CHECK_EQ_STR(DIANA_BOARD_NAME, "proto-do-w5500", "nombre de placa OTA");
    CHECK_EQ_INT(DIANA_PIN_LED_ROW0, 4, "GPIO4 LED fila D1-D3");
    CHECK_EQ_INT(DIANA_PIN_LED_ROW1, 5, "GPIO5 LED fila D4-D6");
    CHECK_EQ_INT(DIANA_PIN_LED_ROW2, 6, "GPIO6 LED fila D7-D9");
    CHECK_EQ_INT(DIANA_PIN_ETH_RST, 8, "GPIO8 W5500 RST");
    CHECK_EQ_INT(DIANA_PIN_ETH_INT, 9, "GPIO9 W5500 INT");
    CHECK_EQ_INT(DIANA_PIN_ETH_CS, 10, "GPIO10 W5500 CS");
    CHECK_EQ_INT(DIANA_PIN_ETH_MOSI, 11, "GPIO11 W5500 MOSI");
    CHECK_EQ_INT(DIANA_PIN_ETH_SCLK, 12, "GPIO12 W5500 SCK");
    CHECK_EQ_INT(DIANA_PIN_ETH_MISO, 13, "GPIO13 W5500 MISO");
    CHECK_EQ_INT(DIANA_PIN_SELECTOR_A, 15, "GPIO15 selector 1");
    CHECK_EQ_INT(DIANA_PIN_SELECTOR_B, 16, "GPIO16 selector 2");
    CHECK_EQ_INT(DIANA_PIN_BUTTON_ID, 17, "GPIO17 IDENTIFY");
    CHECK_EQ_INT(DIANA_PIN_HC165_DATA, 38, "GPIO38 HC165 DATA");
    CHECK_EQ_INT(DIANA_PIN_HC165_LOAD, 47, "GPIO47 HC165 LOAD");
    CHECK_EQ_INT(DIANA_PIN_HC165_CLK, 48, "GPIO48 HC165 CLK");
#ifdef DIANA_ADC_CH_MUX
    CHECK(false, "el perfil DO-only no debe definir ADC de impacto");
#else
    CHECK(true, "sin DIANA_ADC_CH_MUX");
#endif

    SECTION("D1-D9 mapean a bit0-bit8 con polaridad active-high");
    for (uint8_t target = 1; target <= DIANA_TARGET_COUNT; ++target) {
        diana_do_snapshot s;
        diana_do_decode(bit_for_target(target), DIANA_DO_ACTIVE_HIGH, &s);
        CHECK_EQ_INT(s.active_count, 1, "un unico canal activo");
        CHECK_EQ_INT(s.active_channels[0], target, "target segun bitmap");
        CHECK_EQ_INT(s.active_bitmap, bit_for_target(target), "bitmap preservado");
    }

    SECTION("bits 9-15 reservados se ignoran");
    diana_do_snapshot reserved;
    diana_do_decode(0xfe00u, DIANA_DO_ACTIVE_HIGH, &reserved);
    CHECK_EQ_INT(reserved.active_bitmap, 0, "reservados no generan impactos");
    CHECK_EQ_INT(reserved.active_count, 0, "sin canales activos");

    SECTION("active-low invierte solo los 9 bits utiles");
    diana_do_snapshot low;
    diana_do_decode((uint16_t)~bit_for_target(4), DIANA_DO_ACTIVE_LOW, &low);
    CHECK_EQ_INT(low.active_count, 1, "active-low detecta un canal");
    CHECK_EQ_INT(low.active_channels[0], 4, "D4 detectada active-low");

    SECTION("ningun bit -> ningun impacto");
    diana_hit_group g;
    diana_do_process_snapshot(&st, &cfg, 0, DIANA_DO_ACTIVE_HIGH, 1000000, &g);
    CHECK(!g.accepted, "snapshot vacio no se acepta");
    CHECK_EQ_INT(g.target_index, 0, "no se asigna target");

    SECTION("D1 -> target 1, D9 -> target 9 sin amplitud inventada");
    diana_sensor_state_init(&st);
    diana_do_process_snapshot(&st, &cfg, bit_for_target(1), DIANA_DO_ACTIVE_HIGH,
                              2000000, &g);
    CHECK(g.accepted, "D1 aceptada");
    CHECK_EQ_INT(g.target_index, 1, "D1 target_index 1");
    CHECK(!g.has_amplitude, "sin amplitud en DO-only");
    CHECK(!g.has_threshold, "sin umbral ADC en DO-only");

    diana_do_process_snapshot(&st, &cfg, 0, DIANA_DO_ACTIVE_HIGH, 2065000, &g);
    diana_do_process_snapshot(&st, &cfg, bit_for_target(9), DIANA_DO_ACTIVE_HIGH,
                              2120000, &g);
    CHECK(g.accepted, "D9 aceptada tras refractory");
    CHECK_EQ_INT(g.target_index, 9, "D9 target_index 9");

    SECTION("D1+D2 -> MULTI_TRIGGER diagnostico/no puntuable");
    diana_sensor_state_init(&st);
    diana_do_process_snapshot(&st, &cfg, bit_for_target(1) | bit_for_target(2),
                              DIANA_DO_ACTIVE_HIGH, 3000000, &g);
    CHECK(!g.accepted, "multi-trigger no se acepta");
    CHECK_EQ_INT(g.target_index, 0, "no se elige bit menor ni primero");
    CHECK(strstr(g.reason, "MULTI_TRIGGER") != NULL, "motivo MULTI_TRIGGER");
    CHECK_EQ_INT(g.active_count, 2, "dos canales activos registrados");

    SECTION("rebote -> un unico evento; nuevo impacto tras refractory");
    diana_sensor_state_init(&st);
    diana_do_process_snapshot(&st, &cfg, bit_for_target(3), DIANA_DO_ACTIVE_HIGH,
                              4000000, &g);
    CHECK(g.accepted, "primer impacto D3");
    diana_do_process_snapshot(&st, &cfg, 0, DIANA_DO_ACTIVE_HIGH, 4000100, &g);
    diana_do_process_snapshot(&st, &cfg, bit_for_target(3), DIANA_DO_ACTIVE_HIGH,
                              4000500, &g);
    CHECK(!g.accepted, "rebote dentro de ventana rechazado");
    diana_do_process_snapshot(&st, &cfg, 0, DIANA_DO_ACTIVE_HIGH, 4061000, &g);
    diana_do_process_snapshot(&st, &cfg, bit_for_target(3), DIANA_DO_ACTIVE_HIGH,
                              4062000, &g);
    CHECK(g.accepted, "nuevo impacto tras refractory");

    SECTION("selector 2 posiciones actual");
    diana_selector_position pos = DIANA_SELECTOR_AUTO;
    CHECK_EQ_INT(diana_selector_decode(0, 1, DIANA_SELECTOR_2_POSITION, &pos),
                 DIANA_HAL_OK, "LOW/HIGH valido");
    CHECK_EQ_STR(diana_selector_str(pos), "PRINCIPAL", "LOW/HIGH -> PRINCIPAL");
    CHECK_EQ_INT(diana_selector_decode(1, 0, DIANA_SELECTOR_2_POSITION, &pos),
                 DIANA_HAL_OK, "HIGH/LOW valido");
    CHECK_EQ_STR(diana_selector_str(pos), "SATELITE", "HIGH/LOW -> SATELITE");
    CHECK(diana_selector_decode(1, 1, DIANA_SELECTOR_2_POSITION, &pos) != 0,
          "HIGH/HIGH invalido en SPDT actual");
    CHECK(diana_selector_decode(0, 0, DIANA_SELECTOR_2_POSITION, &pos) != 0,
          "LOW/LOW invalido");

    SECTION("selector 3 posiciones futuro");
    CHECK_EQ_INT(diana_selector_decode(1, 1, DIANA_SELECTOR_3_POSITION, &pos),
                 DIANA_HAL_OK, "HIGH/HIGH valido con ON-OFF-ON");
    CHECK_EQ_STR(diana_selector_str(pos), "AUTO", "HIGH/HIGH -> AUTO");
    CHECK(diana_selector_decode(0, 0, DIANA_SELECTOR_3_POSITION, &pos) != 0,
          "LOW/LOW sigue siendo error");

    SECTION("IDENTIFY activo bajo via HAL host");
    host_persistent nv;
    host_hal_ctx ctx;
    diana_hal hal;
    host_persistent_reset(&nv, 4);
    host_hal_init(&ctx, &nv, &hal, 9);
    ctx.button = false;
    CHECK(!hal.button_pressed(hal.ctx), "sin pulsar = HIGH/no activo");
    ctx.button = true;
    CHECK(hal.button_pressed(hal.ctx), "pulsado = LOW/activo");

    SECTION("hit-event digital omite amplitud y umbral");
    diana_identity id;
    diana_identity_load(&id, &hal, "0.1.0");
    diana_identity_provision(&id, &hal, "module-03", "system-a", "S", "proto-do",
                             "u", "p");
    diana_sensor_state_init(&st);
    diana_do_process_snapshot(&st, &cfg, bit_for_target(5), DIANA_DO_ACTIVE_HIGH,
                              5000000, &g);
    diana_hit_event ev;
    diana_hit_event_build(&ev, &hal, &id, &g, DIANA_TARGET_ACTIVE, 5000010);
    CHECK_EQ_INT(diana_hit_event_check(&ev), 0, "evento digital valido localmente");
    char json[DIANA_HIT_JSON_MAX];
    size_t n = diana_hit_event_to_json(&ev, json, sizeof(json));
    CHECK(n > 0, "evento digital serializado");
    CHECK(strstr(json, "\"amplitude\"") == NULL, "sin campo amplitude");
    CHECK(strstr(json, "\"threshold\"") == NULL, "sin campo threshold");
    dump_message("hit-event.schema.json", "hit_digital_do", json);

    return g_tests_failed - before;
}
