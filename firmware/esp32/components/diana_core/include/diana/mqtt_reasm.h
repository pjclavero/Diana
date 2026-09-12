/* Reensamblado de payloads MQTT fragmentados.
 *
 * POR QUE VIVE EN diana_core Y NO EN EL COMPONENTE ESP. El defecto original
 * estaba en `mqtt_client.c`, que NO se compila en host: el manejador copiaba
 * `ev->data_len` bytes y daba el mensaje por completo, ignorando
 * `current_data_offset` y `total_data_len`. Con un payload que cabe en el
 * buffer de red eso funciona por casualidad; en cuanto esp-mqtt parte el
 * mensaje --- y el `config/desired` de un modulo 3x3 son 2239 bytes, muy por
 * encima del buffer de recepcion tipico --- lo que llegaba al parser era el
 * PRIMER TROZO, JSON invalido, rechazado con un diagnostico que no apuntaba a
 * la causa.
 *
 * Dejarlo ahi habria significado no poder probarlo. Aqui es logica pura, sin
 * ESP-IDF ni FreeRTOS, y la suite de host la ejercita fragmento a fragmento.
 *
 * EL BUFFER NO ES SUYO. El llamante aporta destino y capacidad, de modo que
 * este modulo no necesita conocer DIANA_MQTT_RX_PAYLOAD_MAX y las pruebas
 * pueden trabajar con capacidades pequenas para llegar al limite sin manejar
 * kilobytes.
 *
 * INVARIANTES que impone, todas verificadas contra lo recibido y ninguna
 * supuesta:
 *   · `total` no cambia mientras dure un mensaje;
 *   · `offset + data_len <= total`;
 *   · los fragmentos llegan CONTIGUOS: `offset == bytes ya colocados`. Un
 *     solapamiento o un salto es un error, no algo que se acomoda;
 *   · `total > capacidad` se rechaza LIMPIAMENTE, sin truncar;
 *   · un mensaje se entrega EXACTAMENTE UNA VEZ, al completarse;
 *   · un mensaje incompleto no se entrega JAMAS;
 *   · ante error se descarta el mensaje ENTERO y el estado queda limpio, listo
 *     para el siguiente.
 */
#ifndef DIANA_MQTT_REASM_H
#define DIANA_MQTT_REASM_H

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    DIANA_REASM_INCOMPLETO = 0, /* faltan fragmentos: no entregar nada */
    DIANA_REASM_COMPLETO   = 1, /* mensaje entero: entregar UNA vez */
    DIANA_REASM_ERROR      = 2, /* descartado; el estado ya quedo limpio */
} diana_reasm_result;

/** Estado del mensaje en curso. Basta con memset a cero para inicializarlo. */
typedef struct {
    bool   activo;     /* hay un mensaje a medias */
    size_t total;      /* total_data_len declarado por el primer fragmento */
    size_t recibido;   /* bytes CONTIGUOS ya colocados en el destino */
} diana_mqtt_reasm;

/** Deja el reensamblador sin mensaje en curso. */
void diana_mqtt_reasm_reset(diana_mqtt_reasm *r);

/**
 * Incorpora un fragmento.
 *
 * @param total_data_len    tal cual lo entrega esp-mqtt (puede ser negativo si
 *                          el evento viene corrupto: se trata como error)
 * @param current_data_offset  idem
 * @param dst / cap         buffer del llamante y su capacidad UTIL en bytes
 *                          (sin contar el NUL, que se escribe en dst[len])
 * @param out_len           al devolver COMPLETO, longitud exacta del payload
 * @param motivo            diagnostico util cuando devuelve ERROR; nunca NULL
 *
 * Al devolver COMPLETO el buffer queda terminado en NUL y el estado limpio.
 */
diana_reasm_result diana_mqtt_reasm_feed(diana_mqtt_reasm *r,
                                         int total_data_len,
                                         int current_data_offset,
                                         const char *data, int data_len,
                                         char *dst, size_t cap,
                                         size_t *out_len,
                                         const char **motivo);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_MQTT_REASM_H */
