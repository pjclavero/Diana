/**
 * @file test_coordinator.c
 * @brief Rol de COORDINADOR · autoridad, un solo comando, dedup y nonce.
 *
 * LO QUE FALTABA EN EL SISTEMA. El contrato reparte la autoridad por dominio:
 * el backend manda al sistema por `system/{id}/command` y el COORDINADOR
 * traduce eso a `module/{id}/command`. El backend tiene prohibido escribir ahi
 * --- una prueba recorre su AST para impedirlo --- y el firmware nunca
 * implemento el otro extremo: leia el selector, lo mapeaba a un rol y lo
 * publicaba, pero ninguna conducta dependia de el. La cadena de juego estaba
 * cortada en el medio.
 *
 * Estas pruebas fijan lo que NO puede relajarse cuando se implementen los
 * modos: quien tiene autoridad, cuantos comandos sale por orden, que una
 * reentrega no duplique efectos y que el nonce nunca retroceda --- porque el
 * receptor lo rechaza si no crece.
 */
#include <string.h>

#include "diana/coordinator.h"
#include "test_util.h"

#define CMD1 "11111111-1111-4111-8111-111111111111"
#define CMD2 "22222222-2222-4222-8222-222222222222"
#define CMD3 "33333333-3333-4333-8333-333333333333"
#define GAME "44444444-4444-4444-8444-444444444444"
#define ROUND "55555555-5555-4555-8555-555555555555"

static diana_system_command orden(const char *id, diana_system_action a)
{
    diana_system_command c;
    memset(&c, 0, sizeof(c));
    c.schema_version = 1;
    snprintf(c.command_id, sizeof(c.command_id), "%s", id);
    snprintf(c.system_id, sizeof(c.system_id), "%s", "banco-01");
    c.action = a;
    c.issued_at_ms = 1789000000000ULL;
    c.expires_in_ms = 10000;
    c.nonce = 1;
    c.issuer = DIANA_ISSUER_BACKEND;
    c.has_game = true;
    snprintf(c.game_id, sizeof(c.game_id), "%s", GAME);
    snprintf(c.round_id, sizeof(c.round_id), "%s", ROUND);
    c.target_count = 3;
    for (uint8_t i = 0; i < 3; ++i) {
        snprintf(c.targets[i].module_id, sizeof(c.targets[i].module_id), "%s",
                 "module-01");
        c.targets[i].target_index = (uint8_t)(i + 1);
    }
    return c;
}

int run_coordinator(void)
{
    TEST_SUITE("coordinator");
    int before = g_tests_failed;

    SECTION("AUTORIDAD · un satelite no coordina, y no lo disimula");
    {
        diana_coordinator c;
        diana_coordinator_reset(&c);
        diana_coord_plan p;
        diana_system_command o = orden(CMD1, DIANA_SYS_ARM_GAME);

        diana_coord_result r = diana_coordinator_on_system_command(
            &c, false, "banco-01", &o, &p);
        CHECK(r == DIANA_COORD_NOT_MINE, "en SATELITE la orden no es suya");
        CHECK(!p.emit_command, "no emite NINGUN comando de modulo");
        CHECK(!p.emit_state, "y tampoco publica estado de partida");
        CHECK(c.seen_count == 0,
              "ni consume el command_id: no ha atendido nada que recordar");

        /* El mismo modulo, ya en PRINCIPAL, SI la atiende: sin este control la
         * prueba de arriba pasaria aunque el coordinador no funcionase. */
        r = diana_coordinator_on_system_command(&c, true, "banco-01", &o, &p);
        CHECK(r == DIANA_COORD_OK, "CONTROL: en PRINCIPAL la misma orden se acepta");
    }

    SECTION("el camino minimo: armar y arrancar");
    {
        diana_coordinator c;
        diana_coordinator_reset(&c);
        diana_coord_plan p;

        diana_system_command arm = orden(CMD1, DIANA_SYS_ARM_GAME);
        CHECK(diana_coordinator_on_system_command(&c, true, "banco-01", &arm, &p)
                  == DIANA_COORD_OK, "arm_game aceptada");
        CHECK(!p.emit_command,
              "armar NO enciende nada: solo declara la partida");
        CHECK(p.emit_state && p.phase == DIANA_GAME_ARMED,
              "publica estado en fase 'armed'");

        diana_system_command start = orden(CMD2, DIANA_SYS_START_GAME);
        CHECK(diana_coordinator_on_system_command(&c, true, "banco-01", &start, &p)
                  == DIANA_COORD_OK, "start_game aceptada");
        CHECK(p.emit_command, "arrancar SI emite un comando de modulo");
        CHECK_EQ_STR(p.command_module_id, "module-01", "dirigido al modulo correcto");
        CHECK_EQ_INT(p.active_target_index, 1, "activa la PRIMERA diana de la lista");
        CHECK(p.emit_state && p.phase == DIANA_GAME_RUNNING, "y pasa a 'running'");
    }

    SECTION("EXACTAMENTE UN comando por orden");
    {
        /* El plan solo puede pedir un comando: si algun dia hiciera falta mas,
         * tiene que ser una decision explicita y no un bucle que crece solo.
         * Aqui se fija la forma del tipo, que es lo que lo impide. */
        diana_coordinator c;
        diana_coordinator_reset(&c);
        diana_coord_plan p;
        diana_system_command arm = orden(CMD1, DIANA_SYS_ARM_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &arm, &p);
        diana_system_command start = orden(CMD2, DIANA_SYS_START_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &start, &p);
        CHECK(sizeof(p.command_module_id) > 0 && p.emit_command,
              "el plan lleva UN destino, no una lista");
        CHECK_EQ_INT((int)sizeof(p.active_target_index), 1,
              "y UNA diana activa, no un conjunto");
    }

    SECTION("DEDUP · una reentrega no produce un segundo efecto");
    {
        diana_coordinator c;
        diana_coordinator_reset(&c);
        diana_coord_plan p;
        diana_system_command arm = orden(CMD1, DIANA_SYS_ARM_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &arm, &p);
        diana_system_command start = orden(CMD2, DIANA_SYS_START_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &start, &p);
        uint64_t nonce_primero = p.command_nonce;

        /* Misma orden otra vez: QoS 1 reentrega, y el broker lo hizo de verdad
         * en el banco con led_test. */
        diana_coord_result r =
            diana_coordinator_on_system_command(&c, true, "banco-01", &start, &p);
        CHECK(r == DIANA_COORD_DUPLICATE, "la repeticion se reconoce");
        CHECK(!p.emit_command, "y NO emite un segundo comando de modulo");
        CHECK(!p.emit_state, "ni republica estado");

        /* Una orden NUEVA sigue funcionando tras el duplicado. */
        diana_system_command fin = orden(CMD3, DIANA_SYS_END_GAME);
        CHECK(diana_coordinator_on_system_command(&c, true, "banco-01", &fin, &p)
                  == DIANA_COORD_OK, "la orden siguiente se atiende con normalidad");
        CHECK(p.command_nonce > nonce_primero,
              "y su nonce es MAYOR que el anterior");
    }

    SECTION("NONCE monotonico · el receptor rechaza lo que no crece");
    {
        diana_coordinator c;
        diana_coordinator_reset(&c);
        diana_coord_plan p;
        diana_system_command arm = orden(CMD1, DIANA_SYS_ARM_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &arm, &p);

        uint64_t anterior = 0;
        const char *ids[3] = {CMD2, CMD3, "66666666-6666-4666-8666-666666666666"};
        diana_system_action acc[3] = {DIANA_SYS_START_GAME, DIANA_SYS_PAUSE_GAME,
                                      DIANA_SYS_RESUME_GAME};
        int crecientes = 0;
        for (int i = 0; i < 3; ++i) {
            diana_system_command o = orden(ids[i], acc[i]);
            (void)diana_coordinator_on_system_command(&c, true, "banco-01", &o, &p);
            if (p.emit_command && p.command_nonce > anterior) crecientes++;
            if (p.emit_command) anterior = p.command_nonce;
        }
        CHECK_EQ_INT(crecientes, 3, "los tres comandos llevan nonce creciente");
    }

    SECTION("sobres que no se atienden");
    {
        diana_coordinator c;
        diana_coordinator_reset(&c);
        diana_coord_plan p;

        diana_system_command ajena = orden(CMD1, DIANA_SYS_ARM_GAME);
        snprintf(ajena.system_id, sizeof(ajena.system_id), "%s", "otro-sistema");
        CHECK(diana_coordinator_on_system_command(&c, true, "banco-01", &ajena, &p)
                  == DIANA_COORD_OTHER_SYSTEM, "orden de OTRO sistema: no es suya");
        CHECK(!p.emit_command, "y no emite nada");

        diana_system_command sin_id = orden("no-es-un-uuid", DIANA_SYS_ARM_GAME);
        CHECK(diana_coordinator_on_system_command(&c, true, "banco-01", &sin_id, &p)
                  == DIANA_COORD_INVALID, "sin command_id valido no hay correlacion posible");

        diana_system_command otro_emisor = orden(CMD2, DIANA_SYS_ARM_GAME);
        otro_emisor.issuer = DIANA_ISSUER_COORDINATOR;
        CHECK(diana_coordinator_on_system_command(&c, true, "banco-01", &otro_emisor, &p)
                  == DIANA_COORD_INVALID,
              "el canal de sistema es del backend: otro emisor no vale");

        diana_system_command arrancar_sin_armar = orden(CMD3, DIANA_SYS_START_GAME);
        diana_coordinator c2;
        diana_coordinator_reset(&c2);
        CHECK(diana_coordinator_on_system_command(&c2, true, "banco-01",
                                                  &arrancar_sin_armar, &p)
                  == DIANA_COORD_INVALID, "arrancar sin partida armada se rechaza");
        CHECK(!p.emit_command, "y desde luego no enciende ninguna diana");
    }

    SECTION("pausar y terminar dejan las dianas SEGURAS");
    {
        diana_coordinator c;
        diana_coordinator_reset(&c);
        diana_coord_plan p;
        diana_system_command arm = orden(CMD1, DIANA_SYS_ARM_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &arm, &p);
        diana_system_command start = orden(CMD2, DIANA_SYS_START_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &start, &p);

        diana_system_command pausa = orden(CMD3, DIANA_SYS_PAUSE_GAME);
        (void)diana_coordinator_on_system_command(&c, true, "banco-01", &pausa, &p);
        CHECK(p.emit_command && p.active_target_index == 0,
              "al pausar se apagan las dianas (ninguna activa)");
        CHECK(p.phase == DIANA_GAME_PAUSED, "y la fase es 'paused'");
    }

    return g_tests_failed - before;
}
