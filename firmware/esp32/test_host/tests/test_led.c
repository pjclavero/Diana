/**
 * @file test_led.c
 * @brief Estado -> color Y patron, y presupuesto de potencia (dosier 10.4, 10.5).
 */
#include <string.h>

#include "diana/led.h"
#include "test_util.h"

/** LEDs en cian (estilo de prueba/identificacion) del hueco `pos` (0..2). */
static int cian_en(const diana_hal_rgb *px, int pos)
{
    int n = 0;
    for (int i = pos * DIANA_LEDS_PER_TARGET;
         i < (pos + 1) * DIANA_LEDS_PER_TARGET; ++i)
        if (px[i].g > 0 && px[i].b > 0 && px[i].r == 0) n++;
    return n;
}

int run_led(void)
{
    TEST_SUITE("led");
    int before = g_tests_failed;

    SECTION("tabla del dosier 10.5: color Y patron");
    diana_led_style safe = diana_led_style_for(DIANA_TARGET_SAFE);
    CHECK(safe.b == 255 && safe.r == 0 && safe.g == 0, "segura: azul");
    CHECK_EQ_STR(diana_led_pattern_str(safe.pattern), "solid", "segura: fijo");

    diana_led_style act = diana_led_style_for(DIANA_TARGET_ACTIVE);
    CHECK(act.r == 255 && act.g == 0 && act.b == 0, "objetivo: rojo");
    CHECK_EQ_STR(diana_led_pattern_str(act.pattern), "slow_pulse", "objetivo: pulso lento");

    diana_led_style hit = diana_led_style_for(DIANA_TARGET_HIT);
    CHECK(hit.g == 255 && hit.r == 0, "acierto: verde");
    CHECK_EQ_STR(diana_led_pattern_str(hit.pattern), "flash_fade",
                 "acierto: destello y fundido");

    diana_led_style cd = diana_led_style_for(DIANA_TARGET_COUNTDOWN);
    CHECK(cd.r == 255 && cd.g > 100 && cd.b == 0, "preparacion: amarillo");
    CHECK_EQ_STR(diana_led_pattern_str(cd.pattern), "countdown", "preparacion: cuenta atras");

    diana_led_style pen = diana_led_style_for(DIANA_TARGET_PENALTY);
    CHECK(pen.r == 255 && pen.b == 255 && pen.g == 0, "penalizacion: magenta");
    CHECK_EQ_STR(diana_led_pattern_str(pen.pattern), "fast_blink",
                 "penalizacion: parpadeo rapido");

    diana_led_style err = diana_led_style_for(DIANA_TARGET_ERROR);
    CHECK_EQ_STR(diana_led_pattern_str(err.pattern), "alternate",
                 "error: alternancia rojo/blanco");

    diana_led_style maint = diana_led_style_for(DIANA_TARGET_MAINTENANCE);
    CHECK(maint.r == maint.g && maint.g == maint.b && maint.r < 100,
          "mantenimiento: blanco tenue");
    CHECK_EQ_STR(diana_led_pattern_str(maint.pattern), "dim_solid",
                 "mantenimiento: fijo");

    diana_led_style ident = diana_led_style_identify();
    CHECK(ident.g == 255 && ident.b == 255 && ident.r == 0, "identificacion: cian");
    CHECK_EQ_STR(diana_led_pattern_str(ident.pattern), "sweep",
                 "identificacion: barrido");

    SECTION("accesibilidad: ningun par (color, patron) se repite");
    int collisions = 0;
    for (int a = 0; a < DIANA_TARGET_STATE_COUNT; ++a) {
        if (a == DIANA_TARGET_OFF) continue;
        diana_led_style sa = diana_led_style_for((diana_target_state)a);
        for (int b = a + 1; b < DIANA_TARGET_STATE_COUNT; ++b) {
            if (b == DIANA_TARGET_OFF) continue;
            diana_led_style sb = diana_led_style_for((diana_target_state)b);
            if (sa.r == sb.r && sa.g == sb.g && sa.b == sb.b &&
                sa.pattern == sb.pattern) {
                collisions++;
                printf("       colision: %s vs %s\n",
                       diana_target_state_str((diana_target_state)a),
                       diana_target_state_str((diana_target_state)b));
            }
        }
    }
    CHECK_EQ_INT(collisions, 0,
                 "estados distinguibles sin depender solo del color");

    SECTION("estados que comparten color se distinguen por patron");
    diana_led_style serr = diana_led_style_for(DIANA_TARGET_SENSOR_ERROR);
    CHECK(serr.r == err.r && serr.g == err.g && serr.b == err.b,
          "error y sensor_error comparten color base");
    CHECK(serr.pattern != err.pattern, "pero NO comparten patron");

    SECTION("render de las 3 cadenas de 72 LED");
    diana_target_state states[DIANA_TARGET_COUNT];
    for (int i = 0; i < DIANA_TARGET_COUNT; ++i) states[i] = DIANA_TARGET_SAFE;
    states[4] = DIANA_TARGET_ACTIVE;   /* diana 5, cadena 1 */

    diana_hal_rgb chain0[DIANA_LEDS_PER_CHAIN];
    diana_hal_rgb chain1[DIANA_LEDS_PER_CHAIN];
    diana_hal_rgb chain2[DIANA_LEDS_PER_CHAIN];
    diana_led_render_chain(0, states, false, 0, 255, 0, chain0);
    diana_led_render_chain(1, states, false, 0, 255, 0, chain1);
    diana_led_render_chain(2, states, false, 0, 255, 0, chain2);

    CHECK(chain0[0].b > 0 && chain0[0].r == 0, "cadena 0: diana 1 en azul");
    /* diana 5 = indice 4 -> cadena 1, hueco 1 -> LED 24..47 */
    CHECK(chain1[24].r > 0 && chain1[24].b == 0, "cadena 1: diana 5 en rojo");
    CHECK(chain1[0].b > 0, "cadena 1: diana 4 sigue azul");

    SECTION("modo identificacion afecta a todo el modulo");
    diana_hal_rgb idc[DIANA_LEDS_PER_CHAIN];
    diana_led_render_chain(0, states, true, 0, 255, 0, idc);
    int cyan = 0;
    for (int i = 0; i < DIANA_LEDS_PER_CHAIN; ++i)
        if (idc[i].g > 0 && idc[i].b > 0 && idc[i].r == 0) cyan++;
    CHECK(cyan > 0, "el barrido de identificacion pinta en cian");

    SECTION("prueba de LED de UNA diana, no del modulo entero");
    {
        /* El defecto medido en el banco: el backend manda `led_test` con
         * target_index y el firmware encendia las nueve dianas en modo
         * identify. Aqui se comprueba que ilumina la pedida Y que las vecinas
         * siguen mostrando su estado. */
        diana_hal_rgb c0[DIANA_LEDS_PER_CHAIN];
        diana_led_render_chain(0, states, false, DIANA_LED_TEST_BIT(2), 255, 0, c0);

        int cyan_d2 = 0;
        for (int i = DIANA_LEDS_PER_TARGET; i < 2 * DIANA_LEDS_PER_TARGET; ++i)
            if (c0[i].g > 0 && c0[i].b > 0 && c0[i].r == 0) cyan_d2++;
        CHECK(cyan_d2 > 0, "la diana 2 se ilumina con el estilo de prueba");
        CHECK(c0[0].b > 0 && c0[0].g == 0,
              "la diana 1 sigue en su estado (azul), no en prueba");
        CHECK(c0[2 * DIANA_LEDS_PER_TARGET].b > 0 &&
                  c0[2 * DIANA_LEDS_PER_TARGET].g == 0,
              "la diana 3 tampoco se contagia");

        /* La diana pedida esta en OTRA cadena: esta no debe cambiar nada. */
        diana_hal_rgb c0b[DIANA_LEDS_PER_CHAIN];
        diana_led_render_chain(0, states, false, DIANA_LED_TEST_BIT(5), 255, 0, c0b);
        CHECK(memcmp(c0b, chain0, sizeof(c0b)) == 0,
              "pedir la diana 5 no altera la cadena 0");

        /* 0 = ninguna en prueba; fuera de rango tampoco enciende nada. */
        diana_hal_rgb c0c[DIANA_LEDS_PER_CHAIN];
        diana_led_render_chain(0, states, false, 0, 255, 0, c0c);
        CHECK(memcmp(c0c, chain0, sizeof(c0c)) == 0, "0 = ninguna en prueba");
        diana_led_render_chain(0, states, false, DIANA_LED_TEST_BIT(9), 255, 0, c0c);
        CHECK(memcmp(c0c, chain0, sizeof(c0c)) == 0,
              "un bit de otra cadena no enciende nada en esta");

        /* identify es una orden sobre el MODULO: manda sobre la prueba. */
        diana_hal_rgb c0d[DIANA_LEDS_PER_CHAIN];
        diana_led_render_chain(0, states, true, DIANA_LED_TEST_BIT(2), 255, 0, c0d);
        int cyan_todas = 0;
        for (int i = 0; i < DIANA_LEDS_PER_TARGET; ++i)
            if (c0d[i].g > 0 && c0d[i].b > 0) cyan_todas++;
        CHECK(cyan_todas > 0, "con identify activo se ilumina todo el modulo");
    }

    SECTION("las pruebas de LED son INDEPENDIENTES entre dianas");
    {
        /* Los tres defectos medidos en el banco, cada uno con su caso:
         * encender D2 apagaba D1; apagar D1 apagaba la ultima encendida; y
         * habia un unico plazo, el de la ultima orden. El modelo de un solo
         * hueco no podia expresar dos dianas a la vez --- comprobado entonces
         * recorriendo los 256 valores posibles del indice. */
        diana_hal_rgb px[DIANA_LEDS_PER_CHAIN];

        uint16_t mask = DIANA_LED_TEST_BIT(1);
        diana_led_render_chain(0, states, false, mask, 255, 0, px);
        CHECK(cian_en(px, 0) > 0 && cian_en(px, 1) == 0,
              "D1 ON: solo D1 en cian");

        mask |= DIANA_LED_TEST_BIT(2);
        diana_led_render_chain(0, states, false, mask, 255, 0, px);
        CHECK(cian_en(px, 0) > 0 && cian_en(px, 1) > 0,
              "D2 ON con D1 ya encendida: LAS DOS en cian (antes D1 se apagaba)");

        mask |= DIANA_LED_TEST_BIT(3);
        diana_led_render_chain(0, states, false, mask, 255, 0, px);
        CHECK(cian_en(px, 0) > 0 && cian_en(px, 1) > 0 && cian_en(px, 2) > 0,
              "D3 ON: las tres a la vez");

        /* Apagado DIRIGIDO: se retira el bit de D1 y solo el de D1. */
        mask &= (uint16_t)~DIANA_LED_TEST_BIT(1);
        diana_led_render_chain(0, states, false, mask, 255, 0, px);
        CHECK(cian_en(px, 0) == 0 && cian_en(px, 1) > 0 && cian_en(px, 2) > 0,
              "OFF D1: se apaga D1 y D2/D3 SIGUEN encendidas");

        /* Caducidad de una sola: equivale a retirar su bit. */
        mask &= (uint16_t)~DIANA_LED_TEST_BIT(2);
        diana_led_render_chain(0, states, false, mask, 255, 0, px);
        CHECK(cian_en(px, 1) == 0 && cian_en(px, 2) > 0,
              "vence D2: se apaga D2 y D3 sigue encendida");

        /* Las nueve a la vez, en las tres cadenas. */
        uint16_t todas = 0;
        for (int i = 1; i <= DIANA_TARGET_COUNT; ++i) todas |= DIANA_LED_TEST_BIT(i);
        int encendidas = 0;
        for (uint8_t ch = 0; ch < DIANA_LED_CHAINS; ++ch) {
            diana_led_render_chain(ch, states, false, todas, 255, 0, px);
            for (int hueco = 0; hueco < 3; ++hueco)
                if (cian_en(px, hueco) > 0) encendidas++;
        }
        CHECK_EQ_INT(encendidas, 9, "las NUEVE dianas pueden estar en prueba a la vez");

        /* Y la mascara vacia no enciende nada. */
        diana_led_render_chain(0, states, false, 0, 255, 0, px);
        CHECK(memcmp(px, chain0, sizeof(px)) == 0,
              "mascara 0: ninguna diana en prueba");
    }

    SECTION("limite global de brillo");
    diana_hal_rgb dim[DIANA_LEDS_PER_CHAIN];
    diana_led_render_chain(0, states, false, 0, 64, 0, dim);
    CHECK(dim[0].b < chain0[0].b, "brillo 64 produce menos intensidad que 255");
    CHECK(dim[0].b > 0, "pero no apaga la diana");

    SECTION("presupuesto de potencia (dosier 10.4)");
    diana_hal_rgb white[DIANA_LEDS_PER_CHAIN];
    for (int i = 0; i < DIANA_LEDS_PER_CHAIN; ++i) {
        white[i].r = 255; white[i].g = 255; white[i].b = 255;
    }
    uint32_t ma = diana_led_estimate_ma(white, DIANA_LEDS_PER_CHAIN);
    CHECK_EQ_INT(ma, 72 * 60, "72 LED en blanco maximo estiman 4320 mA");

    diana_hal_rgb a[DIANA_LEDS_PER_CHAIN], b[DIANA_LEDS_PER_CHAIN],
                  c[DIANA_LEDS_PER_CHAIN];
    memcpy(a, white, sizeof(white));
    memcpy(b, white, sizeof(white));
    memcpy(c, white, sizeof(white));
    diana_hal_rgb *chains[DIANA_LED_CHAINS] = {a, b, c};

    uint32_t total = diana_led_estimate_ma(a, DIANA_LEDS_PER_CHAIN) * 3;
    CHECK_EQ_INT(total, 12960, "216 LED en blanco maximo estiman 12960 mA");

    uint16_t factor = diana_led_apply_budget(chains, DIANA_LEDS_PER_CHAIN, 3000);
    CHECK(factor < 1000, "el presupuesto de 3000 mA obliga a recortar");
    uint32_t after = diana_led_estimate_ma(a, DIANA_LEDS_PER_CHAIN) +
                     diana_led_estimate_ma(b, DIANA_LEDS_PER_CHAIN) +
                     diana_led_estimate_ma(c, DIANA_LEDS_PER_CHAIN);
    CHECK(after <= 3000, "tras recortar se respeta el presupuesto");
    printf("       %u mA -> %u mA (factor %u/1000)\n", total, after, factor);

    diana_hal_rgb *low[DIANA_LED_CHAINS] = {a, b, c};
    uint16_t f2 = diana_led_apply_budget(low, DIANA_LEDS_PER_CHAIN, 6000);
    CHECK_EQ_INT(f2, 1000, "dentro del presupuesto no se recorta");

    return g_tests_failed - before;
}
