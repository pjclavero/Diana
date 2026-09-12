/**
 * @file test_selector_track.c
 * @brief Selector fisico · antirrebote, cambio estable y transito.
 *
 * Estas pruebas reproducen la SECUENCIA MEDIDA en el banco, no una inventada:
 *
 *   GPIO15=1 GPIO16=0   SATELITE
 *   GPIO15=1 GPIO16=1   transito (180-420 ms, el comun viaja entre contactos)
 *   GPIO15=0 GPIO16=1   PRINCIPAL
 *   ...y la vuelta
 *
 * Lo que se fija aqui es lo que hace falta para que la eleccion automatica de
 * coordinador (paso 3) sea deterministica: que se publique `module-status`
 * EXACTAMENTE cuando el selector alcanza una posicion valida distinta, y no en
 * cada lectura ni en el transito.
 *
 * Se prueba por EJECUCION. Tres guardas de este proyecto pasaron en verde
 * comprobando que un simbolo existia mientras la rama estaba desactivada; en
 * esta cadena eso no basta.
 */
#include <string.h>

#include "diana/selector_track.h"
#include "test_util.h"

#define PERFIL DIANA_SELECTOR_2_POSITION

/** Alimenta la misma lectura `n` veces y devuelve el ultimo evento. */
static diana_selector_event repetir(diana_selector_tracker *t, int s1, int s2,
                                    int n, uint64_t *reloj,
                                    diana_selector_position *pos)
{
    diana_selector_event ev = DIANA_SEL_EV_NADA;
    for (int i = 0; i < n; ++i) {
        *reloj += 20000;   /* 20 ms por vuelta, como el bucle real */
        diana_selector_event e =
            diana_selector_track(t, s1, s2, PERFIL, *reloj, pos);
        if (e != DIANA_SEL_EV_NADA) ev = e;
    }
    return ev;
}

int run_selector_track(void)
{
    TEST_SUITE("selector_track");
    int before = g_tests_failed;

    SECTION("la secuencia REAL del banco: SATELITE -> transito -> PRINCIPAL");
    {
        diana_selector_tracker t;
        diana_selector_tracker_reset(&t);
        diana_selector_position pos = DIANA_SELECTOR_SATELITE;
        uint64_t reloj = 0;

        diana_selector_event ev = repetir(&t, 1, 0, 5, &reloj, &pos);
        CHECK(ev == DIANA_SEL_EV_CAMBIO && pos == DIANA_SELECTOR_SATELITE,
              "la primera posicion estable es un CAMBIO (no habia ninguna)");

        /* El transito: 1,1 durante ~300 ms = 15 vueltas de 20 ms. */
        ev = repetir(&t, 1, 1, 15, &reloj, &pos);
        CHECK(ev == DIANA_SEL_EV_INVALIDO,
              "el transito se reconoce como estado invalido, no como posicion");
        CHECK(pos == DIANA_SELECTOR_SATELITE,
              "y NO cambia la posicion: el transito no concede autoridad");

        ev = repetir(&t, 0, 1, 5, &reloj, &pos);
        CHECK(ev == DIANA_SEL_EV_CAMBIO && pos == DIANA_SELECTOR_PRINCIPAL,
              "al completar el recorrido: CAMBIO a PRINCIPAL");
        CHECK(diana_selector_invalid_for(&t, reloj) == 0,
              "y el estado deja de estar en invalido");
    }

    SECTION("un cambio se anuncia UNA sola vez");
    {
        /* Si se anunciara en cada vuelta, el `module-status` retenido se
         * republicaria 50 veces por segundo. */
        diana_selector_tracker t;
        diana_selector_tracker_reset(&t);
        diana_selector_position pos;
        uint64_t reloj = 0;

        (void)repetir(&t, 1, 0, 5, &reloj, &pos);
        int cambios = 0;
        for (int i = 0; i < 50; ++i) {
            reloj += 20000;
            if (diana_selector_track(&t, 1, 0, PERFIL, reloj, &pos)
                == DIANA_SEL_EV_CAMBIO) cambios++;
        }
        CHECK_EQ_INT(cambios, 0, "50 lecturas iguales despues: ningun cambio nuevo");
    }

    SECTION("volver a la MISMA posicion tras un transito no es un cambio");
    {
        /* Pasa al tantear el interruptor sin llegar al otro extremo. Publicar
         * ahi seria ruido: el selector esta donde estaba. */
        diana_selector_tracker t;
        diana_selector_tracker_reset(&t);
        diana_selector_position pos;
        uint64_t reloj = 0;

        (void)repetir(&t, 1, 0, 5, &reloj, &pos);
        (void)repetir(&t, 1, 1, 10, &reloj, &pos);     /* transito */
        diana_selector_event ev = repetir(&t, 1, 0, 5, &reloj, &pos);
        CHECK(ev != DIANA_SEL_EV_CAMBIO,
              "vuelve a SATELITE: no se anuncia cambio");
    }

    SECTION("el antirrebote descarta una lectura suelta");
    {
        diana_selector_tracker t;
        diana_selector_tracker_reset(&t);
        diana_selector_position pos;
        uint64_t reloj = 0;
        (void)repetir(&t, 1, 0, 5, &reloj, &pos);

        /* Un unico rebote a PRINCIPAL, menos que el antirrebote. */
        diana_selector_event ev = repetir(&t, 0, 1, DIANA_SELECTOR_DEBOUNCE - 1,
                                         &reloj, &pos);
        CHECK(ev != DIANA_SEL_EV_CAMBIO,
              "una lectura suelta no cambia la posicion");
        CHECK(pos == DIANA_SELECTOR_SATELITE, "sigue siendo SATELITE");
    }

    SECTION("cuanto lleva invalido: el dato que necesita la politica de averia");
    {
        /* El paso 3 decidira el umbral (el operador propuso 1 s). Aqui solo se
         * mide, sin emitir veredicto: un transito de 300 ms y una averia de 5 s
         * se distinguen por esta cifra. */
        diana_selector_tracker t;
        diana_selector_tracker_reset(&t);
        diana_selector_position pos;
        uint64_t reloj = 0;
        (void)repetir(&t, 1, 0, 5, &reloj, &pos);

        (void)repetir(&t, 1, 1, 5, &reloj, &pos);
        uint64_t transito = diana_selector_invalid_for(&t, reloj);
        CHECK(transito > 0, "un estado invalido se empieza a cronometrar");

        reloj += 5000000ULL;   /* +5 s ahi clavado */
        CHECK(diana_selector_invalid_for(&t, reloj) > 1000000ULL,
              "y a los 5 s la cifra ya supera el segundo: distinguible de un transito");
    }

    return g_tests_failed - before;
}
