/**
 * @file shiftreg.h
 * @brief Decodificacion de la captura de DOS SN74HC165 en cascada.
 *
 * RESCATE SELECTIVO desde la rama hw/do-only-v1 (MP0-S). Lo que aporta este
 * modulo y NO existia en el firmware verificado fisicamente es sacar el
 * CONVENIO DE CABLEADO de dentro del bucle de bit-banging (io_hc165.c, codigo
 * que solo compila para ESP-IDF y que por tanto ninguna prueba de host podia
 * tocar) y ponerlo en codigo puro comprobable.
 *
 * TOPOLOGIA (fuente normativa: boards/esp32s3_proto_do_w5500.h y
 * docs/hardware/conexionado-prototipo.md)
 * ---------------------------------------------------------------------------
 *   registro #1  entradas A..H  -> dianas D1..D8
 *   registro #2  entrada  A     -> diana  D9
 *                entradas B..H  -> RESERVA (se ignoran, no son averia)
 *
 *   #1 QH/SER_OUT -> #2 SER_IN      (#1 es el registro LEJANO al ESP32)
 *   #2 QH/SER_OUT -> ESP32 GPIO38   (#2 es el registro CERCANO al ESP32)
 *
 * ORDEN DE LA CASCADA
 * ---------------------------------------------------------------------------
 * Al volver SH/LD a alto, QH del registro CERCANO (#2) ya presenta su bit H, y
 * cada flanco de CLK desplaza uno mas hacia el ESP32: los primeros ocho bits
 * que entran por SR_DATA son los del #2 (H primero, A ultimo) y los ocho
 * siguientes los del #1 (H primero, A ultimo). De ahi el convenio de la
 * palabra cruda:
 *
 *   raw bit 0..7   = registro #1, entradas A..H  -> D1..D8
 *   raw bit 8      = registro #2, entrada  A     -> D9
 *   raw bit 9..15  = registro #2, entradas B..H  -> reserva
 *
 * `diana_shiftreg_pack()` es exactamente la transformacion que hace el bucle de
 * io_hc165.c (`raw = (raw << 1) | nivel`), extraida para poder probarla. Si
 * alguien invierte la cascada al cablear, lo delata esta funcion y su prueba,
 * no una constante escondida en la capa de plataforma.
 *
 * POLARIDAD: no se aplica aqui. Vive en `diana_do_active_bitmap()`
 * (sensors.h), en un unico sitio. Esta funcion devuelve NIVELES ELECTRICOS.
 *
 * PENDING_PHYSICAL_VALIDATION: el orden de la cascada NO se ha comprobado
 * sobre hardware. El banco 2026-08-20 se interrumpio al calentarse el primer
 * 74HC165 y no llegaron a leerse los 16 bits con sensores en posiciones
 * conocidas. Lo que esta probado es la COHERENCIA entre el convenio
 * documentado y el codigo que lee los pines, no el cableado real.
 */
#ifndef DIANA_SHIFTREG_H
#define DIANA_SHIFTREG_H

#include <stdint.h>

#include "diana/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Numero de registros en cascada y bits por registro. */
#define DIANA_SR_CHIPS         2
#define DIANA_SR_BITS_PER_CHIP 8
#define DIANA_SR_TOTAL_BITS    (DIANA_SR_CHIPS * DIANA_SR_BITS_PER_CHIP)

typedef struct {
    /** Bits de la cadena completa. Debe valer DIANA_SR_TOTAL_BITS. */
    uint8_t total_bits;
    /**
     * Tabla EXPLICITA bit->diana: `bit_to_target[i]` es el indice de diana
     * (1..9) del bit i de la palabra cruda, o 0 si ese bit es reserva.
     * Explicita a proposito: una formula `bit+1` funciona por casualidad con
     * este cableado y deja de funcionar en cuanto alguien mueva una entrada.
     */
    uint8_t bit_to_target[DIANA_SR_TOTAL_BITS];
} diana_shiftreg_cfg;

/** Rellena la configuracion con el cableado del prototipo DO-only. */
void diana_shiftreg_cfg_defaults(diana_shiftreg_cfg *cfg);

/**
 * Convierte la secuencia serie leida del pin SR_DATA en la palabra cruda.
 *
 * @param serial `serial[0]` es el PRIMER bit que sale por SR_DATA tras el
 *               flanco de SH/LD; `serial[n-1]` el ultimo. Cada elemento es el
 *               nivel electrico leido (0 o 1), sin aplicar polaridad.
 * @param n      numero de bits leidos; debe ser `cfg->total_bits`.
 * @return palabra cruda de 16 bits, o 0 si `n` no es el esperado (no se
 *         adivina una trama incompleta).
 */
uint16_t diana_shiftreg_pack(const diana_shiftreg_cfg *cfg,
                             const uint8_t *serial, uint8_t n);

/** Indice de diana (1..9) del bit dado, o 0 si es reserva o esta fuera de rango. */
uint8_t diana_shiftreg_bit_target(const diana_shiftreg_cfg *cfg, uint8_t bit);

/** Bit de la palabra cruda de la diana dada, o 0xFF si ninguno. */
uint8_t diana_shiftreg_target_bit(const diana_shiftreg_cfg *cfg,
                                  uint8_t target_index);

#ifdef __cplusplus
}
#endif
#endif /* DIANA_SHIFTREG_H */
