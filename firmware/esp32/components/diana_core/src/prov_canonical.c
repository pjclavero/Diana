/**
 * @file prov_canonical.c
 * @brief Las DOS cadenas canonicas del plano DEVICE_MANAGEMENT.
 *
 * Codificacion (README §0-sexies):
 *
 *     registro := longitud(4 bytes, big-endian, uint32) ++ valor(UTF-8)
 *     ausente  := 0xFFFFFFFF, SIN bytes de valor
 *
 * NO hay delimitadores. Por eso ningun contenido de campo puede desplazar a
 * los siguientes (un device_id con '\n' embebido no rompe nada) y por eso un
 * valor que sea literalmente "-" no se confunde con el registro de ausencia.
 *
 * El ORDEN es parte del contrato. Los registros nuevos se anaden SIEMPRE al
 * final (provision_id, el 13, es el primer caso): cambiar el orden invalida
 * toda firma emitida bajo el orden anterior.
 *
 * Aqui NO se decide que campo esta presente segun la accion: se serializa lo
 * que la orden trae. La presencia por accion la impone el esquema, y este
 * modulo la comprueba en provisioning.c antes de canonicalizar.
 */
#include "diana/provisioning.h"

#include <string.h>

#include "diana/base64url.h"
#include "diana/sha256.h"

/** Escritor de cadena canonica con deteccion de desbordamiento. */
typedef struct {
    uint8_t *buf;
    size_t   cap;
    size_t   len;
    bool     overflow;
} canon_writer;

static void canon_init(canon_writer *w, uint8_t *buf, size_t cap)
{
    w->buf = buf;
    w->cap = cap;
    w->len = 0;
    w->overflow = false;
}

static void canon_raw(canon_writer *w, const void *data, size_t len)
{
    if (w->overflow) return;
    if (w->len + len > w->cap) {
        w->overflow = true;
        return;
    }
    memcpy(w->buf + w->len, data, len);
    w->len += len;
}

static void canon_u32be(canon_writer *w, uint32_t v)
{
    uint8_t b[4];
    b[0] = (uint8_t)(v >> 24);
    b[1] = (uint8_t)(v >> 16);
    b[2] = (uint8_t)(v >> 8);
    b[3] = (uint8_t)v;
    canon_raw(w, b, sizeof(b));
}

/**
 * Un registro. `value == NULL` o cadena vacia significan AUSENTE: en este
 * protocolo ningun registro presente tiene valor vacio (todos los tipos —
 * uuid, identifier, decimal, hex, enum, literal — tienen longitud minima
 * mayor que cero), asi que la cadena vacia puede representar la ausencia sin
 * ambiguedad.
 */
static void canon_record(canon_writer *w, const char *value)
{
    if (value == NULL || value[0] == '\0') {
        canon_u32be(w, DIANA_PROV_ABSENT_MARKER);
        return;
    }
    size_t n = strlen(value);
    /* Si un campo alcanzase 0xFFFFFFFF bytes, "presente" y "ausente" dejarian
     * de ser distinguibles. Romper ruidosamente es mejor que emitir una cadena
     * ambigua. */
    if (n >= (size_t)DIANA_PROV_ABSENT_MARKER) {
        w->overflow = true;
        return;
    }
    canon_u32be(w, (uint32_t)n);
    canon_raw(w, value, n);
}

/** ASCII decimal sin ceros a la izquierda ni signo. */
static void canon_decimal(canon_writer *w, uint64_t v)
{
    char tmp[21];
    size_t i = sizeof(tmp);
    tmp[--i] = '\0';
    if (v == 0) {
        tmp[--i] = '0';
    } else {
        while (v > 0 && i > 0) {
            tmp[--i] = (char)('0' + (int)(v % 10u));
            v /= 10u;
        }
    }
    canon_record(w, tmp + i);
}

size_t diana_prov_canonical(const diana_prov_command *cmd, uint8_t *out, size_t cap)
{
    if (cmd == NULL || out == NULL) return 0;

    canon_writer w;
    canon_init(&w, out, cap);

    /*  1 */ canon_record(&w, DIANA_PROV_DOMAIN_SEP);
    /*  2 */ canon_record(&w, diana_prov_action_str(cmd->action));
    /*  3 */ canon_record(&w, cmd->mode == DIANA_PROV_MODE_NONE
                                  ? NULL : diana_prov_mode_str(cmd->mode));
    /*  4 */ canon_record(&w, cmd->system_id);
    /*  5 */ canon_record(&w, cmd->device_id);
    /*  6 */ canon_decimal(&w, cmd->provisioning_sequence);
    /*  7 */ canon_record(&w, cmd->rotation_id);
    /*  8 */ canon_record(&w, cmd->current_epoch);
    /*  9 */ canon_record(&w, cmd->next_epoch);
    /* 10 */ canon_record(&w, cmd->epoch);
    /* 11 */ canon_decimal(&w, cmd->issued_at_ms);
    /* 12 */ canon_record(&w, cmd->provisioning_key_fingerprint);
    /* 13 */ canon_record(&w, cmd->provision_id);

    return w.overflow ? 0 : w.len;
}

size_t diana_prov_delegation_canonical(const diana_prov_delegation *d,
                                       uint8_t *out, size_t cap)
{
    if (d == NULL || out == NULL) return 0;

    canon_writer w;
    canon_init(&w, out, cap);

    /* Cadena DISTINTA de la de la orden, con su PROPIO separador de dominio:
     * ninguna firma de una vale en la otra. Misma codificacion, porque el
     * algoritmo no tiene por que ser dos algoritmos. */
    /* 1 */ canon_record(&w, DIANA_PROV_DELEG_DOMAIN_SEP);
    /* 2 */ canon_decimal(&w, d->delegation_version);
    /* 3 */ canon_record(&w, d->delegation_id);
    /* 4 */ canon_record(&w, d->root_key_id);
    /* 5 */ canon_record(&w, d->operational_key_id);
    /* 6 */ canon_record(&w, d->operational_public_key);
    /* 7 */ canon_record(&w, d->scope);
    /* 8 */ canon_decimal(&w, d->delegation_sequence);
    /* 9 */ canon_record(&w, d->system_id);

    return w.overflow ? 0 : w.len;
}

void diana_prov_delegation_fingerprint(const diana_prov_delegation *d, uint8_t out[32])
{
    uint8_t canon[DIANA_PROV_CANON_MAX];
    size_t n = diana_prov_delegation_canonical(d, canon, sizeof(canon));
    /* Misma cadena que se FIRMA: root_signature y signature_alg no entran,
     * porque ECDSA puede producir firmas distintas sobre el mismo mensaje y
     * eso haria el fingerprint inutil como identidad de la delegacion. */
    diana_sha256 c;
    diana_sha256_init(&c);
    diana_sha256_update(&c, canon, n);
    diana_sha256_final(&c, out);
}

/**
 * Prefijo DER FIJO de un SubjectPublicKeyInfo de secp256r1 con clave sin
 * comprimir: SEQUENCE(SEQUENCE(id-ecPublicKey, prime256v1), BIT STRING(66)).
 * Se compara literalmente en vez de parsear DER: un parser generico admite
 * codificaciones alternativas del mismo valor y con ellas dos cadenas
 * distintas darian la misma clave.
 */
static const uint8_t SPKI_P256_PREFIX[26] = {
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
    0x42, 0x00};

bool diana_prov_decode_pubkey(const char *spki_b64url,
                              uint8_t out[DIANA_P256_PUBKEY_LEN])
{
    if (spki_b64url == NULL || out == NULL) return false;

    uint8_t der[128];
    size_t der_len = sizeof(der);
    if (!diana_base64url_decode(spki_b64url, der, &der_len)) return false;
    if (der_len != sizeof(SPKI_P256_PREFIX) + DIANA_P256_PUBKEY_LEN) return false;
    if (memcmp(der, SPKI_P256_PREFIX, sizeof(SPKI_P256_PREFIX)) != 0) return false;

    const uint8_t *point = der + sizeof(SPKI_P256_PREFIX);
    if (point[0] != 0x04u) return false;   /* solo punto no comprimido */
    memcpy(out, point, DIANA_P256_PUBKEY_LEN);
    return true;
}
