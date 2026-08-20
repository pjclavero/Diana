/**
 * @file shiftreg.c
 * @brief Convenio de cableado de los 2 x SN74HC165, en codigo puro.
 */
#include "diana/shiftreg.h"

#include <string.h>

void diana_shiftreg_cfg_defaults(diana_shiftreg_cfg *cfg)
{
    if (!cfg) return;
    memset(cfg, 0, sizeof(*cfg));
    cfg->total_bits = DIANA_SR_TOTAL_BITS;
    /* Registro #1 entradas A..H -> D1..D8; registro #2 entrada A -> D9. */
    for (uint8_t i = 0; i < DIANA_TARGET_COUNT; ++i) {
        cfg->bit_to_target[i] = (uint8_t)(i + 1u);
    }
    /* bits 9..15: reserva -> 0 (ya puestos a cero por el memset). */
}

uint16_t diana_shiftreg_pack(const diana_shiftreg_cfg *cfg,
                             const uint8_t *serial, uint8_t n)
{
    if (!cfg || !serial || n != cfg->total_bits) return 0;

    /* Identico al bucle de io_hc165.c: el primer bit de la secuencia acaba en
     * el bit mas significativo y el ultimo en el bit 0. */
    uint16_t raw = 0;
    for (uint8_t i = 0; i < n; ++i) {
        raw = (uint16_t)((raw << 1) | (uint16_t)(serial[i] & 1u));
    }
    return raw;
}

uint8_t diana_shiftreg_bit_target(const diana_shiftreg_cfg *cfg, uint8_t bit)
{
    if (!cfg || bit >= DIANA_SR_TOTAL_BITS) return 0;
    return cfg->bit_to_target[bit];
}

uint8_t diana_shiftreg_target_bit(const diana_shiftreg_cfg *cfg,
                                  uint8_t target_index)
{
    if (!cfg) return 0xFFu;
    for (uint8_t i = 0; i < DIANA_SR_TOTAL_BITS; ++i) {
        if (cfg->bit_to_target[i] == target_index && target_index != 0u) return i;
    }
    return 0xFFu;
}
