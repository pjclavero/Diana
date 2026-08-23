/**
 * @file base64url.c
 * @brief base64url sin relleno, decodificador estricto. Ver diana/base64url.h.
 */
#include "diana/base64url.h"

#include <string.h>

static const char ALPHABET[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** @return valor 0..63 del caracter, o -1 si no pertenece al alfabeto. */
static int decode_char(char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '-') return 62;
    if (c == '_') return 63;
    return -1;
}

bool diana_base64url_decode(const char *in, uint8_t *out, size_t *out_len)
{
    if (in == NULL || out == NULL || out_len == NULL) return false;

    const size_t cap = *out_len;
    const size_t n = strlen(in);
    /* Longitud 1 mod 4 es imposible en base64: sobraria un solo caracter, que
     * no codifica ningun byte completo. */
    if (n % 4u == 1u) return false;

    size_t written = 0;
    size_t i = 0;
    while (i < n) {
        size_t group = n - i >= 4u ? 4u : n - i;
        int v[4] = {0, 0, 0, 0};
        for (size_t k = 0; k < group; ++k) {
            v[k] = decode_char(in[i + k]);
            if (v[k] < 0) return false;    /* incluye '=', espacios y '+'/'/' */
        }
        uint32_t acc = ((uint32_t)v[0] << 18) | ((uint32_t)v[1] << 12) |
                       ((uint32_t)v[2] << 6) | (uint32_t)v[3];
        size_t bytes = group - 1u;         /* 4->3, 3->2, 2->1 */
        if (written + bytes > cap) return false;
        if (bytes >= 1u) out[written++] = (uint8_t)(acc >> 16);
        if (bytes >= 2u) out[written++] = (uint8_t)(acc >> 8);
        if (bytes >= 3u) out[written++] = (uint8_t)acc;

        /* Bits de relleno del ultimo grupo: DEBEN ser cero. Si no se exige,
         * varias cadenas distintas decodifican a los mismos bytes. */
        if (group == 3u && ((uint32_t)v[2] & 0x03u) != 0u) return false;
        if (group == 2u && ((uint32_t)v[1] & 0x0fu) != 0u) return false;

        i += group;
    }

    *out_len = written;
    return true;
}

size_t diana_base64url_encode(const uint8_t *in, size_t len, char *out, size_t out_cap)
{
    if (in == NULL || out == NULL) return 0;
    size_t need = (len / 3u) * 4u;
    size_t rem = len % 3u;
    if (rem == 1u) need += 2u;
    if (rem == 2u) need += 3u;
    if (need + 1u > out_cap) return 0;

    size_t o = 0;
    size_t i = 0;
    while (i + 3u <= len) {
        uint32_t acc = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8) |
                       (uint32_t)in[i + 2];
        out[o++] = ALPHABET[(acc >> 18) & 0x3fu];
        out[o++] = ALPHABET[(acc >> 12) & 0x3fu];
        out[o++] = ALPHABET[(acc >> 6) & 0x3fu];
        out[o++] = ALPHABET[acc & 0x3fu];
        i += 3u;
    }
    if (rem == 1u) {
        uint32_t acc = (uint32_t)in[i] << 16;
        out[o++] = ALPHABET[(acc >> 18) & 0x3fu];
        out[o++] = ALPHABET[(acc >> 12) & 0x3fu];
    } else if (rem == 2u) {
        uint32_t acc = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8);
        out[o++] = ALPHABET[(acc >> 18) & 0x3fu];
        out[o++] = ALPHABET[(acc >> 12) & 0x3fu];
        out[o++] = ALPHABET[(acc >> 6) & 0x3fu];
    }
    out[o] = '\0';
    return o;
}
