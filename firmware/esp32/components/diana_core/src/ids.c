#include "diana/ids.h"

#include <stdio.h>
#include <string.h>

static const char HEX[] = "0123456789abcdef";

void diana_uuid4(const diana_hal *hal, char out[DIANA_UUID_LEN])
{
    uint8_t b[16];
    memset(b, 0, sizeof(b));
    if (hal && hal->random_bytes) hal->random_bytes(hal->ctx, b, sizeof(b));

    /* RFC 4122: version 4, variante 10xx. */
    b[6] = (uint8_t)((b[6] & 0x0F) | 0x40);
    b[8] = (uint8_t)((b[8] & 0x3F) | 0x80);

    static const int dash[] = {4, 6, 8, 10};
    size_t p = 0;
    for (int i = 0; i < 16; ++i) {
        for (int d = 0; d < 4; ++d) {
            if (i == dash[d]) out[p++] = '-';
        }
        out[p++] = HEX[(b[i] >> 4) & 0x0F];
        out[p++] = HEX[b[i] & 0x0F];
    }
    out[p] = '\0';
}

/* Crockford base32 sin I, L, O, U. */
static const char B32[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

void diana_ulid(const diana_hal *hal, uint64_t time_ms, char out[27])
{
    uint8_t rnd[10];
    memset(rnd, 0, sizeof(rnd));
    if (hal && hal->random_bytes) hal->random_bytes(hal->ctx, rnd, sizeof(rnd));

    /* 10 chars de tiempo (48 bits) */
    for (int i = 9; i >= 0; --i) {
        out[i] = B32[time_ms & 0x1F];
        time_ms >>= 5;
    }
    /* 16 chars de aleatoriedad (80 bits) */
    uint64_t hi = 0, lo = 0;
    for (int i = 0; i < 5; ++i) hi = (hi << 8) | rnd[i];
    for (int i = 5; i < 10; ++i) lo = (lo << 8) | rnd[i];
    for (int i = 7; i >= 0; --i) {
        out[10 + i] = B32[hi & 0x1F];
        hi >>= 5;
    }
    for (int i = 7; i >= 0; --i) {
        out[18 + i] = B32[lo & 0x1F];
        lo >>= 5;
    }
    out[26] = '\0';
}

static bool is_hex(char c)
{
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

bool diana_is_uuid(const char *s)
{
    if (!s || strlen(s) != 36) return false;
    static const int dashpos[] = {8, 13, 18, 23};
    for (int i = 0; i < 36; ++i) {
        bool must_dash = false;
        for (int d = 0; d < 4; ++d) if (i == dashpos[d]) must_dash = true;
        if (must_dash) {
            if (s[i] != '-') return false;
        } else if (!is_hex(s[i])) {
            return false;
        }
    }
    return true;
}

static bool is_ulid(const char *s)
{
    if (!s || strlen(s) != 26) return false;
    for (int i = 0; i < 26; ++i) {
        char c = s[i];
        bool ok = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'H') ||
                  (c == 'J') || (c == 'K') || (c >= 'M' && c <= 'N') ||
                  (c >= 'P' && c <= 'T') || (c >= 'V' && c <= 'Z');
        if (!ok) return false;
    }
    return true;
}

bool diana_is_event_id(const char *s) { return diana_is_uuid(s) || is_ulid(s); }

bool diana_is_identifier(const char *s)
{
    if (!s) return false;
    size_t n = strlen(s);
    if (n < 3 || n > 63) return false;
    char c0 = s[0];
    if (!((c0 >= 'a' && c0 <= 'z') || (c0 >= '0' && c0 <= '9'))) return false;
    for (size_t i = 1; i < n; ++i) {
        char c = s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'))
            return false;
    }
    return true;
}

bool diana_is_semver(const char *s)
{
    if (!s) return false;
    int part = 0;
    size_t i = 0;
    while (part < 3) {
        size_t digits = 0;
        while (s[i] >= '0' && s[i] <= '9') { ++i; ++digits; }
        if (digits == 0) return false;
        ++part;
        if (part < 3) {
            if (s[i] != '.') return false;
            ++i;
        }
    }
    if (s[i] == '\0') return true;
    if (s[i] != '-' && s[i] != '+') return false;
    ++i;
    if (s[i] == '\0') return false;
    for (; s[i]; ++i) {
        char c = s[i];
        bool ok = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') ||
                  (c >= 'a' && c <= 'z') || c == '.' || c == '-';
        if (!ok) return false;
    }
    return true;
}

bool diana_is_sha256_hex(const char *s)
{
    if (!s || strlen(s) != 64) return false;
    for (int i = 0; i < 64; ++i) {
        char c = s[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}
