/**
 * @file test_command.c
 * @brief Caducidad, repeticion de command_id y nonce no monotonico.
 */
#include <string.h>

#include "diana/command.h"
#include "test_util.h"

static diana_command mk(const char *cid, uint64_t nonce, uint32_t expires,
                        diana_issuer issuer, diana_command_action action)
{
    diana_command c;
    memset(&c, 0, sizeof(c));
    snprintf(c.command_id, sizeof(c.command_id), "%s", cid);
    c.issued_at_ms = 1784500000000ULL;
    c.expires_in_ms = expires;
    c.nonce = nonce;
    c.issuer = issuer;
    snprintf(c.module_id, sizeof(c.module_id), "module-03");
    c.action = action;
    c.schema_version = 1;
    return c;
}

int run_command(void)
{
    TEST_SUITE("command");
    int before = g_tests_failed;

    diana_command_guard g;
    diana_command_guard_init(&g);
    const char *me = "module-03";

    SECTION("comando valido aceptado");
    diana_command c1 = mk("ad506082-af5e-4d6c-bf71-5e6f70819203", 42, 5000,
                          DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY);
    diana_command_verdict v = diana_command_validate(&g, &c1, me, 1000000, 1000500);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted", "identify aceptado");
    CHECK_EQ_INT(g.accepted, 1, "1 comando aceptado");

    SECTION("command_id repetido -> duplicate (cache de los ultimos 128)");
    v = diana_command_validate(&g, &c1, me, 2000000, 2000500);
    CHECK_EQ_STR(diana_command_result_str(v.result), "duplicate",
                 "mismo command_id rechazado como duplicado");
    CHECK_EQ_STR(v.detail, "command_id ya ejecutado", "detalle del rechazo");
    CHECK_EQ_INT(g.rejected_duplicate, 1, "duplicado contabilizado");

    SECTION("nonce no monotonico rechazado (proteccion de reenvio)");
    diana_command old = mk("6f1c2c4e-6b1a-4f2e-9b3d-1a2b3c4d5e6f", 41, 5000,
                           DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS);
    v = diana_command_validate(&g, &old, me, 3000000, 3000500);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "nonce 41 <= 42 rechazado");
    CHECK(strstr(v.detail, "nonce") != NULL, "el detalle cita el nonce");
    printf("       detalle: %s\n", v.detail);
    CHECK_EQ_INT(g.rejected_nonce, 1, "rechazo por nonce contabilizado");

    diana_command same = mk("7a2d3d5f-7c2b-4a3f-8c4e-2b3c4d5e6f70", 42, 5000,
                            DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS);
    v = diana_command_validate(&g, &same, me, 3100000, 3100500);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "nonce IGUAL al ultimo tambien se rechaza");

    diana_command next = mk("8b3e4e60-8d3c-4b4a-9d5f-3c4d5e6f7081", 43, 5000,
                            DIANA_ISSUER_BACKEND, DIANA_CMD_SET_TARGETS);
    v = diana_command_validate(&g, &next, me, 3200000, 3200500);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "nonce 43 > 42 aceptado");

    SECTION("el nonce es POR EMISOR: el coordinador tiene el suyo");
    diana_command coord = mk("9c4f5f71-9e4d-4c5b-ae60-4d5e6f708192", 1, 5000,
                             DIANA_ISSUER_COORDINATOR, DIANA_CMD_SET_TARGETS);
    v = diana_command_validate(&g, &coord, me, 3300000, 3300500);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "nonce 1 del coordinador aceptado pese a backend=43");

    SECTION("caducidad por expires_in_ms");
    diana_command slow = mk("ad506082-af5e-4d6c-bf71-5e6f70819299", 44, 2000,
                            DIANA_ISSUER_BACKEND, DIANA_CMD_REBOOT);
    /* recibido en t=4s, procesado en t=6,5s -> 2500 ms > 2000 ms */
    v = diana_command_validate(&g, &slow, me, 4000000, 6500000);
    CHECK_EQ_STR(diana_command_result_str(v.result), "expired",
                 "comando caducado rechazado");
    CHECK(strstr(v.detail, "caducado") != NULL, "el detalle indica caducidad");
    printf("       detalle: %s\n", v.detail);
    CHECK_EQ_INT(g.rejected_expired, 1, "caducidad contabilizada");

    SECTION("un comando caducado NO consume el nonce");
    /* El anterior (nonce 44) caduco; reemitirlo con el MISMO nonce y otro
     * command_id debe aceptarse: la caducidad no debe quemar el hueco. */
    diana_command retry = mk("ad506082-af5e-4d6c-bf71-5e6f70819288", 44, 2000,
                             DIANA_ISSUER_BACKEND, DIANA_CMD_REBOOT);
    v = diana_command_validate(&g, &retry, me, 7000000, 7001000);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "nonce 44 reemitido dentro de plazo se acepta");

    diana_command after = mk("ad506082-af5e-4d6c-bf71-5e6f70819277", 45, 5000,
                             DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY);
    v = diana_command_validate(&g, &after, me, 8000000, 8000100);
    CHECK_EQ_STR(diana_command_result_str(v.result), "accepted",
                 "nonce 45 posterior tambien aceptado");

    SECTION("validaciones estructurales");
    diana_command bad = mk("no-soy-un-uuid", 100, 5000, DIANA_ISSUER_BACKEND,
                           DIANA_CMD_IDENTIFY);
    v = diana_command_validate(&g, &bad, me, 9000000, 9000100);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "command_id que no es UUID rechazado");

    diana_command other = mk("ad506082-af5e-4d6c-bf71-5e6f70819266", 101, 5000,
                             DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY);
    snprintf(other.module_id, sizeof(other.module_id), "module-07");
    v = diana_command_validate(&g, &other, me, 9100000, 9100100);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "comando dirigido a otro modulo rechazado");

    diana_command future = mk("ad506082-af5e-4d6c-bf71-5e6f70819255", 102, 5000,
                              DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY);
    future.schema_version = 2;
    v = diana_command_validate(&g, &future, me, 9200000, 9200100);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "schema_version superior rechazada (contrato §7)");
    CHECK_EQ_INT(g.rejected_schema, 1, "rechazo de esquema contabilizado");

    diana_command shortexp = mk("ad506082-af5e-4d6c-bf71-5e6f70819244", 103, 50,
                                DIANA_ISSUER_BACKEND, DIANA_CMD_IDENTIFY);
    v = diana_command_validate(&g, &shortexp, me, 9300000, 9300010);
    CHECK_EQ_STR(diana_command_result_str(v.result), "rejected",
                 "expires_in_ms < 100 rechazado (fuera del rango del contrato)");

    SECTION("la cache de command_id recuerda al menos 128 ordenes");
    diana_command_guard g2;
    diana_command_guard_init(&g2);
    CHECK_EQ_INT(DIANA_CMD_CACHE, 128, "la cache es de 128, como fija el contrato");

    char cid[DIANA_UUID_LEN];
    for (int i = 0; i < 128; ++i) {
        snprintf(cid, sizeof(cid), "00000000-0000-4000-8000-%012d", i);
        diana_command c = mk(cid, (uint64_t)(i + 1), 5000, DIANA_ISSUER_BACKEND,
                             DIANA_CMD_IDENTIFY);
        diana_command_validate(&g2, &c, me, 1000, 1100);
    }
    CHECK_EQ_INT(g2.accepted, 128, "128 comandos distintos aceptados");
    snprintf(cid, sizeof(cid), "00000000-0000-4000-8000-%012d", 0);
    diana_command replay0 = mk(cid, 200, 5000, DIANA_ISSUER_BACKEND,
                               DIANA_CMD_IDENTIFY);
    v = diana_command_validate(&g2, &replay0, me, 2000, 2100);
    CHECK_EQ_STR(diana_command_result_str(v.result), "duplicate",
                 "el primero de los 128 sigue recordado");

    return g_tests_failed - before;
}
