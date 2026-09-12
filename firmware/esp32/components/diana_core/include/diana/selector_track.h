/**
 * Seguimiento del selector fisico: antirrebote y deteccion de CAMBIO estable.
 *
 * POR QUE ESTA AQUI Y NO EN main/. La cadena que empieza en este interruptor
 * --- selector -> module-status -> backend -> eleccion de coordinador -> ACL ---
 * tiene que poder demostrarse por EJECUCION, no por encontrar una llamada en un
 * fichero. Tres guardas de este proyecto (M28, M31, M39) pasaron en verde
 * comprobando que un simbolo existia mientras la rama estaba desactivada. Con
 * la decision en el nucleo, la suite de host ejercita la secuencia real de
 * lecturas y comprueba el EFECTO.
 *
 * LO QUE DECIDE:
 *   · cuando una lectura electrica se considera ESTABLE (antirrebote);
 *   · cuando ese estado estable es un CAMBIO respecto al anterior, que es lo
 *     unico que debe provocar una publicacion de `module-status`. Publicar cada
 *     lectura inundaria el topico retenido.
 *
 * EL TRANSITO NO ES UNA AVERIA. Un SPDT con el comun a masa pasa por 1,1
 * mientras el contacto viaja entre extremos: medido en el banco, entre 180 y
 * 420 ms en cada cambio legitimo. Ese estado NO concede autoridad, NO cambia el
 * coordinador y NO es todavia SELECTOR_FAULT --- la politica de averia (estado
 * invalido PERSISTENTE) se decide en el paso 3, y por eso aqui solo se informa
 * de cuanto lleva, sin veredicto.
 */
#ifndef DIANA_SELECTOR_TRACK_H
#define DIANA_SELECTOR_TRACK_H

#include <stdbool.h>
#include <stdint.h>

#include "diana/sensors.h"
#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Muestras iguales consecutivas para dar una lectura por estable. */
#define DIANA_SELECTOR_DEBOUNCE 3

typedef enum {
    DIANA_SEL_EV_NADA = 0,      /* sin novedad: ni estable nuevo, ni cambio */
    DIANA_SEL_EV_CAMBIO,        /* posicion VALIDA distinta a la anterior */
    DIANA_SEL_EV_INVALIDO,      /* lectura estable pero no decodificable */
} diana_selector_event;

typedef struct {
    int      crudo_candidato;   /* (s1<<1)|s2 en observacion */
    uint8_t  muestras;
    int      crudo_estable;     /* ultimo crudo confirmado */
    bool     tiene_posicion;    /* ya hubo una posicion valida */
    diana_selector_position posicion;
    uint64_t invalido_desde_us; /* 0 si el estado actual es valido */
} diana_selector_tracker;

void diana_selector_tracker_reset(diana_selector_tracker *t);

/**
 * Incorpora una lectura de los dos GPIO.
 *
 * @param out_pos  posicion resultante cuando devuelve CAMBIO.
 * @param now_us   reloj monotonico, para medir cuanto lleva un estado invalido.
 * @return         el evento; NADA en la inmensa mayoria de las vueltas.
 */
diana_selector_event diana_selector_track(diana_selector_tracker *t,
                                          int s1, int s2,
                                          diana_selector_profile profile,
                                          uint64_t now_us,
                                          diana_selector_position *out_pos);

/** Microsegundos que lleva el selector en un estado invalido; 0 si es valido. */
uint64_t diana_selector_invalid_for(const diana_selector_tracker *t,
                                    uint64_t now_us);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_SELECTOR_TRACK_H */
