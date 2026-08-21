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
    /* Pines de reserva: NO se cablean en V1 y NO pueden solaparse con nada. */
    CHECK_EQ_INT(DIANA_PIN_RESERVED_IRQ_ANY, 7, "GPIO7 reservado IRQ_ANY, sin cablear");
    CHECK_EQ_INT(DIANA_PIN_RESERVED_A, 14, "GPIO14 libre (era nCS_ADC)");
    CHECK_EQ_INT(DIANA_PIN_RESERVED_B, 21, "GPIO21 libre (era VREF_TH_PWM)");
    {
        const int usados[] = {
            DIANA_PIN_LED_ROW0, DIANA_PIN_LED_ROW1, DIANA_PIN_LED_ROW2,
            DIANA_PIN_ETH_RST, DIANA_PIN_ETH_INT, DIANA_PIN_ETH_CS,
            DIANA_PIN_ETH_MOSI, DIANA_PIN_ETH_SCLK, DIANA_PIN_ETH_MISO,
            DIANA_PIN_SELECTOR_A, DIANA_PIN_SELECTOR_B, DIANA_PIN_BUTTON_ID,
            DIANA_PIN_HC165_DATA, DIANA_PIN_HC165_LOAD, DIANA_PIN_HC165_CLK,
        };
        const int reservados[] = {
            DIANA_PIN_RESERVED_IRQ_ANY, DIANA_PIN_RESERVED_A, DIANA_PIN_RESERVED_B,
        };
        int solapes = 0;
        for (size_t a = 0; a < sizeof(usados) / sizeof(usados[0]); ++a) {
            for (size_t b = 0; b < sizeof(reservados) / sizeof(reservados[0]); ++b) {
                if (usados[a] == reservados[b]) solapes++;
            }
        }
        CHECK_EQ_INT(solapes, 0, "ningun pin de reserva pisa una funcion en uso");
    }
#ifdef DIANA_ADC_CH_MUX
    CHECK(false, "el perfil DO-only no debe definir ADC de impacto");
#else
    CHECK(true, "sin DIANA_ADC_CH_MUX");
#endif

    /* --------------------------------------------------------------------
     * ADR-0007 · CONTRACT_GAP-FW-DETECTION-METHOD.
     * -------------------------------------------------------------------- */
    SECTION("el perfil de deteccion sale de la PLACA y coincide con la ruta");
    CHECK_EQ_INT(DIANA_DETECTION_PROFILE, DIANA_DETECT_DIGITAL_THRESHOLD,
                 "la placa fisica DO-only se declara digital_threshold");
    CHECK_EQ_STR(diana_detection_method_str(DIANA_DETECTION_PROFILE),
                 "digital_threshold",
                 "literal EXACTO del enum de hit-event.schema.json (ADR-0007)");
    CHECK_EQ_STR(diana_detection_method_str(DIANA_DETECT_ANALOG_ENVELOPE),
                 "analog_envelope", "literal EXACTO del perfil analogico");
    {
        /* La ruta que detecta ESTAMPA el perfil. Si la placa dijera una cosa y
         * la ruta hiciera otra, el discriminador seria una etiqueta decorativa. */
        diana_sensor_state pst;
        diana_sensor_state_init(&pst);
        diana_hit_group pg;
        diana_do_process_snapshot(&pst, &cfg, bit_for_target(1),
                                  DIANA_DO_ACTIVE_HIGH, 1500000, &pg);
        CHECK_EQ_INT(pg.detection_method, DIANA_DETECTION_PROFILE,
                     "la ruta 74HC165 estampa el perfil que declara la placa");

        /* Y la ruta analogica estampa el otro, tambien sin preguntar a nadie. */
        diana_config acfg2;
        diana_config_defaults(&acfg2);
        diana_piezo_trigger atrig = {3, 900, 2500};
        diana_hit_group agrp;
        diana_sensor_classify(&acfg2, &atrig, 1, &agrp);
        CHECK_EQ_INT(agrp.detection_method, DIANA_DETECT_ANALOG_ENVELOPE,
                     "la ruta con ADC estampa analog_envelope");
    }

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
    /* ADR-0007: este payload lleva detection_method y por tanto SOLO es valido
     * contra el contrato reconciliado. Se valida en su propio pase; el contrato
     * congelado de esta base no conoce el campo. */
    dump_message_adr0007("hit-event.schema.json", "hit_digital_do", json);

    /* --------------------------------------------------------------------
     * RESCATE desde hw/do-only-v1: prueba ANTIRREGRESION del ADC.
     * Se pone roja si alguien reintroduce una lectura de amplitud en la ruta
     * de impacto de V1. Se hace con el HAL COMPLETO (piezo_amplitude
     * DISPONIBLE) a proposito: con el puntero a NULL, una llamada protegida
     * por guarda (`if (hal->piezo_amplitude) ...`) pasaria inadvertida.
     * -------------------------------------------------------------------- */
    SECTION("antirregresion: la ruta DO-only NO lee el ADC ni una vez");
    CHECK(hal.piezo_amplitude != NULL,
          "el HAL de host SI ofrece el ADC: la prueba no es vacia");
    ctx.piezo_reads = 0;
    diana_sensor_state ast;
    diana_sensor_state_init(&ast);
    diana_hit_group ag;
    uint64_t at = 6000000;
    int ahits = 0;
    for (uint8_t d = 1; d <= DIANA_TARGET_COUNT; ++d) {
        diana_do_process_snapshot(&ast, &cfg, bit_for_target(d),
                                  DIANA_DO_ACTIVE_HIGH, at, &ag);
        if (ag.accepted && ag.target_index == d) ahits++;
        at += 100000;
        diana_do_process_snapshot(&ast, &cfg, 0, DIANA_DO_ACTIVE_HIGH, at, &ag);
        at += 100000;
    }
    CHECK_EQ_INT(ahits, 9, "las nueve dianas se detectan sin tocar el ADC");
    CHECK_EQ_INT(ctx.piezo_reads, 0,
                 "ANTIRREGRESION: CERO lecturas de ADC al detectar");

    diana_sensor_state_init(&ast);
    diana_do_process_snapshot(&ast, &cfg, bit_for_target(8),
                              DIANA_DO_ACTIVE_HIGH, 7000000, &ag);
    diana_hit_event aev;
    diana_hit_event_build(&aev, &hal, &id, &ag, DIANA_TARGET_ACTIVE, 7000010);
    CHECK_EQ_INT(ctx.piezo_reads, 0,
                 "ANTIRREGRESION: construir el evento tampoco lee el ADC");
    CHECK(!aev.has_amplitude,
          "ANTIRREGRESION: tener ADC disponible no hace aparecer amplitude");
    CHECK(!aev.has_threshold, "ANTIRREGRESION: ni threshold");
    CHECK(!aev.has_noise_floor, "ANTIRREGRESION: ni noise_floor");
    CHECK_EQ_INT(aev.neighbour_count, 0,
                 "sin amplitud no hay vecinos auditables que emitir");

    char ajson[DIANA_HIT_JSON_MAX];
    size_t an = diana_hit_event_to_json(&aev, ajson, sizeof(ajson));
    CHECK(an > 0, "el evento DO-only con HAL completo se serializa");
    CHECK_EQ_INT(ctx.piezo_reads, 0,
                 "ANTIRREGRESION: serializar tampoco lee el ADC");
    CHECK(strstr(ajson, "\"amplitude\"") == NULL,
          "ANTIRREGRESION: el JSON no lleva amplitude, ni con valor cero");

    SECTION("ADR-0007: coherencia perfil <-> medidas, impuesta por construccion");
    {
        /* 1. El evento digital NO puede nacer con medidas analogicas, aunque el
         *    grupo las traiga por un error aguas arriba. */
        diana_sensor_state cst2;
        diana_sensor_state_init(&cst2);
        diana_hit_group dirty;
        diana_do_process_snapshot(&cst2, &cfg, bit_for_target(2),
                                  DIANA_DO_ACTIVE_HIGH, 8000000, &dirty);
        CHECK(dirty.accepted, "impacto digital aceptado");
        dirty.has_amplitude = true;   /* contaminacion deliberada del grupo */
        dirty.amplitude = 1234;
        dirty.has_threshold = true;
        dirty.threshold = 900;
        dirty.has_noise_floor = true;
        dirty.noise_floor = 12;

        diana_hit_event dev;
        diana_hit_event_build(&dev, &hal, &id, &dirty, DIANA_TARGET_ACTIVE,
                              8000010);
        CHECK_EQ_INT(dev.detection_method, DIANA_DETECT_DIGITAL_THRESHOLD,
                     "el evento hereda el perfil digital");
        CHECK(!dev.has_amplitude,
              "el build DESCARTA la amplitud en el perfil digital");
        CHECK(!dev.has_threshold, "y el umbral");
        CHECK(!dev.has_noise_floor, "y el suelo de ruido");
        CHECK_EQ_INT(dev.amplitude, 0,
                     "el valor se limpia, no se arrastra escondido");
        CHECK(diana_hit_event_profile_coherent(&dev), "el evento es coherente");
        CHECK_EQ_INT(diana_hit_event_check(&dev), DIANA_HAL_OK,
                     "y pasa la comprobacion previa a publicar");

        char djson[DIANA_HIT_JSON_MAX];
        size_t dn = diana_hit_event_to_json(&dev, djson, sizeof(djson));
        CHECK(dn > 0, "el evento digital se serializa");
        CHECK(strstr(djson, "\"detection_method\":\"digital_threshold\"") != NULL,
              "el JSON lleva el discriminador con el literal exacto");
        CHECK(strstr(djson, "\"amplitude\"") == NULL,
              "PROHIBIDO: sin amplitude en el perfil digital");
        CHECK(strstr(djson, "\"threshold\"") == NULL, "sin threshold");
        CHECK(strstr(djson, "\"noise_floor\"") == NULL, "sin noise_floor");

        /* 2. Un evento INCOHERENTE forzado a mano no se puede serializar. */
        diana_hit_event bad = dev;
        bad.has_amplitude = true;
        bad.amplitude = 777;
        CHECK(!diana_hit_event_profile_coherent(&bad),
              "digital + amplitud = incoherente");
        CHECK_EQ_INT(diana_hit_event_check(&bad),
                     DIANA_ERR_CONTRACT_PROFILE_MISMATCH,
                     "codigo de error propio, distinguible de evento invalido");
        CHECK(diana_hit_event_check(&bad) != DIANA_HAL_ERR_INVALID,
              "no se confunde con un evento mal formado");
        char bjson[DIANA_HIT_JSON_MAX];
        CHECK_EQ_INT(diana_hit_event_to_json(&bad, bjson, sizeof(bjson)), 0,
                     "el serializador se NIEGA: un payload incoherente no existe");

        /* 3. Simetria: un analogico SIN amplitud tampoco es coherente. Es el
         *    productor averiado que ADR-0007 vuelve a hacer detectable. */
        diana_hit_event lame = dev;
        lame.detection_method = DIANA_DETECT_ANALOG_ENVELOPE;
        lame.has_amplitude = false;
        lame.has_threshold = false;
        CHECK(!diana_hit_event_profile_coherent(&lame),
              "analogico sin amplitud = productor averiado, no DO-only");
        CHECK_EQ_INT(diana_hit_event_to_json(&lame, bjson, sizeof(bjson)), 0,
                     "tampoco se serializa");

        /* 4. El perfil analogico legitimo sigue funcionando y NO emite el
         *    discriminador: la ausencia ya equivale a analog_envelope y los
         *    payloads v1 anteriores al ADR no cambian ni un byte. */
        diana_config acfg3;
        diana_config_defaults(&acfg3);
        diana_piezo_trigger atrig3 = {4, 900, 2600};
        diana_hit_group agrp3;
        diana_sensor_classify(&acfg3, &atrig3, 1, &agrp3);
        diana_hit_event aev3;
        diana_hit_event_build(&aev3, &hal, &id, &agrp3, DIANA_TARGET_ACTIVE, 900);
        CHECK_EQ_INT(aev3.detection_method, DIANA_DETECT_ANALOG_ENVELOPE,
                     "la ruta con ADC produce un evento analogico");
        CHECK(aev3.has_amplitude, "que SI lleva amplitud");
        CHECK_EQ_INT(diana_hit_event_check(&aev3), DIANA_HAL_OK, "y es coherente");
        size_t an3 = diana_hit_event_to_json(&aev3, bjson, sizeof(bjson));
        CHECK(an3 > 0, "el evento analogico se serializa");
        CHECK(strstr(bjson, "detection_method") == NULL,
              "el analogico NO emite el discriminador: ausencia == analogico");
        CHECK(strstr(bjson, "\"amplitude\"") != NULL,
              "y su amplitud sigue siendo obligatoria");
    }

    /* Y la via analogica (PCB futura) sigue intacta: SI lee el ADC.
     * Esto demuestra que el contador funciona y que la comprobacion de arriba
     * no es verde por estar el instrumento roto. */
    SECTION("control positivo: la ruta analogica SI usa el ADC");
    uint16_t amp = 0;
    CHECK_EQ_INT(hal.piezo_amplitude(hal.ctx, 0, &amp), DIANA_HAL_OK,
                 "lectura de amplitud disponible para la PCB futura");
    CHECK_EQ_INT(ctx.piezo_reads, 1,
                 "el contador de lecturas de ADC funciona de verdad");

    return g_tests_failed - before;
}
