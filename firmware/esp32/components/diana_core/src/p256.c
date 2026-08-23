/**
 * @file p256.c
 * @brief ECDSA P-256 (verificacion) portable. Ver diana/p256.h.
 *
 * Representacion: enteros de 256 bits como 8 limbs uint32 en orden
 * little-endian (limb 0 = menos significativo). Multiplicacion modular por
 * reduccion de Montgomery generica (CIOS), parametrizada por el modulo, de
 * modo que la MISMA rutina sirve para el cuerpo (mod p) y para el orden del
 * grupo (mod n) sin dos implementaciones que puedan divergir.
 *
 * Coordenadas jacobianas (X:Y:Z) con a = -3, que es exactamente el caso de
 * P-256; las formulas dbl-2001-b y add-2007-bl de EFD.
 */
#include "diana/p256.h"

#include <string.h>

#include "diana/sha256.h"

#define LIMBS 8

typedef struct {
    const uint32_t *m;   /* modulo, 8 limbs */
    uint32_t        n0;  /* -m^-1 mod 2^32 */
    const uint32_t *rr;  /* R^2 mod m, R = 2^256 */
} modulus;

/* Constantes de la curva NIST P-256 / secp256r1. */
static const uint32_t P256_P[LIMBS] = {
    0xffffffffu, 0xffffffffu, 0xffffffffu, 0x00000000u,
    0x00000000u, 0x00000000u, 0x00000001u, 0xffffffffu};
static const uint32_t P256_N[LIMBS] = {
    0xfc632551u, 0xf3b9cac2u, 0xa7179e84u, 0xbce6faadu,
    0xffffffffu, 0xffffffffu, 0x00000000u, 0xffffffffu};
static const uint32_t P256_RR_P[LIMBS] = {
    0x00000003u, 0x00000000u, 0xffffffffu, 0xfffffffbu,
    0xfffffffeu, 0xffffffffu, 0xfffffffdu, 0x00000004u};
static const uint32_t P256_RR_N[LIMBS] = {
    0xbe79eea2u, 0x83244c95u, 0x49bd6fa6u, 0x4699799cu,
    0x2b6bec59u, 0x2845b239u, 0xf3d95620u, 0x66e12d94u};
/* Generador G en dominio de Montgomery mod p. */
static const uint32_t P256_GX_MONT[LIMBS] = {
    0x18a9143cu, 0x79e730d4u, 0x5fedb601u, 0x75ba95fcu,
    0x77622510u, 0x79fb732bu, 0xa53755c6u, 0x18905f76u};
static const uint32_t P256_GY_MONT[LIMBS] = {
    0xce95560au, 0xddf25357u, 0xba19e45cu, 0x8b4ab8e4u,
    0xdd21f325u, 0xd2e88688u, 0x25885d85u, 0x8571ff18u};
/* 1 en dominio de Montgomery mod p (= R mod p). */
static const uint32_t P256_ONE_MONT[LIMBS] = {
    0x00000001u, 0x00000000u, 0x00000000u, 0xffffffffu,
    0xffffffffu, 0xffffffffu, 0xfffffffeu, 0x00000000u};
/* b de la ecuacion y^2 = x^3 - 3x + b, en dominio de Montgomery mod p. */
static const uint32_t P256_B_MONT[LIMBS] = {
    0x29c4bddfu, 0xd89cdf62u, 0x78843090u, 0xacf005cdu,
    0xf7212ed6u, 0xe5a220abu, 0x04874834u, 0xdc30061du};

static const modulus MOD_P = {P256_P, 0x00000001u, P256_RR_P};
static const modulus MOD_N = {P256_N, 0xee00bc4fu, P256_RR_N};

/* ---------------------------------------------------------------- enteros -- */

static void fe_set(uint32_t r[LIMBS], const uint32_t a[LIMBS])
{
    memcpy(r, a, sizeof(uint32_t) * LIMBS);
}

static void fe_zero(uint32_t r[LIMBS])
{
    memset(r, 0, sizeof(uint32_t) * LIMBS);
}

static bool fe_is_zero(const uint32_t a[LIMBS])
{
    uint32_t acc = 0;
    for (int i = 0; i < LIMBS; ++i) acc |= a[i];
    return acc == 0;
}

static bool fe_eq(const uint32_t a[LIMBS], const uint32_t b[LIMBS])
{
    for (int i = 0; i < LIMBS; ++i) {
        if (a[i] != b[i]) return false;
    }
    return true;
}

/** @return -1, 0 o 1 comparando a con b como enteros sin signo. */
static int fe_cmp(const uint32_t a[LIMBS], const uint32_t b[LIMBS])
{
    for (int i = LIMBS - 1; i >= 0; --i) {
        if (a[i] != b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
}

/** r = a - b, devuelve el prestamo final (1 si a < b). */
static uint32_t fe_sub_raw(uint32_t r[LIMBS], const uint32_t a[LIMBS],
                           const uint32_t b[LIMBS])
{
    uint64_t borrow = 0;
    for (int i = 0; i < LIMBS; ++i) {
        uint64_t d = (uint64_t)a[i] - (uint64_t)b[i] - borrow;
        r[i] = (uint32_t)d;
        borrow = (d >> 63) & 1u;
    }
    return (uint32_t)borrow;
}

/** r = a + b, devuelve el acarreo final. */
static uint32_t fe_add_raw(uint32_t r[LIMBS], const uint32_t a[LIMBS],
                           const uint32_t b[LIMBS])
{
    uint64_t carry = 0;
    for (int i = 0; i < LIMBS; ++i) {
        uint64_t s = (uint64_t)a[i] + (uint64_t)b[i] + carry;
        r[i] = (uint32_t)s;
        carry = s >> 32;
    }
    return (uint32_t)carry;
}

/** r = (a + b) mod m. Entradas ya reducidas. */
static void fe_add(uint32_t r[LIMBS], const uint32_t a[LIMBS],
                   const uint32_t b[LIMBS], const modulus *mod)
{
    uint32_t carry = fe_add_raw(r, a, b);
    uint32_t tmp[LIMBS];
    uint32_t borrow = fe_sub_raw(tmp, r, mod->m);
    if (carry != 0 || borrow == 0) fe_set(r, tmp);
}

/** r = (a - b) mod m. Entradas ya reducidas. */
static void fe_sub(uint32_t r[LIMBS], const uint32_t a[LIMBS],
                   const uint32_t b[LIMBS], const modulus *mod)
{
    uint32_t borrow = fe_sub_raw(r, a, b);
    if (borrow != 0) (void)fe_add_raw(r, r, mod->m);
}

/**
 * Multiplicacion de Montgomery: r = a * b * R^-1 mod m (CIOS).
 * Entradas reducidas mod m; salida reducida mod m.
 */
static void mont_mul(uint32_t r[LIMBS], const uint32_t a[LIMBS],
                     const uint32_t b[LIMBS], const modulus *mod)
{
    uint32_t t[LIMBS + 2];
    memset(t, 0, sizeof(t));

    for (int i = 0; i < LIMBS; ++i) {
        uint64_t carry = 0;
        for (int j = 0; j < LIMBS; ++j) {
            uint64_t s = (uint64_t)t[j] + (uint64_t)a[i] * (uint64_t)b[j] + carry;
            t[j] = (uint32_t)s;
            carry = s >> 32;
        }
        uint64_t s8 = (uint64_t)t[LIMBS] + carry;
        t[LIMBS] = (uint32_t)s8;
        t[LIMBS + 1] = (uint32_t)(s8 >> 32);

        uint32_t u = (uint32_t)(t[0] * mod->n0);
        carry = 0;
        for (int j = 0; j < LIMBS; ++j) {
            uint64_t s = (uint64_t)t[j] + (uint64_t)u * (uint64_t)mod->m[j] + carry;
            t[j] = (uint32_t)s;
            carry = s >> 32;
        }
        s8 = (uint64_t)t[LIMBS] + carry;
        t[LIMBS] = (uint32_t)s8;
        t[LIMBS + 1] += (uint32_t)(s8 >> 32);

        /* t >>= 32 (una palabra) */
        for (int j = 0; j < LIMBS + 1; ++j) t[j] = t[j + 1];
        t[LIMBS + 1] = 0;
    }

    uint32_t tmp[LIMBS];
    uint32_t borrow = fe_sub_raw(tmp, t, mod->m);
    if (t[LIMBS] != 0 || borrow == 0) {
        fe_set(r, tmp);
    } else {
        fe_set(r, t);
    }
}

static void mont_sqr(uint32_t r[LIMBS], const uint32_t a[LIMBS], const modulus *mod)
{
    mont_mul(r, a, a, mod);
}

static void to_mont(uint32_t r[LIMBS], const uint32_t a[LIMBS], const modulus *mod)
{
    mont_mul(r, a, mod->rr, mod);
}

static void from_mont(uint32_t r[LIMBS], const uint32_t a[LIMBS], const modulus *mod)
{
    uint32_t one[LIMBS];
    fe_zero(one);
    one[0] = 1u;
    mont_mul(r, a, one, mod);
}

/** r = a^e mod m, con a y r en dominio de Montgomery. e es un entero de 256 bits. */
static void mont_pow(uint32_t r[LIMBS], const uint32_t a[LIMBS],
                     const uint32_t e[LIMBS], const modulus *mod)
{
    uint32_t acc[LIMBS];
    uint32_t base[LIMBS];
    /* 1 en dominio de Montgomery = R mod m; se obtiene de to_mont(1). */
    uint32_t one[LIMBS];
    fe_zero(one);
    one[0] = 1u;
    to_mont(acc, one, mod);
    fe_set(base, a);

    for (int i = 255; i >= 0; --i) {
        mont_sqr(acc, acc, mod);
        if (((e[i / 32] >> (i % 32)) & 1u) != 0) mont_mul(acc, acc, base, mod);
    }
    fe_set(r, acc);
}

/** r = a^-1 mod m, por el pequeno teorema de Fermat (m primo: p y n lo son). */
static void mont_inv(uint32_t r[LIMBS], const uint32_t a[LIMBS], const modulus *mod)
{
    uint32_t e[LIMBS];
    uint32_t two[LIMBS];
    fe_zero(two);
    two[0] = 2u;
    (void)fe_sub_raw(e, mod->m, two);   /* m - 2 */
    mont_pow(r, a, e, mod);
}

/** Carga 32 bytes big-endian en 8 limbs little-endian. */
static void be32_to_limbs(uint32_t r[LIMBS], const uint8_t in[32])
{
    for (int i = 0; i < LIMBS; ++i) {
        const uint8_t *p = in + (LIMBS - 1 - i) * 4;
        r[i] = ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
               ((uint32_t)p[2] << 8) | (uint32_t)p[3];
    }
}

/* ----------------------------------------------------------------- puntos -- */

/** Punto en coordenadas jacobianas, con X, Y, Z en dominio de Montgomery mod p.
 *  Z == 0 representa el punto del infinito. */
typedef struct {
    uint32_t x[LIMBS];
    uint32_t y[LIMBS];
    uint32_t z[LIMBS];
} jpoint;

static void jp_infinity(jpoint *r)
{
    fe_set(r->x, P256_ONE_MONT);
    fe_set(r->y, P256_ONE_MONT);
    fe_zero(r->z);
}

static bool jp_is_infinity(const jpoint *a)
{
    return fe_is_zero(a->z);
}

/** r = 2*a (dbl-2001-b, valida para a = -3). */
static void jp_double(jpoint *r, const jpoint *a)
{
    if (jp_is_infinity(a) || fe_is_zero(a->y)) {
        jp_infinity(r);
        return;
    }

    uint32_t delta[LIMBS], gamma[LIMBS], beta[LIMBS], alpha[LIMBS];
    uint32_t t1[LIMBS], t2[LIMBS], x3[LIMBS], y3[LIMBS], z3[LIMBS];

    mont_sqr(delta, a->z, &MOD_P);              /* delta = Z^2 */
    mont_sqr(gamma, a->y, &MOD_P);              /* gamma = Y^2 */
    mont_mul(beta, a->x, gamma, &MOD_P);        /* beta  = X*gamma */

    fe_sub(t1, a->x, delta, &MOD_P);            /* X - delta */
    fe_add(t2, a->x, delta, &MOD_P);            /* X + delta */
    mont_mul(alpha, t1, t2, &MOD_P);
    fe_add(t1, alpha, alpha, &MOD_P);
    fe_add(alpha, t1, alpha, &MOD_P);           /* alpha = 3(X-delta)(X+delta) */

    mont_sqr(x3, alpha, &MOD_P);                /* alpha^2 */
    fe_add(t1, beta, beta, &MOD_P);             /* 2 beta */
    fe_add(t2, t1, t1, &MOD_P);                 /* 4 beta */
    fe_add(t1, t2, t2, &MOD_P);                 /* 8 beta */
    fe_sub(x3, x3, t1, &MOD_P);                 /* X3 = alpha^2 - 8 beta */

    fe_add(t1, a->y, a->z, &MOD_P);
    mont_sqr(z3, t1, &MOD_P);
    fe_sub(z3, z3, gamma, &MOD_P);
    fe_sub(z3, z3, delta, &MOD_P);              /* Z3 = (Y+Z)^2 - gamma - delta */

    fe_sub(y3, t2, x3, &MOD_P);                 /* 4 beta - X3 */
    mont_mul(y3, alpha, y3, &MOD_P);
    mont_sqr(t1, gamma, &MOD_P);                /* gamma^2 */
    fe_add(t2, t1, t1, &MOD_P);
    fe_add(t1, t2, t2, &MOD_P);
    fe_add(t2, t1, t1, &MOD_P);                 /* 8 gamma^2 */
    fe_sub(y3, y3, t2, &MOD_P);

    fe_set(r->x, x3);
    fe_set(r->y, y3);
    fe_set(r->z, z3);
}

/** r = a + b (add-2007-bl). Trata correctamente infinito y a == b. */
static void jp_add(jpoint *r, const jpoint *a, const jpoint *b)
{
    if (jp_is_infinity(a)) { *r = *b; return; }
    if (jp_is_infinity(b)) { *r = *a; return; }

    uint32_t z1z1[LIMBS], z2z2[LIMBS], u1[LIMBS], u2[LIMBS], s1[LIMBS], s2[LIMBS];
    uint32_t h[LIMBS], rr[LIMBS], i[LIMBS], j[LIMBS], v[LIMBS];
    uint32_t t1[LIMBS], t2[LIMBS], x3[LIMBS], y3[LIMBS], z3[LIMBS];

    mont_sqr(z1z1, a->z, &MOD_P);
    mont_sqr(z2z2, b->z, &MOD_P);
    mont_mul(u1, a->x, z2z2, &MOD_P);
    mont_mul(u2, b->x, z1z1, &MOD_P);
    mont_mul(s1, a->y, b->z, &MOD_P);
    mont_mul(s1, s1, z2z2, &MOD_P);
    mont_mul(s2, b->y, a->z, &MOD_P);
    mont_mul(s2, s2, z1z1, &MOD_P);

    fe_sub(h, u2, u1, &MOD_P);
    fe_sub(t1, s2, s1, &MOD_P);

    if (fe_is_zero(h)) {
        if (fe_is_zero(t1)) {
            jp_double(r, a);           /* mismo punto: la suma es un doblado */
        } else {
            jp_infinity(r);            /* P + (-P) */
        }
        return;
    }

    fe_add(rr, t1, t1, &MOD_P);        /* r = 2(S2-S1) */
    fe_add(t2, h, h, &MOD_P);
    mont_sqr(i, t2, &MOD_P);           /* I = (2H)^2 */
    mont_mul(j, h, i, &MOD_P);         /* J = H*I */
    mont_mul(v, u1, i, &MOD_P);        /* V = U1*I */

    mont_sqr(x3, rr, &MOD_P);
    fe_sub(x3, x3, j, &MOD_P);
    fe_add(t2, v, v, &MOD_P);
    fe_sub(x3, x3, t2, &MOD_P);        /* X3 = r^2 - J - 2V */

    fe_sub(y3, v, x3, &MOD_P);
    mont_mul(y3, rr, y3, &MOD_P);
    mont_mul(t1, s1, j, &MOD_P);
    fe_add(t2, t1, t1, &MOD_P);
    fe_sub(y3, y3, t2, &MOD_P);        /* Y3 = r(V-X3) - 2 S1 J */

    fe_add(t1, a->z, b->z, &MOD_P);
    mont_sqr(z3, t1, &MOD_P);
    fe_sub(z3, z3, z1z1, &MOD_P);
    fe_sub(z3, z3, z2z2, &MOD_P);
    mont_mul(z3, z3, h, &MOD_P);       /* Z3 = ((Z1+Z2)^2 - Z1Z1 - Z2Z2) H */

    fe_set(r->x, x3);
    fe_set(r->y, y3);
    fe_set(r->z, z3);
}

/** Coordenada X afin de un punto jacobiano, fuera del dominio de Montgomery. */
static bool jp_affine_x(uint32_t out[LIMBS], const jpoint *a)
{
    if (jp_is_infinity(a)) return false;
    uint32_t zinv[LIMBS], zinv2[LIMBS], x[LIMBS];
    mont_inv(zinv, a->z, &MOD_P);
    mont_sqr(zinv2, zinv, &MOD_P);
    mont_mul(x, a->x, zinv2, &MOD_P);
    from_mont(out, x, &MOD_P);
    return true;
}

/**
 * Comprueba que (x, y) afines (en Montgomery) satisfacen y^2 = x^3 - 3x + b.
 * Aceptar un punto que no esta en la curva es una via conocida de
 * falsificacion: no es una comprobacion decorativa.
 */
static bool point_on_curve(const uint32_t x[LIMBS], const uint32_t y[LIMBS])
{
    uint32_t lhs[LIMBS], rhs[LIMBS], t[LIMBS], three_x[LIMBS];
    mont_sqr(lhs, y, &MOD_P);
    mont_sqr(t, x, &MOD_P);
    mont_mul(rhs, t, x, &MOD_P);              /* x^3 */
    fe_add(three_x, x, x, &MOD_P);
    fe_add(three_x, three_x, x, &MOD_P);      /* 3x */
    fe_sub(rhs, rhs, three_x, &MOD_P);
    fe_add(rhs, rhs, P256_B_MONT, &MOD_P);
    return fe_eq(lhs, rhs);
}

/** r = u1*G + u2*Q por el truco de Shamir (u1, u2 enteros de 256 bits). */
static void shamir(jpoint *r, const uint32_t u1[LIMBS], const jpoint *g,
                   const uint32_t u2[LIMBS], const jpoint *q)
{
    jpoint gq;
    jp_add(&gq, g, q);

    jpoint acc;
    jp_infinity(&acc);

    for (int i = 255; i >= 0; --i) {
        jp_double(&acc, &acc);
        unsigned b1 = (u1[i / 32] >> (i % 32)) & 1u;
        unsigned b2 = (u2[i / 32] >> (i % 32)) & 1u;
        if (b1 && b2) {
            jp_add(&acc, &acc, &gq);
        } else if (b1) {
            jp_add(&acc, &acc, g);
        } else if (b2) {
            jp_add(&acc, &acc, q);
        }
    }
    *r = acc;
}

/* ------------------------------------------------------------ verificacion -- */

bool diana_p256_verify(const uint8_t pubkey[DIANA_P256_PUBKEY_LEN],
                       const uint8_t digest[DIANA_P256_DIGEST_LEN],
                       const uint8_t sig[DIANA_P256_SIG_LEN])
{
    if (pubkey == NULL || digest == NULL || sig == NULL) return false;
    /* Solo punto NO comprimido. Nada de descomprimir un punto de un byte de
     * paridad: menos formas de entrada, menos superficie. */
    if (pubkey[0] != 0x04u) return false;

    uint32_t qx[LIMBS], qy[LIMBS];
    be32_to_limbs(qx, pubkey + 1);
    be32_to_limbs(qy, pubkey + 33);
    if (fe_cmp(qx, P256_P) >= 0 || fe_cmp(qy, P256_P) >= 0) return false;

    uint32_t qxm[LIMBS], qym[LIMBS];
    to_mont(qxm, qx, &MOD_P);
    to_mont(qym, qy, &MOD_P);
    if (!point_on_curve(qxm, qym)) return false;
    /* Q no puede ser el infinito: X e Y ambos cero no esta en la curva, pero
     * se comprueba explicitamente por si b llegara a ser 0 en otra curva. */
    if (fe_is_zero(qxm) && fe_is_zero(qym)) return false;

    uint32_t r[LIMBS], s[LIMBS];
    be32_to_limbs(r, sig);
    be32_to_limbs(s, sig + 32);
    /* r, s en [1, n-1]. Una s = 0 o r = 0 hace pasar cualquier cosa si no se
     * comprueba, y una s >= n abre maleabilidad. */
    if (fe_is_zero(r) || fe_is_zero(s)) return false;
    if (fe_cmp(r, P256_N) >= 0 || fe_cmp(s, P256_N) >= 0) return false;

    /* e = digest truncado al tamano del orden (P-256: mismo tamano) y reducido. */
    uint32_t e[LIMBS];
    be32_to_limbs(e, digest);
    if (fe_cmp(e, P256_N) >= 0) (void)fe_sub_raw(e, e, P256_N);

    /* w = s^-1 mod n; u1 = e*w mod n; u2 = r*w mod n. */
    uint32_t sm[LIMBS], wm[LIMBS], em[LIMBS], rm[LIMBS], u1m[LIMBS], u2m[LIMBS];
    uint32_t u1[LIMBS], u2[LIMBS];
    to_mont(sm, s, &MOD_N);
    mont_inv(wm, sm, &MOD_N);
    to_mont(em, e, &MOD_N);
    to_mont(rm, r, &MOD_N);
    mont_mul(u1m, em, wm, &MOD_N);
    mont_mul(u2m, rm, wm, &MOD_N);
    from_mont(u1, u1m, &MOD_N);
    from_mont(u2, u2m, &MOD_N);

    jpoint g, q, point;
    fe_set(g.x, P256_GX_MONT);
    fe_set(g.y, P256_GY_MONT);
    fe_set(g.z, P256_ONE_MONT);
    fe_set(q.x, qxm);
    fe_set(q.y, qym);
    fe_set(q.z, P256_ONE_MONT);

    shamir(&point, u1, &g, u2, &q);
    if (jp_is_infinity(&point)) return false;

    uint32_t x[LIMBS];
    if (!jp_affine_x(x, &point)) return false;
    if (fe_cmp(x, P256_N) >= 0) (void)fe_sub_raw(x, x, P256_N);

    return fe_cmp(x, r) == 0;
}

bool diana_p256_verify_message(const uint8_t pubkey[DIANA_P256_PUBKEY_LEN],
                               const void *msg, size_t msg_len,
                               const uint8_t sig[DIANA_P256_SIG_LEN])
{
    if (msg == NULL && msg_len != 0) return false;
    uint8_t digest[DIANA_P256_DIGEST_LEN];
    diana_sha256 ctx;
    diana_sha256_init(&ctx);
    diana_sha256_update(&ctx, msg, msg_len);
    diana_sha256_final(&ctx, digest);
    return diana_p256_verify(pubkey, digest, sig);
}
