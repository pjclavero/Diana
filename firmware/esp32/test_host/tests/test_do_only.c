#include <string.h>

#include "diana/event.h"
#include "diana/sensors.h"
#include "diana/shiftreg.h"
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

    /* --------------------------------------------------------------------
     * RESCATE desde hw/do-only-v1: el convenio de cableado de la cascada
     * estaba solo dentro del bucle de bit-banging de io_hc165.c, que no
     * compila en host y que por tanto ninguna prueba podia tocar.
     * -------------------------------------------------------------------- */
    /* --------------------------------------------------------------------
     * RESCATE desde hw/do-only-v1: contadores de calibracion. Sin amplitud no
     * se puede rechazar crosstalk por software; lo unico honesto es MEDIRLO.
     * -------------------------------------------------------------------- */
    SECTION("contadores de calibracion por diana, multi-trigger y capturas");
    {
        diana_sensor_state cst;
        diana_sensor_state_init(&cst);
        diana_hit_group cg;
        uint64_t t = 10000000;

        CHECK_EQ_INT(cst.diag.capture_count, 0, "arranca sin capturas");
        CHECK_EQ_INT(cst.diag.last_target, 0, "arranca sin ultima diana");

        /* Tres impactos en D4, espaciados por encima del refractario. */
        for (int k = 0; k < 3; ++k) {
            diana_do_process_snapshot(&cst, &cfg, bit_for_target(4),
                                      DIANA_DO_ACTIVE_HIGH, t, &cg);
            CHECK(cg.accepted, "impacto D4 aceptado");
            t += 100000;
            diana_do_process_snapshot(&cst, &cfg, 0, DIANA_DO_ACTIVE_HIGH, t, &cg);
            t += 100000;
        }
        diana_do_process_snapshot(&cst, &cfg, bit_for_target(9),
                                  DIANA_DO_ACTIVE_HIGH, t, &cg);
        CHECK(cg.accepted, "impacto D9 aceptado");
        uint64_t t_d9 = t;
        t += 100000;
        diana_do_process_snapshot(&cst, &cfg, 0, DIANA_DO_ACTIVE_HIGH, t, &cg);
        t += 100000;

        uint16_t both = (uint16_t)(bit_for_target(2) | bit_for_target(7));
        diana_do_process_snapshot(&cst, &cfg, both, DIANA_DO_ACTIVE_HIGH, t, &cg);

        CHECK_EQ_INT(cst.diag.trigger_count[3], 3, "D4 acumula 3 disparos");
        CHECK_EQ_INT(cst.diag.trigger_count[8], 1, "D9 acumula 1 disparo");
        CHECK_EQ_INT(cst.diag.trigger_count[1], 0,
                     "D2 no acumula: el multi-trigger NO se atribuye a nadie");
        CHECK_EQ_INT(cst.diag.trigger_count[6], 0,
                     "D7 tampoco: sin amplitud no se elige un canal");
        CHECK_EQ_INT(cst.diag.last_target, 9,
                     "ultima diana aceptada = D9, el multi no elige ninguna");
        CHECK_EQ_INT(cst.diag.last_trigger_us, t_d9, "marca de tiempo de D9");
        CHECK_EQ_INT(cst.diag.multi_trigger_count, 1, "1 multi-trigger contado");
        CHECK_EQ_INT(cst.diag.last_multi_trigger_us, t, "marca del multi-trigger");
        CHECK_EQ_INT(cst.diag.last_active_bitmap, both,
                     "ultimo bitmap activo = D2+D7");
        CHECK_EQ_INT(cst.diag.capture_count, 9,
                     "9 capturas procesadas: denominador honesto");

        SECTION("los rebotes suprimidos se cuentan, no se pierden en silencio");
        {
            diana_sensor_state bst;
            diana_sensor_state_init(&bst);
            diana_hit_group bg;
            diana_do_process_snapshot(&bst, &cfg, bit_for_target(6),
                                      DIANA_DO_ACTIVE_HIGH, 20000000, &bg);
            CHECK(bg.accepted, "primer impacto D6");
            diana_do_process_snapshot(&bst, &cfg, 0, DIANA_DO_ACTIVE_HIGH,
                                      20000100, &bg);
            diana_do_process_snapshot(&bst, &cfg, bit_for_target(6),
                                      DIANA_DO_ACTIVE_HIGH, 20000500, &bg);
            CHECK(!bg.accepted, "rebote rechazado");
            CHECK_EQ_INT(bst.suppressed_debounce[5], 1,
                         "el rebote suprimido queda contado en D6");
            CHECK_EQ_INT(bst.diag.trigger_count[5], 1,
                         "el rebote NO cuenta como disparo aceptado");
            CHECK_EQ_INT(bst.diag.capture_count, 3,
                         "las tres capturas cuentan, tambien la del rebote");
        }

        SECTION("el reset de contadores no toca el estado de deteccion");
        {
            uint16_t last = cst.do_last_active_bitmap;
            uint64_t blank = cst.blanking_until_us[3];
            diana_sensor_diag_reset(&cst);
            CHECK_EQ_INT(cst.diag.capture_count, 0, "capturas a cero");
            CHECK_EQ_INT(cst.diag.trigger_count[3], 0, "D4 a cero");
            CHECK_EQ_INT(cst.diag.multi_trigger_count, 0, "multi a cero");
            CHECK_EQ_INT(cst.do_last_active_bitmap, last,
                         "el borde activo NO se reinicia");
            CHECK_EQ_INT(cst.blanking_until_us[3], blank,
                         "el refractario de D4 NO se reinicia");
        }
    }

    SECTION("orden de la cascada: #1 QH -> #2 SER -> ESP32 GPIO38");
    {
        diana_shiftreg_cfg sr;
        diana_shiftreg_cfg_defaults(&sr);
        CHECK_EQ_INT(sr.total_bits, DIANA_HC165_BITS,
                     "la trama del modulo coincide con DIANA_HC165_BITS de la placa");

        /* Solo D1 = registro #1 entrada A = ULTIMO bit de la secuencia serie. */
        uint8_t s_d1[DIANA_SR_TOTAL_BITS] = {0};
        s_d1[15] = 1;
        CHECK_EQ_INT(diana_shiftreg_pack(&sr, s_d1, DIANA_SR_TOTAL_BITS), 1u << 0,
                     "ultimo bit de la secuencia = #1 entrada A = D1 (bit 0)");

        /* Solo D8 = registro #1 entrada H = primer bit del bloque del #1. */
        uint8_t s_d8[DIANA_SR_TOTAL_BITS] = {0};
        s_d8[8] = 1;
        CHECK_EQ_INT(diana_shiftreg_pack(&sr, s_d8, DIANA_SR_TOTAL_BITS), 1u << 7,
                     "bit 8 de la secuencia = #1 entrada H = D8 (bit 7)");

        /* Solo D9 = registro #2 entrada A = ultimo bit del bloque del #2. */
        uint8_t s_d9[DIANA_SR_TOTAL_BITS] = {0};
        s_d9[7] = 1;
        CHECK_EQ_INT(diana_shiftreg_pack(&sr, s_d9, DIANA_SR_TOTAL_BITS), 1u << 8,
                     "bit 7 de la secuencia = #2 entrada A = D9 (bit 8)");

        /* Trama de longitud distinta: no se adivina. Se usa s_d9, cuyo bit
         * activo cae DENTRO de los 8 primeros: con s_d1 el resultado seria 0
         * por casualidad y la comprobacion no sabria ponerse roja. */
        CHECK_EQ_INT(diana_shiftreg_pack(&sr, s_d9, 8), 0,
                     "longitud distinta de total_bits -> 0, no se supone nada");


        SECTION("tabla explicita bit -> diana, incluida la reserva");
        for (uint8_t d = 1; d <= DIANA_TARGET_COUNT; ++d) {
            uint8_t bit = diana_shiftreg_target_bit(&sr, d);
            CHECK_EQ_INT(bit, (uint8_t)(d - 1u), "cada diana en su bit");
            CHECK_EQ_INT(diana_shiftreg_bit_target(&sr, bit), d,
                         "el bit devuelve su diana");
        }
        for (uint8_t b = DIANA_TARGET_COUNT; b < DIANA_SR_TOTAL_BITS; ++b) {
            CHECK_EQ_INT(diana_shiftreg_bit_target(&sr, b), 0,
                         "los bits 9-15 son reserva, no diana");
        }
        CHECK_EQ_INT(diana_shiftreg_target_bit(&sr, 0), 0xFF,
                     "diana 0 no existe");

        SECTION("pack equivale al bucle real de io_hc165.c");
        {
            /* Referencia: EXACTAMENTE el bucle de la capa de plataforma.
             * Si alguien cambia uno de los dos, esta prueba se pone roja. */
            static const uint8_t vectores[6][DIANA_SR_TOTAL_BITS] = {
                {0},
                {1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1},
                {0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0},
                {1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0},
                {0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1},
                {1,1,0,0,1,0,0,1,0,1,1,0,0,0,1,1},
            };
            for (size_t v = 0; v < 6; ++v) {
                uint16_t ref = 0;
                for (uint8_t i = 0; i < DIANA_SR_TOTAL_BITS; ++i) {
                    ref = (uint16_t)((ref << 1) | (uint16_t)vectores[v][i]);
                }
                CHECK_EQ_INT(diana_shiftreg_pack(&sr, vectores[v],
                                                 DIANA_SR_TOTAL_BITS),
                             ref, "pack reproduce el bucle de la ISR");
            }
        }

        SECTION("la palabra empaquetada alimenta la decodificacion DO");
        {
            uint8_t s_d5[DIANA_SR_TOTAL_BITS] = {0};
            s_d5[11] = 1;  /* #1 entrada E -> D5 -> bit 4 */
            uint16_t raw = diana_shiftreg_pack(&sr, s_d5, DIANA_SR_TOTAL_BITS);
            diana_do_snapshot s;
            diana_do_decode(raw, DIANA_DO_ACTIVE_HIGH, &s);
            CHECK_EQ_INT(s.active_count, 1, "una diana desde la trama serie");
            CHECK_EQ_INT(s.active_channels[0], 5, "la trama serie de D5 da D5");
        }
    }

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
