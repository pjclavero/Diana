/**
 * @file test_config_reconcile.c
 * @brief CONFIG_RECONCILIATION · la cadena config/desired -> aplicar -> NVS.
 *
 * QUE DEMUESTRA ESTA SUITE:
 *
 *   1. LA SEMANTICA DE VERSIONES, entera y sin reloj:
 *        remota  > local  -> APPLY
 *        remota == local  -> NOOP
 *        remota  < local  -> REJECT
 *      incluido el caso que estaba MAL: con la local en 0 (estado de fabrica,
 *      el del modulo fisico) una entrante 0 se APLICABA, porque la guarda
 *      llevaba un `&& current->config_version != 0`.
 *
 *   2. QUE LOS CAMPOS SE APLICAN DE VERDAD. El firmware anterior copiaba
 *      `config_version` y tiraba el resto del payload. Aqui se parsea un
 *      config/desired REAL --el que compone module-config.service.ts-- y se
 *      comprueba campo a campo.
 *
 *   3. QUE SOBREVIVE AL REINICIO: aplicar, guardar en NVS, reiniciar el host y
 *      recargar tiene que devolver la MISMA version. Una config que se aplica
 *      en RAM y no persiste vuelve a 0 en el siguiente arranque, que es
 *      indistinguible desde el backend de no haberla aplicado nunca.
 *
 *   4. QUE EL RELOJ NO ES AUTORIDAD: el mismo par de versiones decide igual
 *      con el reloj del host adelantado, atrasado o parado.
 *
 * LO QUE ESTA SUITE NO PUEDE AFIRMAR: main/app_commands.c y
 * components/diana_platform_esp/src/mqtt_client.c NO se compilan en host. Que
 * el despachador llame a esta logica, y sobre todo que el firmware SE SUSCRIBA
 * de verdad a `config/desired` --el punto donde la cadena estaba rota-- lo fija
 * tools/check_config_reconcile.py. Aqui se prueba la decision; alli, el
 * cableado.
 */
#include <string.h>

#include "diana/config.h"
#include "diana/messages.h"
#include "hal_host.h"
#include "test_util.h"

/* El config/desired que emite de verdad module-config.service.ts: mismos
 * campos, mismo orden, mismos `null`. Copiarlo a mano seria probar contra una
 * fantasia del que escribe la prueba. */
static const char DESIRED_V1[] =
    "{\"schema_version\":1,\"module_id\":\"module-01\",\"config_version\":1,"
    "\"system_id\":\"sistema-banco\",\"coordinator_module_id\":null,"
    "\"position\":{\"x\":1,\"y\":-1},\"rotation\":90,"
    "\"friendly_name\":\"Diana del banco\","
    "\"led_brightness_max\":120,\"telemetry_interval_ms\":1000,"
    "\"network\":{\"mode\":\"dhcp\",\"ip\":null,\"netmask\":null,\"gateway\":null},"
    "\"calibration\":[{\"target_index\":3,\"threshold\":812,\"hysteresis\":64,"
    "\"noise_floor\":120,\"blanking_us\":45000,\"group_window_us\":1800,"
    "\"neighbour_ratio\":0.25,\"enabled\":true,"
    "\"calibrated_at\":\"2026-09-12T10:00:00.000Z\"}]}";

int run_config_reconcile(void)
{
    int before = g_tests_failed;
    TEST_SUITE("config_reconcile");

    /* ------------------------------------------------ 1. decision pura -- */
    SECTION("semantica de versiones: entera, sin reloj");
    CHECK(diana_config_decide(1, 0) == DIANA_CFG_APPLY,  "1 > 0 -> APPLY");
    CHECK(diana_config_decide(9, 8) == DIANA_CFG_APPLY,  "9 > 8 -> APPLY");
    CHECK(diana_config_decide(5, 5) == DIANA_CFG_NOOP,   "5 == 5 -> NOOP");
    CHECK(diana_config_decide(0, 0) == DIANA_CFG_NOOP,
          "0 == 0 -> NOOP (el estado de fabrica NO es un caso especial)");
    CHECK(diana_config_decide(3, 7) == DIANA_CFG_REJECT, "3 < 7 -> REJECT");
    CHECK(diana_config_decide(0, 1) == DIANA_CFG_REJECT,
          "0 < 1 -> REJECT (un modulo reiniciado no hace retroceder nada)");

    /* REGRESION EXACTA del defecto. La guarda vieja tenia
     * `&& current->config_version != 0`: con la local en 0, una entrante con
     * version 0 pasaba la guarda y se aplicaba una y otra vez. */
    SECTION("REGRESION: version 0 sobre version 0 NO se aplica");
    {
        diana_config cur, inc;
        diana_config_defaults(&cur);
        diana_config_defaults(&inc);
        cur.led_brightness_max = 55;
        inc.led_brightness_max = 99;
        inc.config_version = 0;   /* == cur.config_version, que es 0 */
        CHECK(diana_config_apply(&cur, &inc) != DIANA_HAL_OK,
              "apply(v0 sobre v0) RECHAZA");
        CHECK_EQ_INT(cur.led_brightness_max, 55,
                     "...y no ha tocado la configuracion vigente");
    }

    SECTION("apply: solo avanza, nunca repite ni retrocede");
    {
        diana_config cur, inc;
        diana_config_defaults(&cur);
        diana_config_defaults(&inc);

        inc.config_version = 1;
        inc.led_brightness_max = 77;
        CHECK_EQ_INT(diana_config_apply(&cur, &inc), DIANA_HAL_OK,
                     "v1 sobre v0 se APLICA");
        CHECK_EQ_INT(cur.config_version, 1, "la vigente pasa a ser la v1");
        CHECK_EQ_INT(cur.led_brightness_max, 77, "los campos se copian");

        inc.led_brightness_max = 88;      /* misma version, otro contenido */
        CHECK(diana_config_apply(&cur, &inc) != DIANA_HAL_OK,
              "repetir la v1 NO se aplica (noop)");
        CHECK_EQ_INT(cur.led_brightness_max, 77,
                     "...y el contenido vigente no cambia");

        inc.config_version = 0;
        CHECK(diana_config_apply(&cur, &inc) != DIANA_HAL_OK,
              "la v0 sobre la v1 se RECHAZA");
        CHECK_EQ_INT(cur.config_version, 1, "la vigente sigue siendo la v1");

        /* Una config entrante fuera de contrato no se aplica AUNQUE la version
         * avance: primero manda la version, despues la validez, y las dos. */
        inc.config_version = 2;
        inc.telemetry_interval_ms = 10;   /* minimo del contrato: 200 ms */
        CHECK(diana_config_apply(&cur, &inc) != DIANA_HAL_OK,
              "v2 no conforme: avanza la version pero NO se aplica");
        CHECK_EQ_INT(cur.config_version, 1,
                     "...y la vigente sigue siendo la v1");
    }

    /* ------------------------------------------------ 2. el payload real -- */
    SECTION("config/desired real: TODOS los campos, no solo la version");
    {
        diana_config base, out;
        diana_config_defaults(&base);
        CHECK(diana_config_parse(DESIRED_V1, strlen(DESIRED_V1), &base, &out),
              "el payload que emite el backend se parsea");
        CHECK_EQ_INT(out.config_version, 1, "config_version = 1");
        CHECK_EQ_STR(out.system_id, "sistema-banco", "system_id aplicado");
        CHECK_EQ_STR(out.friendly_name, "Diana del banco", "friendly_name aplicado");
        CHECK_EQ_INT(out.rotation, 90, "rotation aplicada");
        CHECK(out.has_position, "position presente");
        CHECK_EQ_INT(out.position_x, 1,  "position.x aplicada");
        CHECK_EQ_INT(out.position_y, -1, "position.y aplicada (negativa)");
        CHECK_EQ_INT(out.led_brightness_max, 120, "led_brightness_max aplicado");
        CHECK_EQ_INT(out.telemetry_interval_ms, 1000, "telemetry_interval_ms aplicado");
        CHECK(out.network.mode == DIANA_NET_DHCP, "network.mode = dhcp");
        CHECK_EQ_STR(out.network.ip, "", "network.ip null -> vacio, no literal 'null'");

        /* El canal se identifica por target_index, NO por la posicion en el
         * array: el backend solo emite los canales CALIBRADOS. */
        const diana_target_calibration *c3 = diana_config_cal(&out, 3);
        CHECK(c3 != NULL, "el canal 3 existe");
        CHECK_EQ_INT(c3->threshold, 812, "calibracion al canal 3 por target_index");
        CHECK_EQ_INT(c3->blanking_us, 45000, "blanking_us del canal 3");
        CHECK_EQ_INT(c3->group_window_us, 1800, "group_window_us del canal 3");
        CHECK(c3->neighbour_ratio > 0.24f && c3->neighbour_ratio < 0.26f,
              "neighbour_ratio fraccionario (0.25) aplicado");
        CHECK(c3->has_calibrated_at, "el canal 3 queda marcado como calibrado");

        const diana_target_calibration *c1 = diana_config_cal(&out, 1);
        CHECK(c1 != NULL && c1->threshold == DIANA_DEFAULT_THRESHOLD,
              "el canal 1, ausente del array, conserva su valor");
        CHECK(c1 != NULL && !c1->has_calibrated_at,
              "...y sigue SIN calibrar: la ausencia no inventa un sello");

        CHECK_EQ_INT(diana_config_validate(&out), DIANA_HAL_OK,
                     "la config resultante es conforme al contrato");
    }

    SECTION("fallo CERRADO: un payload malo no deja media config");
    {
        diana_config base, out;
        diana_config_defaults(&base);
        base.config_version = 4;
        out = base;

        CHECK(!diana_config_parse("{\"config_version\":1,", 20, &base, &out),
              "JSON truncado -> false");
        CHECK_EQ_INT(out.config_version, 4, "...y `out` intacto");

        CHECK(!diana_config_parse("{\"module_id\":\"module-01\"}", 25, &base, &out),
              "sin config_version -> false (no hay nada que reconciliar)");
        CHECK_EQ_INT(out.config_version, 4, "...y `out` intacto");

        static const char BAD_IDX[] =
            "{\"config_version\":5,\"calibration\":[{\"target_index\":99,\"threshold\":1}]}";
        CHECK(!diana_config_parse(BAD_IDX, strlen(BAD_IDX), &base, &out),
              "target_index fuera de 1..9 -> false, no escritura fuera del array");
        CHECK_EQ_INT(out.config_version, 4, "...y `out` intacto");
    }

    /* --------------------------------------- 3. persistencia y reinicio -- */
    SECTION("la config aplicada SOBREVIVE al reinicio (NVS)");
    {
        host_hal_ctx  hctx;
        host_persistent nv;
        diana_hal hal;
        host_persistent_reset(&nv, 32);
        host_hal_init(&hctx, &nv, &hal, 7);

        diana_config cfg;
        CHECK(diana_config_load(&cfg, &hal) != DIANA_HAL_OK,
              "de fabrica no hay config guardada");
        CHECK_EQ_INT(cfg.config_version, 0,
                     "...y se arranca en la v0: ESE es el 0 que el modulo reporta");

        diana_config inc;
        CHECK(diana_config_parse(DESIRED_V1, strlen(DESIRED_V1), &cfg, &inc),
              "llega el config/desired v1 retenido");
        CHECK_EQ_INT(diana_config_apply(&cfg, &inc), DIANA_HAL_OK, "se aplica");
        CHECK_EQ_INT(diana_config_save(&cfg, &hal), DIANA_HAL_OK, "se persiste");

        /* El reported que el backend recibiria AHORA. */
        char json[DIANA_MSG_JSON_MAX];
        size_t n = diana_config_reported_json(&cfg, "module-01", NULL, json,
                                              sizeof(json));
        CHECK(n > 0, "se serializa config/reported");
        CHECK(strstr(json, "\"config_version\":1") != NULL,
              "config/reported declara la v1, no la 0");
        /* No se vuelca a out/messages: `contracts/mqtt/` no publica hoy un
         * esquema module-config-reported contra el que validarlo, y volcarlo
         * solo produciria un "esquema desconocido". Lo que se afirma aqui es
         * el CONTENIDO del payload, que es lo que el backend reconcilia. */

        host_reboot(&hctx, &hal, 7, 0);

        diana_config after;
        CHECK_EQ_INT(diana_config_load(&after, &hal), DIANA_HAL_OK,
                     "tras el reinicio la config se recupera de NVS");
        CHECK_EQ_INT(after.config_version, 1,
                     "sigue siendo la v1: no se vuelve a reportar 0");
        CHECK_EQ_STR(after.system_id, "sistema-banco",
                     "y con el contenido, no solo el numero");

        /* Y el retenido vuelve a llegar en cada arranque: tiene que ser NOOP. */
        CHECK(diana_config_decide(1, after.config_version) == DIANA_CFG_NOOP,
              "el mismo retenido tras reiniciar es NOOP, no se reaplica en bucle");
    }

    /* ------------------------------------------- 4. el reloj no ordena -- */
    SECTION("EL RELOJ NO ES AUTORIDAD DE ORDEN");
    {
        host_hal_ctx  hctx;
        host_persistent nv;
        diana_hal hal;
        host_persistent_reset(&nv, 32);
        host_hal_init(&hctx, &nv, &hal, 7);

        /* Un payload cuyo `calibrated_at` es de 1970 y otro de 2099: la
         * decision tiene que ser la MISMA, porque la fija la version. */
        static const char VIEJO[] =
            "{\"config_version\":2,\"calibration\":[{\"target_index\":1,"
            "\"threshold\":500,\"calibrated_at\":\"1970-01-01T00:00:00.000Z\"}]}";
        static const char NUEVO[] =
            "{\"config_version\":2,\"calibration\":[{\"target_index\":1,"
            "\"threshold\":500,\"calibrated_at\":\"2099-01-01T00:00:00.000Z\"}]}";

        diana_config base, a, b;
        diana_config_defaults(&base);
        base.config_version = 3;

        CHECK(diana_config_parse(VIEJO, strlen(VIEJO), &base, &a), "parsea el de 1970");
        CHECK(diana_config_parse(NUEVO, strlen(NUEVO), &base, &b), "parsea el de 2099");
        CHECK(diana_config_decide(a.config_version, base.config_version)
                  == DIANA_CFG_REJECT,
              "v2 sobre v3 se rechaza con sello de 1970");
        CHECK(diana_config_decide(b.config_version, base.config_version)
                  == DIANA_CFG_REJECT,
              "v2 sobre v3 se rechaza IGUAL con sello de 2099");

        /* Y el reloj del propio modulo tampoco cambia nada. */
        diana_config_decision d0 = diana_config_decide(4, 3);
        host_advance_us(&hctx, 86400ULL * 1000000ULL * 400ULL);  /* +400 dias */
        diana_config_decision d1 = diana_config_decide(4, 3);
        CHECK(d0 == d1 && d0 == DIANA_CFG_APPLY,
              "avanzar el reloj del modulo 400 dias no altera la decision");
    }

    return g_tests_failed - before;
}
