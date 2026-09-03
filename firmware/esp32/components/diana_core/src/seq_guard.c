/**
 * @file seq_guard.c
 * @brief Barrera antirrepetición epoch/sequence. Ver seq_guard.h para el diseño.
 *
 * Lógica portable: sin ESP-IDF. Testeable en host con gcc.
 */
#include "diana/seq_guard.h"

#include <stdio.h>
#include <string.h>

/* ================================================================= bitmap
 *
 * El bitmap de 16 bytes (128 bits) representa qué secuencias se han procesado:
 *   bit 0 (LSB de bm[0]) = max_seq         (más reciente)
 *   bit 1                = max_seq − 1
 *   ...
 *   bit 127 (MSB de bm[15]) = max_seq − 127 (más antigua en ventana)
 *
 * La representación es un entero de 128 bits en formato LSB-first
 * (bm[0] contiene los bits de menor peso).
 */

static bool bitmap_get(const uint8_t *bm, uint8_t pos)
{
    return (bm[pos / 8] >> (pos % 8)) & 1u;
}

static void bitmap_set(uint8_t *bm, uint8_t pos)
{
    bm[pos / 8] |= (uint8_t)(1u << (pos % 8));
}

/**
 * Desplaza el bitmap delta posiciones hacia índices mayores (envejece las
 * entradas existentes) y deja el bit 0 a 0 (listo para la nueva max_seq).
 *
 * Equivale a un desplazamiento izquierdo del entero de 128 bits LSB-first
 * (multiplicar por 2^delta): los bits más nuevos quedan en posiciones mayores,
 * los bits que salen por el extremo superior (índice > 127) se descartan.
 *
 * Implementación en dos pasos:
 *   1. Desplazamiento de bytes completos (byte_d = delta / 8):
 *      memmove hacia bytes de índice mayor; ceros en los bytes liberados.
 *   2. Desplazamiento bit a bit (bit_d = delta % 8) con carry hacia el byte
 *      siguiente (índice mayor = menos significativo en este entero LSB-first).
 */
static void bitmap_shift_by(uint8_t *bm, uint64_t delta)
{
    /* Si avanza >= 128 posiciones, toda la ventana anterior queda obsoleta.
     * ATAJO EQUIVALENTE, no una rama de comportamiento: con delta >= 128 el
     * camino largo daria byte_d >= 16, es decir un memmove de 0 bytes y un
     * memset de los 16 -- exactamente esto. Comprobado ejecutando. Por eso
     * ninguna prueba puede matar una mutacion de este umbral, y se declara
     * aqui en vez de aparentar que esta cubierto. */
    if (delta >= 128) {
        memset(bm, 0, 16);  /* 16 literal */
        return;
    }

    uint8_t byte_d = (uint8_t)(delta / 8);
    uint8_t bit_d  = (uint8_t)(delta % 8);

    /* Paso 1: desplazamiento de bytes (hacia índices mayores = más antiguos). */
    if (byte_d > 0) {
        memmove(bm + byte_d, bm, (size_t)(16 - byte_d));  /* 16 literal */
        memset(bm, 0, byte_d);
    }

    /* Paso 2: desplazamiento bit a bit a la izquierda del entero LSB-first.
     * En orden creciente de índice de byte: cada byte cede sus bits superiores
     * al carry del byte siguiente. */
    if (bit_d > 0) {
        uint8_t carry = 0;
        for (int i = 0; i < 16; i++) {  /* 16 literal */
            uint8_t new_carry = bm[i] >> (8 - bit_d);
            bm[i] = (uint8_t)((bm[i] << bit_d) | carry);
            carry = new_carry;
        }
        /* Los bits que salieron por el extremo (carry) se descartan: la ventana
         * es de 128 posiciones y lo que sale ya no es relevante. */
    }
}

/* ================================================================= caché */

/** Extrae los primeros 8 bytes del UUID sin guiones (para la clave corta). */
static void extract_prefix(const char *request_id, uint8_t out[8])
{
    memset(out, 0, 8);
    if (!request_id || !request_id[0]) return;
    size_t copied = 0;
    for (size_t i = 0; request_id[i] && copied < 8; i++) {
        if (request_id[i] != '-') {
            out[copied++] = (uint8_t)request_id[i];
        }
    }
}

/** Busca en la caché por número de secuencia. Devuelve el puntero o NULL. */
static const diana_seq_cache_entry *cache_find(const diana_seq_guard *g,
                                                uint64_t seq)
{
    for (int i = 0; i < 32; i++) {  /* 32 literal */
        if (g->state.cache[i].used && g->state.cache[i].sequence == seq) {
            return &g->state.cache[i];
        }
    }
    return NULL;
}

/** Añade o sobreescribe (FIFO) una entrada en la caché. */
static void cache_add(diana_seq_guard *g, uint64_t seq,
                      const char *request_id, uint8_t result_code)
{
    diana_seq_cache_entry *e = &g->state.cache[g->state.cache_next];
    e->sequence    = seq;
    extract_prefix(request_id, e->request_id_pfx);
    e->result_code = result_code;
    e->used        = true;
    /* Avance FIFO: 32 literal */
    g->state.cache_next = (uint8_t)((g->state.cache_next + 1) % 32);
}

/* ================================================================= persistencia
 *
 * Clave NVS por instancia: slot 0 (uso historico, diana_seq_guard_init suelto)
 * conserva la clave literal DIANA_SEQ_NVS_KEY ("state") para no invalidar
 * estado ya persistido por firmware en campo con la version anterior de este
 * fichero. Slot != 0 (una guarda dentro de un diana_seq_guard_set) usa una
 * clave derivada, para que las 9 combinaciones (issuer, plane) no compartan
 * ranura NVS y no se pisen entre si. */

static void build_key(uint8_t slot, char out[16])
{
    if (slot == 0) {
        snprintf(out, 16, "%s", DIANA_SEQ_NVS_KEY);
    } else {
        /* "state_" + hasta 3 digitos: slot maximo real es 8 (issuer*3+plane,
         * issuer<3, plane<3), asi que un byte basta; el formato admite mas
         * por si SEQ_GUARD_ISSUER_COUNT/PLANE_COUNT crecieran. */
        snprintf(out, 16, "state_%u", (unsigned)slot);
    }
}

static void persist(diana_seq_guard *g)
{
    if (!g->hal || !g->hal->kv_set) return;
    char key[16];
    build_key(g->nvs_slot, key);
    g->hal->kv_set(g->hal->ctx, DIANA_SEQ_NVS_NS, key,
                   &g->state, sizeof(g->state));
}

/* ================================================================= API pública */

void diana_seq_guard_init(diana_seq_guard *g, const diana_hal *hal)
{
    diana_seq_guard_init_slot(g, hal, 0);
}

void diana_seq_guard_init_slot(diana_seq_guard *g, const diana_hal *hal,
                                uint8_t slot)
{
    memset(g, 0, sizeof(*g));
    g->hal = hal;
    g->nvs_slot = slot;

    if (!hal || !hal->kv_get) return;

    char key[16];
    build_key(slot, key);

    size_t len = 0;
    int rc = hal->kv_get(hal->ctx, DIANA_SEQ_NVS_NS, key,
                         &g->state, sizeof(g->state), &len);
    if (rc != DIANA_HAL_OK || len != sizeof(g->state)) {
        /* Estado no encontrado o corrupto: iniciar limpio. */
        memset(&g->state, 0, sizeof(g->state));
    }
}

void diana_seq_guard_reprovision(diana_seq_guard *g,
                                  const uint8_t new_epoch[16])
{
    memcpy(g->state.epoch, new_epoch, 16);  /* 16 literal */
    g->state.has_epoch  = true;
    g->state.has_seq    = false;
    g->state.max_seq    = 0;
    memset(g->state.bitmap, 0, 16);         /* 16 literal */
    memset(g->state.cache, 0, sizeof(g->state.cache));
    g->state.cache_next = 0;
    persist(g);
}

diana_seq_result diana_seq_guard_check(diana_seq_guard *g,
                                        const uint8_t epoch[16],
                                        uint64_t sequence,
                                        const char *request_id,
                                        uint8_t *out_cached)
{
    /* 1. Sin epoch configurado (sin provisionar). */
    if (!g->state.has_epoch) {
        g->rejected_no_epoch++;
        return DIANA_SEQ_REJECTED_NO_EPOCH;
    }

    /* 2. Epoch no coincide: rechazar explícitamente.
     *    Un command normal con epoch distinto no es un reprovisionamiento;
     *    el reprovisionamiento usa diana_seq_guard_reprovision() aparte. */
    if (memcmp(epoch, g->state.epoch, 16) != 0) {  /* 16 literal */
        g->rejected_epoch++;
        return DIANA_SEQ_REJECTED_EPOCH;
    }

    /* 3. Primera secuencia (todavía no se ha aceptado ninguna). */
    if (!g->state.has_seq) {
        memset(g->state.bitmap, 0, 16);  /* 16 literal */
        g->state.max_seq = sequence;
        bitmap_set(g->state.bitmap, 0);  /* bit 0 = max_seq */
        g->state.has_seq = true;
        cache_add(g, sequence, request_id, (uint8_t)DIANA_CMD_RESULT_ACCEPTED);
        persist(g);
        g->accepted++;
        return DIANA_SEQ_ACCEPTED;
    }

    /* 4. Secuencia mayor que la máxima aceptada: nueva aceptación. */
    if (sequence > g->state.max_seq) {
        uint64_t delta = sequence - g->state.max_seq;
        bitmap_shift_by(g->state.bitmap, delta);
        bitmap_set(g->state.bitmap, 0);  /* bit 0 = nueva max_seq */
        g->state.max_seq = sequence;
        cache_add(g, sequence, request_id, (uint8_t)DIANA_CMD_RESULT_ACCEPTED);
        persist(g);
        g->accepted++;
        return DIANA_SEQ_ACCEPTED;
    }

    /* 5. Secuencia <= max_seq: calcular offset. */
    uint64_t offset = g->state.max_seq - sequence;

    /* 5a. Demasiado antigua: offset >= 128 (fuera de la ventana).
     *     Rechazo EXPLÍCITO (no silencioso). */
    if (offset >= 128) {  /* 128 literal */
        g->rejected_too_old++;
        return DIANA_SEQ_REJECTED_TOO_OLD;
    }

    /* 5b. Dentro de la ventana (offset en [0, 127]). */
    uint8_t pos = (uint8_t)offset;

    if (bitmap_get(g->state.bitmap, pos)) {
        /* Ya procesada: duplicado. Responder con caché. */
        g->duplicate_served++;
        if (out_cached) {
            const diana_seq_cache_entry *e = cache_find(g, sequence);
            *out_cached = e ? e->result_code
                            : (uint8_t)DIANA_CMD_RESULT_DUPLICATE;
        }
        return DIANA_SEQ_DUPLICATE;
    }

    /* 5c. Hueco: dentro de ventana, bit no marcado (fuera de orden).
     *
     * POLÍTICA (SEQ_POLICY_GAP, documentada en seq_guard.h):
     *   Aceptar el reordenamiento porque el epoch verifica la corriente
     *   autorizada, el bit queda marcado para impedir replay posterior,
     *   y rechazar huecos dejaría el firmware inoperante con red inestable
     *   (QoS 1 puede reordenar durante reconexión).
     *   Riesgo residual: una secuencia forjada dentro de la ventana con el
     *   epoch correcto sería aceptada; la defensa contra eso depende de la
     *   capa MQTT (TLS + ACLs), no del firmware. */
    bitmap_set(g->state.bitmap, pos);
    cache_add(g, sequence, request_id, (uint8_t)DIANA_CMD_RESULT_ACCEPTED);
    persist(g);
    g->gap_accepted++;
    return DIANA_SEQ_GAP_ACCEPTED;
}

void diana_seq_guard_cache_result(diana_seq_guard *g,
                                   uint64_t sequence,
                                   const char *request_id,
                                   uint8_t result_code)
{
    /* Busca la entrada existente (de cuando se llamó check()) y actualiza
     * el result_code al resultado real de negocio. */
    for (int i = 0; i < 32; i++) {  /* 32 literal */
        if (g->state.cache[i].used && g->state.cache[i].sequence == sequence) {
            uint8_t pfx[8];
            extract_prefix(request_id, pfx);
            /* Verificar que el prefijo coincide (por seguridad). */
            if (memcmp(g->state.cache[i].request_id_pfx, pfx, 8) == 0) {
                g->state.cache[i].result_code = result_code;
                persist(g);
                return;
            }
        }
    }
    /* Entrada no encontrada (caché FIFO la expulsó): no se puede hacer nada. */
}

uint64_t diana_seq_guard_max_seq(const diana_seq_guard *g)
{
    return g->state.max_seq;
}

bool diana_seq_guard_has_epoch(const diana_seq_guard *g)
{
    return g->state.has_epoch;
}

/* ============================================================ AMBITO REAL */

void diana_seq_guard_set_init(diana_seq_guard_set *set, const diana_hal *hal)
{
    for (uint8_t issuer = 0; issuer < SEQ_GUARD_ISSUER_COUNT; ++issuer) {
        for (uint8_t plane = 0; plane < SEQ_GUARD_PLANE_COUNT; ++plane) {
            /* slot = issuer * SEQ_GUARD_PLANE_COUNT + plane + 1: nunca 0,
             * para no coincidir jamas con la clave historica del slot 0
             * (diana_seq_guard_init suelto). +1 literal, no cosmetico: es lo
             * que garantiza la no colision con el slot reservado. */
            uint8_t slot = (uint8_t)(issuer * SEQ_GUARD_PLANE_COUNT + plane + 1);
            diana_seq_guard_init_slot(&set->entry[issuer][plane], hal, slot);
        }
    }
}

diana_seq_guard *diana_seq_guard_set_entry(diana_seq_guard_set *set,
                                            diana_issuer issuer,
                                            diana_command_plane plane)
{
    if ((int)issuer < 0 || issuer >= SEQ_GUARD_ISSUER_COUNT) return NULL;
    if ((int)plane < 0 || plane >= SEQ_GUARD_PLANE_COUNT) return NULL;
    return &set->entry[issuer][plane];
}

/* ====================================================== SOBRE OBLIGATORIO */

diana_envelope_result diana_check_command_envelope(bool has_epoch_seq,
                                                    bool has_plane,
                                                    diana_command_plane plane,
                                                    diana_command_plane expected_plane,
                                                    bool retained)
{
    /* 1. Retenido: rechazo INMEDIATO, ni se evalua el resto del sobre (igual
     *    que checkCommandEnvelope() del simulador). */
    if (retained) return DIANA_ENVELOPE_RETAINED_REJECTED;

    /* 2. Sobre incompleto: epoch+sequence obligatorios A LA VEZ, y plane
     *    obligatorio. Sin modo heredado: ninguna combinacion parcial se trata
     *    como "comando antiguo aceptado". */
    if (!has_epoch_seq) return DIANA_ENVELOPE_MISSING;
    if (!has_plane) return DIANA_ENVELOPE_MISSING;

    /* 3. Plane presente pero distinto del que el canal impone. NO es
     *    "ausente" (el campo esta), es un plano equivocado -- motivo propio,
     *    igual que 'wrong_command_plane' en el simulador. */
    if (plane != expected_plane) return DIANA_ENVELOPE_WRONG_PLANE;

    return DIANA_ENVELOPE_OK;
}
