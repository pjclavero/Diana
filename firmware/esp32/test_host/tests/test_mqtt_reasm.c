/**
 * @file test_mqtt_reasm.c
 * @brief Reensamblado de payloads MQTT fragmentados.
 *
 * EL DEFECTO QUE ORIGINA ESTA SUITE. El manejador de MQTT_EVENT_DATA copiaba
 * `ev->data_len` bytes y daba el mensaje por terminado, sin mirar
 * `current_data_offset` ni `total_data_len`. Con payloads pequenos acierta por
 * casualidad --- un fragmento unico ES el mensaje ---, y por eso nada lo delato
 * durante meses. En cuanto esp-mqtt parte el mensaje, lo que llega al parser es
 * el PRIMER TROZO: JSON invalido, rechazo confuso, y la configuracion sin
 * aplicar. El `config/desired` de un modulo 3x3 son 2239 bytes, asi que el caso
 * fragmentado no es el raro: es el normal.
 *
 * QUE SE PRUEBA AQUI. El reensamblador completo, fragmento a fragmento, con la
 * misma secuencia de eventos que entrega esp-mqtt. Las cifras negativas, los
 * solapamientos y los totales inconsistentes se inyectan de verdad; no se
 * confia en que "eso no pasa".
 *
 * ENTREGA EXACTAMENTE UNA VEZ. Un contador de entregas acompana cada caso: un
 * reensamblador que devolviera COMPLETO dos veces aplicaria la configuracion
 * dos veces, y eso es indistinguible de un mensaje duplicado del broker. Se
 * cuenta, no se supone.
 */
#include <string.h>

#include "diana/mqtt_reasm.h"
#include "test_util.h"

/* Capacidad pequena a proposito: llegar al limite con 64 bytes es exacto y
 * legible; con 4096 habria que manejar kilobytes para probar lo mismo. */
#define CAP 64

typedef struct {
    diana_mqtt_reasm r;
    char buf[CAP + 1];
    int entregas;           /* cuantas veces se ha devuelto COMPLETO */
    size_t ultima_len;
    const char *motivo;
} banco;

static void banco_init(banco *b)
{
    memset(b, 0, sizeof(*b));
    diana_mqtt_reasm_reset(&b->r);
    memset(b->buf, 'X', sizeof(b->buf));   /* veneno: delata lo no escrito */
}

/** Inyecta un fragmento y contabiliza las entregas. */
static diana_reasm_result frag(banco *b, int total, int off,
                               const char *data, int len)
{
    size_t n = 0;
    diana_reasm_result res = diana_mqtt_reasm_feed(
        &b->r, total, off, data, len, b->buf, CAP, &n, &b->motivo);
    if (res == DIANA_REASM_COMPLETO) {
        b->entregas++;
        b->ultima_len = n;
    }
    return res;
}

/** Entrega un mensaje partido en trozos de `paso` bytes. */
static diana_reasm_result por_trozos(banco *b, const char *msg, size_t paso)
{
    size_t total = strlen(msg);
    diana_reasm_result res = DIANA_REASM_INCOMPLETO;
    for (size_t off = 0; off < total; off += paso) {
        size_t len = (total - off < paso) ? total - off : paso;
        res = frag(b, (int)total, (int)off, msg + off, (int)len);
        if (res == DIANA_REASM_ERROR) return res;
    }
    return res;
}

int run_mqtt_reasm(void)
{
    TEST_SUITE("mqtt_reasm");
    int before = g_tests_failed;

    SECTION("el caso que ya funcionaba: un solo fragmento");
    {
        banco b; banco_init(&b);
        const char *m = "{\"config_version\":1}";
        CHECK(frag(&b, (int)strlen(m), 0, m, (int)strlen(m)) == DIANA_REASM_COMPLETO,
              "payload pequeno en un fragmento -> COMPLETO");
        CHECK_EQ_STR(b.buf, m, "el payload llega intacto");
        CHECK_EQ_INT(b.ultima_len, strlen(m), "longitud exacta");
        CHECK_EQ_INT(b.entregas, 1, "entregado UNA sola vez");
        CHECK(!b.r.activo, "el estado queda limpio tras entregar");
    }

    SECTION("payload vacio");
    {
        banco b; banco_init(&b);
        CHECK(frag(&b, 0, 0, "", 0) == DIANA_REASM_COMPLETO,
              "total 0 -> COMPLETO inmediato, no un mensaje colgado");
        CHECK_EQ_INT(b.ultima_len, 0, "longitud 0");
        CHECK_EQ_STR(b.buf, "", "terminado en NUL");
    }

    SECTION("fragmentado en dos partes");
    {
        banco b; banco_init(&b);
        const char *m = "{\"a\":1,\"b\":2}";
        int total = (int)strlen(m);
        CHECK(frag(&b, total, 0, m, 5) == DIANA_REASM_INCOMPLETO,
              "el primer trozo NO se entrega");
        CHECK_EQ_INT(b.entregas, 0, "y no ha habido ninguna entrega");
        CHECK(frag(&b, total, 5, m + 5, total - 5) == DIANA_REASM_COMPLETO,
              "el segundo completa el mensaje");
        CHECK_EQ_STR(b.buf, m, "el mensaje reensamblado es el original");
        CHECK_EQ_INT(b.entregas, 1, "UNA entrega, no dos");
    }

    SECTION("fragmentado en muchas partes");
    {
        /* 60 bytes en trozos de 7: 8 fragmentos, el ultimo corto. */
        banco b; banco_init(&b);
        char m[61];
        for (int i = 0; i < 60; i++) m[i] = (char)('a' + (i % 26));
        m[60] = '\0';
        CHECK(por_trozos(&b, m, 7) == DIANA_REASM_COMPLETO,
              "60 bytes en trozos de 7 -> COMPLETO");
        CHECK_EQ_STR(b.buf, m, "reensamblado byte a byte correcto");
        CHECK_EQ_INT(b.entregas, 1, "una sola entrega en 9 eventos");
    }

    SECTION("cortes en posiciones incomodas del JSON");
    {
        /* El corte cae dentro de una cadena, sobre el escape y justo entre la
         * clave y los dos puntos. Un reensamblador que mirase el contenido
         * --- buscando la llave de cierre, por ejemplo --- se rompe aqui. */
        const char *m = "{\"friendly_name\":\"Modulo \\\"1\\\"\",\"v\":12}";
        size_t total = strlen(m);
        const size_t cortes[] = {1, 15, 16, 17, 24, 25, total - 2, total - 1};
        for (size_t i = 0; i < sizeof(cortes) / sizeof(cortes[0]); i++) {
            size_t c = cortes[i];
            banco b; banco_init(&b);
            diana_reasm_result r1 = frag(&b, (int)total, 0, m, (int)c);
            diana_reasm_result r2 = frag(&b, (int)total, (int)c, m + c, (int)(total - c));
            CHECK(r1 == DIANA_REASM_INCOMPLETO && r2 == DIANA_REASM_COMPLETO
                      && strcmp(b.buf, m) == 0 && b.entregas == 1,
                  "corte arbitrario dentro del JSON se reensambla igual");
        }
    }

    SECTION("el ultimo byte y el terminador");
    {
        banco b; banco_init(&b);
        const char *m = "{\"x\":1}";
        int total = (int)strlen(m);
        CHECK(frag(&b, total, 0, m, total - 1) == DIANA_REASM_INCOMPLETO,
              "falta un solo byte -> INCOMPLETO, no se entrega");
        CHECK(b.buf[total - 1] == 'X',
              "y ese ultimo byte sigue sin escribirse");
        CHECK(frag(&b, total, total - 1, m + total - 1, 1) == DIANA_REASM_COMPLETO,
              "el ultimo byte, solo, completa");
        CHECK(b.buf[total] == '\0', "el NUL se escribe en la posicion exacta");
        CHECK_EQ_STR(b.buf, m, "y el contenido es el correcto");
    }

    SECTION("capacidad: el limite exacto entra, uno mas no");
    {
        char m[CAP + 1];
        memset(m, 'z', CAP); m[CAP] = '\0';

        banco b; banco_init(&b);
        CHECK(por_trozos(&b, m, 10) == DIANA_REASM_COMPLETO,
              "un payload de EXACTAMENTE la capacidad se acepta");
        CHECK_EQ_INT(b.ultima_len, CAP, "con su longitud completa");
        CHECK(b.buf[CAP] == '\0', "y el NUL cabe (el buffer lleva +1)");

        banco c; banco_init(&c);
        CHECK(frag(&c, CAP + 1, 0, m, 10) == DIANA_REASM_ERROR,
              "un byte por encima de la capacidad -> ERROR");
        CHECK_EQ_INT(c.entregas, 0, "sin entrega");
        CHECK(!c.r.activo, "y sin mensaje a medias que arrastrar");

        banco d; banco_init(&d);
        (void)frag(&d, 4096, 0, m, 10);
        CHECK(d.buf[0] == 'X',
              "el rechazo por capacidad NO llega a escribir: no hay truncado");
    }

    SECTION("fragmentos invalidos: cada uno descarta el mensaje entero");
    {
        const char *m = "0123456789";

        banco b; banco_init(&b);
        (void)frag(&b, 10, 0, m, 4);
        CHECK(frag(&b, 10, 7, m + 7, 3) == DIANA_REASM_ERROR,
              "salto en el offset (hueco sin rellenar) -> ERROR");
        CHECK(!b.r.activo && b.entregas == 0, "estado limpio, 0 entregas");

        banco c; banco_init(&c);
        (void)frag(&c, 10, 0, m, 6);
        CHECK(frag(&c, 10, 3, m + 3, 7) == DIANA_REASM_ERROR,
              "fragmento SOLAPADO -> ERROR, no se acomoda");

        banco d; banco_init(&d);
        (void)frag(&d, 10, 0, m, 4);
        CHECK(frag(&d, 12, 4, m + 4, 6) == DIANA_REASM_ERROR,
              "el total cambia a mitad del mensaje -> ERROR");

        banco e; banco_init(&e);
        (void)frag(&e, 10, 0, m, 4);
        CHECK(frag(&e, 10, 4, m + 4, 9) == DIANA_REASM_ERROR,
              "offset + data_len por encima del total -> ERROR");

        banco f; banco_init(&f);
        CHECK(frag(&f, 10, 4, m, 6) == DIANA_REASM_ERROR,
              "continuacion sin mensaje en curso -> ERROR");

        banco g; banco_init(&g);
        CHECK(frag(&g, -1, 0, m, 4) == DIANA_REASM_ERROR,
              "total negativo -> ERROR (no se convierte a un size_t enorme)");
        banco h; banco_init(&h);
        CHECK(frag(&h, 10, -4, m, 4) == DIANA_REASM_ERROR, "offset negativo -> ERROR");
        banco i; banco_init(&i);
        CHECK(frag(&i, 10, 0, m, -4) == DIANA_REASM_ERROR, "data_len negativo -> ERROR");

        banco j; banco_init(&j);
        CHECK(frag(&j, 10, 0, m, 11) == DIANA_REASM_ERROR,
              "primer fragmento mayor que el total -> ERROR");
    }

    SECTION("todo error deja un diagnostico util");
    {
        banco b; banco_init(&b);
        (void)frag(&b, 10, 0, "0123456789", 4);
        (void)frag(&b, 10, 7, "789", 3);
        CHECK(b.motivo && b.motivo[0] != '\0',
              "el motivo no viene vacio: se puede diagnosticar sin la placa");
    }

    SECTION("el mensaje siguiente a un fallo se procesa bien");
    {
        banco b; banco_init(&b);
        (void)frag(&b, 10, 0, "0123456789", 4);
        CHECK(frag(&b, 10, 9, "9", 1) == DIANA_REASM_ERROR, "fallo previo");

        const char *m = "{\"ok\":true}";
        int total = (int)strlen(m);
        CHECK(frag(&b, total, 0, m, 5) == DIANA_REASM_INCOMPLETO,
              "y el mensaje SIGUIENTE arranca limpio");
        CHECK(frag(&b, total, 5, m + 5, total - 5) == DIANA_REASM_COMPLETO,
              "se completa con normalidad");
        CHECK_EQ_STR(b.buf, m, "sin restos del mensaje fallido");
        CHECK_EQ_INT(b.entregas, 1, "UNA entrega");
    }

    SECTION("un mensaje abandonado a medias no contamina al siguiente");
    {
        /* Sin error explicito: simplemente llega un offset 0 nuevo. El parcial
         * anterior se descarta; el mensaje NUEVO no paga por ello. */
        banco b; banco_init(&b);
        (void)frag(&b, 40, 0, "aaaaaaaaaa", 10);
        const char *m = "{\"nuevo\":1}";
        int total = (int)strlen(m);
        CHECK(frag(&b, total, 0, m, total) == DIANA_REASM_COMPLETO,
              "el mensaje nuevo se entrega");
        CHECK_EQ_STR(b.buf, m, "y no arrastra los bytes del abandonado");
        CHECK(b.motivo && strstr(b.motivo, "anterior") != NULL,
              "pero el descarte del anterior queda registrado");
    }

    SECTION("entrega EXACTAMENTE una vez");
    {
        banco b; banco_init(&b);
        const char *m = "{\"v\":9}";
        int total = (int)strlen(m);
        (void)frag(&b, total, 0, m, 3);
        (void)frag(&b, total, 3, m + 3, total - 3);
        CHECK_EQ_INT(b.entregas, 1, "completado -> 1 entrega");
        /* Un evento tardio repetido del ultimo fragmento: el estado ya esta
         * limpio, asi que es una continuacion sin mensaje --- error, no una
         * segunda entrega de lo mismo. */
        CHECK(frag(&b, total, 3, m + 3, total - 3) == DIANA_REASM_ERROR,
              "repetir el ultimo fragmento NO vuelve a entregar");
        CHECK_EQ_INT(b.entregas, 1, "sigue habiendo UNA sola entrega");
    }

    SECTION("el caso real: un config/desired de 2239 bytes fragmentado");
    {
        /* Mismo tamano que el mensaje que la placa descartaba, troceado como lo
         * entrega esp-mqtt con su buffer de red por defecto (1024). Se usa un
         * reensamblador con capacidad real, no el CAP reducido de arriba. */
        enum { REAL = 2239, CAP_REAL = 4096 };
        static char msg[REAL + 1];
        static char dst[CAP_REAL + 1];
        for (int i = 0; i < REAL; i++) msg[i] = (char)('!' + (i % 90));
        msg[REAL] = '\0';

        diana_mqtt_reasm r; diana_mqtt_reasm_reset(&r);
        memset(dst, 'X', sizeof(dst));
        int entregas = 0; size_t n = 0; const char *motivo = NULL;
        for (int off = 0; off < REAL; off += 1024) {
            int len = (REAL - off < 1024) ? REAL - off : 1024;
            if (diana_mqtt_reasm_feed(&r, REAL, off, msg + off, len,
                                      dst, CAP_REAL, &n, &motivo)
                == DIANA_REASM_COMPLETO) entregas++;
        }
        CHECK_EQ_INT(entregas, 1, "2239 bytes en 3 fragmentos -> 1 entrega");
        CHECK_EQ_INT(n, REAL, "longitud exacta del mensaje real");
        CHECK(memcmp(dst, msg, REAL) == 0 && dst[REAL] == '\0',
              "contenido identico al original, terminado en NUL");
    }

    return g_tests_failed - before;
}
