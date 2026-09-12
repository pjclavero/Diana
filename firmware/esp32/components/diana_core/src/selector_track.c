#include "diana/selector_track.h"

#include <string.h>

#include "diana/sensors.h"

void diana_selector_tracker_reset(diana_selector_tracker *t)
{
    if (!t) return;
    memset(t, 0, sizeof(*t));
    t->crudo_candidato = -1;
    t->crudo_estable = -1;
}

diana_selector_event diana_selector_track(diana_selector_tracker *t,
                                          int s1, int s2,
                                          diana_selector_profile profile,
                                          uint64_t now_us,
                                          diana_selector_position *out_pos)
{
    if (!t) return DIANA_SEL_EV_NADA;

    int crudo = (s1 << 1) | s2;
    if (crudo != t->crudo_candidato) {
        t->crudo_candidato = crudo;
        t->muestras = 1;
    } else if (t->muestras < DIANA_SELECTOR_DEBOUNCE) {
        t->muestras++;
    }

    /* Hasta que no hay DEBOUNCE muestras iguales no se decide nada: es lo que
     * impide que el transito de 180-420 ms se lea como una posicion nueva en la
     * primera vuelta del bucle. */
    if (t->muestras < DIANA_SELECTOR_DEBOUNCE) return DIANA_SEL_EV_NADA;
    if (crudo == t->crudo_estable) return DIANA_SEL_EV_NADA;

    t->crudo_estable = crudo;

    diana_selector_position pos;
    if (diana_selector_decode(s1, s2, profile, &pos) != DIANA_HAL_OK) {
        /* Estado estable pero no decodificable. Se anota DESDE CUANDO, para
         * que quien decida la politica de averia (paso 3) pueda distinguir un
         * transito de un fallo persistente. Aqui no se emite veredicto. */
        if (t->invalido_desde_us == 0) t->invalido_desde_us = now_us;
        return DIANA_SEL_EV_INVALIDO;
    }

    t->invalido_desde_us = 0;

    /* Un estado valido que REPITE la posicion anterior no es un cambio: pasa
     * al volver de un transito a la misma posicion. Publicar ahi seria ruido. */
    if (t->tiene_posicion && t->posicion == pos) return DIANA_SEL_EV_NADA;

    t->tiene_posicion = true;
    t->posicion = pos;
    if (out_pos) *out_pos = pos;
    return DIANA_SEL_EV_CAMBIO;
}

uint64_t diana_selector_invalid_for(const diana_selector_tracker *t,
                                    uint64_t now_us)
{
    if (!t || t->invalido_desde_us == 0) return 0;
    return (now_us > t->invalido_desde_us) ? (now_us - t->invalido_desde_us) : 0;
}
