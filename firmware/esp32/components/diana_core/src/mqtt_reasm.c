#include "diana/mqtt_reasm.h"

#include <string.h>

void diana_mqtt_reasm_reset(diana_mqtt_reasm *r)
{
    if (!r) return;
    r->activo = false;
    r->total = 0;
    r->recibido = 0;
}

/* Descarta el mensaje en curso y devuelve ERROR con su motivo. Se centraliza
 * aqui para que NINGUN camino de error pueda olvidarse de limpiar el estado:
 * un parcial que sobrevive a un error contamina el mensaje siguiente. */
static diana_reasm_result fallo(diana_mqtt_reasm *r, const char **motivo,
                                const char *texto)
{
    diana_mqtt_reasm_reset(r);
    *motivo = texto;
    return DIANA_REASM_ERROR;
}

diana_reasm_result diana_mqtt_reasm_feed(diana_mqtt_reasm *r,
                                         int total_data_len,
                                         int current_data_offset,
                                         const char *data, int data_len,
                                         char *dst, size_t cap,
                                         size_t *out_len,
                                         const char **motivo)
{
    static const char *SIN_MOTIVO = "";
    if (motivo) *motivo = SIN_MOTIVO;
    if (!r || !dst || !out_len || !motivo) return DIANA_REASM_ERROR;
    *out_len = 0;

    /* Un evento con cifras negativas esta corrupto: no se interpreta, se
     * rechaza. Convertirlo a size_t antes de comprobarlo lo volveria enorme. */
    if (total_data_len < 0 || current_data_offset < 0 || data_len < 0)
        return fallo(r, motivo, "evento con longitudes negativas");
    if (data_len > 0 && !data)
        return fallo(r, motivo, "fragmento con datos nulos");

    size_t total = (size_t)total_data_len;
    size_t off   = (size_t)current_data_offset;
    size_t len   = (size_t)data_len;

    if (off == 0) {
        /* Primer fragmento. Si habia uno a medias, el anterior se perdio por el
         * camino: se descarta con aviso y se empieza limpio. No se mezcla. */
        bool habia_parcial = r->activo;
        diana_mqtt_reasm_reset(r);

        /* El rechazo por capacidad se decide con el TOTAL, no con lo que quepa:
         * asi se descarta el mensaje entero de entrada y no se llega nunca a
         * escribir un payload truncado, que produciria JSON invalido y un
         * rechazo confuso aguas abajo. */
        if (total > cap) {
            *motivo = "payload por encima de la capacidad";
            return DIANA_REASM_ERROR;
        }
        if (len > total)
            return fallo(r, motivo, "primer fragmento mayor que el total");

        r->activo = true;
        r->total = total;
        r->recibido = 0;
        if (habia_parcial) {
            /* Se senala, pero no se aborta el mensaje NUEVO: el corrupto era el
             * anterior. Perder tambien este castigaria al mensaje inocente. */
            *motivo = "se descarto un mensaje anterior incompleto";
        }
    } else {
        if (!r->activo)
            return fallo(r, motivo, "continuacion sin mensaje en curso");
        if (total != r->total)
            return fallo(r, motivo, "el total cambio a mitad del mensaje");
        if (off != r->recibido)
            return fallo(r, motivo, "fragmento fuera de orden o solapado");
    }

    /* offset + data_len <= total, comprobado sin desbordar la suma. */
    if (len > r->total - off)
        return fallo(r, motivo, "el fragmento se sale del total declarado");

    if (len > 0) memcpy(dst + off, data, len);
    r->recibido = off + len;

    if (r->recibido < r->total) return DIANA_REASM_INCOMPLETO;

    /* Completo: se entrega UNA vez y el estado queda limpio, de modo que un
     * evento repetido despues no puede volver a entregarlo. */
    size_t n = r->recibido;
    dst[n] = '\0';
    *out_len = n;
    diana_mqtt_reasm_reset(r);
    return DIANA_REASM_COMPLETO;
}
