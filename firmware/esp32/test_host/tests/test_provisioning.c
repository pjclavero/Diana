/**
 * @file test_provisioning.c
 * @brief Ejercita de VERDAD el codigo D1b del dispositivo: base64url estricto,
 *        cadenas canonicas, ECDSA P-256 propio, delegacion, maquina de estados
 *        y persistencia entre reinicios.
 *
 * Los vectores de prov_vectors.h estan generados por una implementacion
 * INDEPENDIENTE de la canonicalizacion (Python) y firmados con ECDSA real. Por
 * eso una divergencia de un solo byte en la canonicalizacion de C hace que la
 * firma deje de verificar y estas pruebas mueran: no comprueban "que el codigo
 * hace lo que hace", comprueban que coincide con el contrato.
 */
#include <string.h>

#include "diana/base64url.h"
#include "diana/p256.h"
#include "diana/provisioning.h"
#include "diana/sha256.h"
#include "hal_host.h"
#include "test_util.h"

#include "prov_vectors.h"

/* ------------------------------------------------------------ utilidades -- */

static void hex_of(const uint8_t *raw, size_t len, char *out)
{
    static const char H[] = "0123456789abcdef";
    for (size_t i = 0; i < len; ++i) {
        out[2 * i] = H[(raw[i] >> 4) & 0x0fu];
        out[2 * i + 1] = H[raw[i] & 0x0fu];
    }
    out[2 * len] = '\0';
}

static const pv_order *order_named(const char *name)
{
    for (size_t i = 0; i < sizeof(PV_ORDERS) / sizeof(PV_ORDERS[0]); ++i) {
        if (strcmp(PV_ORDERS[i].name, name) == 0) return &PV_ORDERS[i];
    }
    return NULL;
}

static void copy(char *dst, size_t cap, const char *src)
{
    size_t n = strlen(src);
    if (n >= cap) n = cap - 1u;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

static void fill_delegation(diana_prov_delegation *d, const pv_delegation *v)
{
    memset(d, 0, sizeof(*d));
    d->delegation_version = v->version;
    copy(d->delegation_id, sizeof(d->delegation_id), v->delegation_id);
    copy(d->root_key_id, sizeof(d->root_key_id), v->root_key_id);
    copy(d->operational_key_id, sizeof(d->operational_key_id), v->operational_key_id);
    copy(d->operational_public_key, sizeof(d->operational_public_key),
         v->operational_public_key);
    copy(d->scope, sizeof(d->scope), v->scope);
    d->delegation_sequence = v->sequence;
    copy(d->system_id, sizeof(d->system_id), v->system_id);
    copy(d->signature_alg, sizeof(d->signature_alg), DIANA_PROV_SIGNATURE_ALG);
    copy(d->root_signature, sizeof(d->root_signature), v->root_signature);
}

/** Construye la orden a partir del vector. `deleg` NULL = sin credencial. */
static void build_cmd(diana_prov_command *c, const pv_order *v,
                      const pv_delegation *deleg)
{
    memset(c, 0, sizeof(*c));
    copy(c->request_id, sizeof(c->request_id),
         "9f9f9f9f-0000-4000-8000-000000000001");
    copy(c->device_id, sizeof(c->device_id), v->device_id);
    copy(c->system_id, sizeof(c->system_id), v->system_id);

    if (strcmp(v->action, "PROVISION") == 0) c->action = DIANA_PROV_ACTION_PROVISION;
    else if (strcmp(v->action, "PREPARE") == 0) c->action = DIANA_PROV_ACTION_PREPARE;
    else c->action = DIANA_PROV_ACTION_COMMIT;

    if (strcmp(v->mode, "NORMAL") == 0) c->mode = DIANA_PROV_MODE_NORMAL;
    else if (strcmp(v->mode, "EMERGENCY") == 0) c->mode = DIANA_PROV_MODE_EMERGENCY;
    else c->mode = DIANA_PROV_MODE_NONE;

    c->provisioning_sequence = v->sequence;
    copy(c->rotation_id, sizeof(c->rotation_id), v->rotation_id);
    copy(c->current_epoch, sizeof(c->current_epoch), v->current_epoch);
    copy(c->next_epoch, sizeof(c->next_epoch), v->next_epoch);
    copy(c->epoch, sizeof(c->epoch), v->epoch);
    copy(c->provision_id, sizeof(c->provision_id), v->provision_id);
    c->issued_at_ms = v->issued_at_ms;
    copy(c->provisioning_key_fingerprint, sizeof(c->provisioning_key_fingerprint),
         v->fingerprint);
    copy(c->signature_alg, sizeof(c->signature_alg), DIANA_PROV_SIGNATURE_ALG);
    copy(c->signature, sizeof(c->signature), v->signature);

    c->has_request_id = true;
    c->has_provisioning_sequence = true;
    c->has_issued_at_ms = true;
    c->has_schema_version_1 = true;
    c->has_command_plane_device_management = true;

    if (deleg != NULL) {
        c->has_delegation = true;
        fill_delegation(&c->delegation, deleg);
    }
}

static const char *reason_of(const diana_prov_outcome *o)
{
    const char *r = diana_prov_reason_str(o->reason);
    return r != NULL ? r : "(ninguno)";
}

static bool trace_has(const diana_prov_outcome *o, const char *step)
{
    for (size_t i = 0; i < o->trace_len; ++i) {
        if (strcmp(o->trace[i], step) == 0) return true;
    }
    return false;
}

/** Indice del paso en la traza, o -1. Sirve para demostrar el ORDEN. */
static int trace_idx(const diana_prov_outcome *o, const char *step)
{
    for (size_t i = 0; i < o->trace_len; ++i) {
        if (strcmp(o->trace[i], step) == 0) return (int)i;
    }
    return -1;
}

/* ------------------------------------------------------------- base64url -- */

static void test_base64url(void)
{
    SECTION("base64url estricto: sin relleno, sin '+/', sin bits sobrantes");

    uint8_t buf[64];
    size_t len = sizeof(buf);
    CHECK(diana_base64url_decode("aGVsbG8", buf, &len) && len == 5u &&
              memcmp(buf, "hello", 5) == 0,
          "decodifica base64url valido sin relleno");

    len = sizeof(buf);
    CHECK(!diana_base64url_decode("aGVsbG8=", buf, &len),
          "rechaza el relleno '=' (RFC 4648 s5 sin padding)");

    len = sizeof(buf);
    CHECK(!diana_base64url_decode("a+b/cd", buf, &len),
          "rechaza el alfabeto estandar '+' y '/'");

    len = sizeof(buf);
    CHECK(!diana_base64url_decode("aGVs bG8", buf, &len),
          "rechaza espacios embebidos");

    /* Bits sobrantes del ultimo grupo. Sin esta comprobacion, DOS cadenas
     * distintas decodifican a los MISMOS bytes y "la firma es unica" deja de
     * ser cierto. Se comprueban los dos grupos parciales por separado: un OR
     * de las dos condiciones dejaria pasar el fallo de una de ellas. */
    len = sizeof(buf);
    CHECK(!diana_base64url_decode("aGB", buf, &len),
          "rechaza bits sobrantes en el grupo de 3 caracteres");
    len = sizeof(buf);
    CHECK(!diana_base64url_decode("aB", buf, &len),
          "rechaza bits sobrantes en el grupo de 2 caracteres");
    len = sizeof(buf);
    CHECK(diana_base64url_decode("aGA", buf, &len) && len == 2u,
          "...y acepta el mismo grupo con los bits sobrantes a cero");
    len = sizeof(buf);
    CHECK(!diana_base64url_decode("a", buf, &len),
          "rechaza un grupo final de un solo caracter (imposible)");

    /* Ida y vuelta: encode -> decode devuelve exactamente los mismos bytes. */
    const uint8_t raw[] = {0x00, 0xff, 0x10, 0xab, 0x3e, 0x7f, 0x01};
    char enc[32];
    size_t n = diana_base64url_encode(raw, sizeof(raw), enc, sizeof(enc));
    len = sizeof(buf);
    CHECK(n > 0 && diana_base64url_decode(enc, buf, &len) &&
              len == sizeof(raw) && memcmp(buf, raw, sizeof(raw)) == 0,
          "ida y vuelta encode/decode conserva los bytes");

    /* Capacidad insuficiente: fallo cerrado, nunca escritura parcial util. */
    uint8_t tiny[2];
    len = sizeof(tiny);
    CHECK(!diana_base64url_decode("aGVsbG8", tiny, &len),
          "no desborda cuando el destino es pequeno");
}

/* ------------------------------------------------------- canonicalizacion -- */

static void test_canonical(void)
{
    SECTION("cadena canonica igual, BYTE A BYTE, a la del contrato");

    uint8_t canon[DIANA_PROV_CANON_MAX];
    char hex[65];

    for (size_t i = 0; i < sizeof(PV_ORDERS) / sizeof(PV_ORDERS[0]); ++i) {
        const pv_order *v = &PV_ORDERS[i];
        diana_prov_command c;
        build_cmd(&c, v, NULL);
        size_t n = diana_prov_canonical(&c, canon, sizeof(canon));

        uint8_t digest[32];
        diana_sha256 sh;
        diana_sha256_init(&sh);
        diana_sha256_update(&sh, canon, n);
        diana_sha256_final(&sh, digest);
        hex_of(digest, sizeof(digest), hex);

        char desc[96];
        snprintf(desc, sizeof(desc), "canonica de '%s' coincide con la de referencia",
                 v->name);
        CHECK(n == (size_t)v->canon_len && strcmp(hex, v->canon_sha256) == 0, desc);
    }

    SECTION("cadena canonica: propiedades estructurales");

    /* Parejas del corpus ampliado. El bucle de arriba solo demuestra
     * C == Python vector a vector; la RELACION entre dos vectores es una
     * afirmacion distinta y se comprueba aparte.
     *
     * CONTRACT_GAP-H4-EMPTY-VS-ABSENT: en esta canonica una cadena vacia y un
     * campo ausente producen exactamente los mismos bytes. Es intencional aqui
     * y esta medido; queda registrado porque contracts/validate.py SI los
     * distingue a nivel de esquema. */
    uint8_t pa[DIANA_PROV_CANON_MAX], pb[DIANA_PROV_CANON_MAX];
    diana_prov_command pc1, pc2;

    /* CONTRACT_GAP-H4-EMPTY-VS-ABSENT: en esta canonica una cadena vacia y un
     * campo ausente producen exactamente los mismos bytes. Se canonicaliza en C
     * y se comparan los bytes reales, no los digestos de la referencia.
     * OJO: diana_prov_command usa arrays fijos, asi que en C la distincion ni
     * siquiera es representable; quien detecta una divergencia con el contrato
     * es el bucle de cruce contra Python de arriba, no esta comprobacion.
     * No hay tercera opinion posible hoy: contracts/ NO contiene ningun esquema
     * del plano DEVICE_MANAGEMENT (comprobado: 0 ficheros mencionan
     * provisioning_sequence fuera de firmware/), asi que la unica referencia
     * externa es tools/gen_prov_vectors.py. */
    build_cmd(&pc1, order_named("canon_vacio_explicito"), NULL);
    build_cmd(&pc2, order_named("canon_vacio_ausente"), NULL);
    size_t npa = diana_prov_canonical(&pc1, pa, sizeof(pa));
    size_t npb = diana_prov_canonical(&pc2, pb, sizeof(pb));
    CHECK(npa == npb && npa > 0 && memcmp(pa, pb, npa) == 0,
          "cadena vacia y campo ausente producen la MISMA canonica");

    /* Un solo byte de diferencia en un campo: misma longitud, otra canonica.
     * Si coincidiesen, la firma de una orden valdria para otra distinta. */
    build_cmd(&pc1, order_named("canon_un_byte_a"), NULL);
    build_cmd(&pc2, order_named("canon_un_byte_b"), NULL);
    npa = diana_prov_canonical(&pc1, pa, sizeof(pa));
    npb = diana_prov_canonical(&pc2, pb, sizeof(pb));
    CHECK(npa == npb && npa > 0 && memcmp(pa, pb, npa) != 0,
          "un byte de diferencia produce OTRA canonica de igual longitud");

    diana_prov_command a, b;
    const pv_order *ov = order_named("provision_ok");
    build_cmd(&a, ov, NULL);
    b = a;
    /* Ausente (0xFFFFFFFF) NO es lo mismo que el valor literal "-": si lo
     * fuese, un emisor podria falsificar la ausencia de un campo. */
    copy(b.rotation_id, sizeof(b.rotation_id), "-");
    uint8_t ca[DIANA_PROV_CANON_MAX], cb[DIANA_PROV_CANON_MAX];
    size_t na = diana_prov_canonical(&a, ca, sizeof(ca));
    size_t nb = diana_prov_canonical(&b, cb, sizeof(cb));
    CHECK(na != nb || memcmp(ca, cb, na) != 0,
          "ausente y el valor literal '-' NO producen la misma cadena");

    /* Sin delimitadores: mover un byte de un campo al siguiente cambia la
     * cadena (el prefijo de longitud lo impide). */
    b = a;
    copy(b.device_id, sizeof(b.device_id), "module-0");
    copy(b.system_id, sizeof(b.system_id), "7system-a");
    nb = diana_prov_canonical(&b, cb, sizeof(cb));
    CHECK(na != nb || memcmp(ca, cb, na) != 0,
          "el prefijo de longitud impide desplazar contenido entre campos");

    /* Capacidad insuficiente -> 0, nunca una cadena truncada que se firme. */
    uint8_t small[16];
    CHECK(diana_prov_canonical(&a, small, sizeof(small)) == 0,
          "devuelve 0 si la cadena no cabe (nunca trunca)");

    SECTION("la canonica de la DELEGACION es otra cadena y otro dominio");

    diana_prov_delegation d;
    fill_delegation(&d, &PV_DELEGS[0]);
    uint8_t dc[DIANA_PROV_CANON_MAX];
    size_t dn = diana_prov_delegation_canonical(&d, dc, sizeof(dc));
    CHECK(dn > 0 && memcmp(dc + 4, DIANA_PROV_DELEG_DOMAIN_SEP,
                           strlen(DIANA_PROV_DELEG_DOMAIN_SEP)) == 0,
          "la delegacion usa su propio separador de dominio");

    uint8_t fp[32];
    diana_prov_delegation_fingerprint(&d, fp);
    hex_of(fp, sizeof(fp), hex);
    CHECK_EQ_STR(hex, PV_DELEGS[0].fingerprint_hex,
                 "delegation_fingerprint = SHA-256 del payload canonico");

    /* La firma NO entra en el fingerprint: ECDSA no es determinista. */
    diana_prov_delegation d2 = d;
    copy(d2.root_signature, sizeof(d2.root_signature), PV_DELEGS[1].root_signature);
    uint8_t fp2[32];
    diana_prov_delegation_fingerprint(&d2, fp2);
    CHECK(memcmp(fp, fp2, 32) == 0,
          "el fingerprint EXCLUYE la firma (cambiarla no lo cambia)");

    /* Pero cualquier campo firmado si lo cambia. */
    d2 = d;
    d2.delegation_sequence = 99;
    diana_prov_delegation_fingerprint(&d2, fp2);
    CHECK(memcmp(fp, fp2, 32) != 0,
          "el fingerprint cambia si cambia un campo del payload");
}

/* ------------------------------------------------------------ ECDSA P-256 -- */

static void test_p256(void)
{
    SECTION("ECDSA P-256: verificacion contra vectores firmados de verdad");

    const pv_order *v = order_named("provision_ok");
    diana_prov_command c;
    build_cmd(&c, v, NULL);
    uint8_t canon[DIANA_PROV_CANON_MAX];
    size_t n = diana_prov_canonical(&c, canon, sizeof(canon));

    uint8_t opkey[DIANA_P256_PUBKEY_LEN];
    CHECK(diana_prov_decode_pubkey(PV_DELEGS[0].operational_public_key, opkey),
          "extrae el punto SEC1 de un SubjectPublicKeyInfo DER de P-256");

    uint8_t sig[DIANA_P256_SIG_LEN];
    size_t sig_len = sizeof(sig);
    CHECK(diana_base64url_decode(v->signature, sig, &sig_len) &&
              sig_len == (size_t)DIANA_P256_SIG_LEN,
          "la firma P1363 son 64 bytes exactos");

    CHECK(diana_p256_verify_message(opkey, canon, n, sig),
          "firma valida sobre la cadena canonica VERIFICA");

    /* Un bit del mensaje. */
    canon[n / 2] = (uint8_t)(canon[n / 2] ^ 0x01u);
    CHECK(!diana_p256_verify_message(opkey, canon, n, sig),
          "un solo bit distinto en el mensaje invalida la firma");
    canon[n / 2] = (uint8_t)(canon[n / 2] ^ 0x01u);

    /* Un bit de la firma. */
    uint8_t bad[DIANA_P256_SIG_LEN];
    memcpy(bad, sig, sizeof(bad));
    bad[10] = (uint8_t)(bad[10] ^ 0x80u);
    CHECK(!diana_p256_verify_message(opkey, canon, n, bad),
          "un solo bit distinto en la firma la invalida");

    /* Otra clave: la firma de un extrano no vale. */
    uint8_t stranger_sig[DIANA_P256_SIG_LEN];
    sig_len = sizeof(stranger_sig);
    CHECK(diana_base64url_decode(v->signature_stranger, stranger_sig, &sig_len) &&
              !diana_p256_verify_message(opkey, canon, n, stranger_sig),
          "una firma de otra clave NO verifica con esta");
    CHECK(diana_p256_verify_message(PV_STRANGER_KEY, canon, n, stranger_sig),
          "...y si verifica con la suya (el vector es correcto)");

    /* Punto fuera de la curva: via conocida de falsificacion. */
    uint8_t offcurve[DIANA_P256_PUBKEY_LEN];
    memcpy(offcurve, opkey, sizeof(offcurve));
    offcurve[40] = (uint8_t)(offcurve[40] ^ 0x55u);
    CHECK(!diana_p256_verify_message(offcurve, canon, n, sig),
          "rechaza una clave publica que no esta en la curva");

    /* r = 0 y s = 0 estan fuera de [1, n-1]. */
    memcpy(bad, sig, sizeof(bad));
    memset(bad, 0, 32);
    CHECK(!diana_p256_verify_message(opkey, canon, n, bad), "rechaza r = 0");
    memcpy(bad, sig, sizeof(bad));
    memset(bad + 32, 0, 32);
    CHECK(!diana_p256_verify_message(opkey, canon, n, bad), "rechaza s = 0");

    SECTION("decodificacion de clave publica: comparacion DER estricta");
    uint8_t key[DIANA_P256_PUBKEY_LEN];
    CHECK(!diana_prov_decode_pubkey("bm8", key),
          "rechaza un SPKI de longitud imposible");
    CHECK(!diana_prov_decode_pubkey(PV_DELEGS[0].root_signature, key),
          "rechaza bytes que no llevan el prefijo DER de secp256r1");
}

/* ------------------------------------------------- maquina de estados ----- */

typedef struct {
    host_persistent nv;
    host_hal_ctx    hctx;
    diana_hal       hal;
    diana_prov_ctx  prov;
} fixture;

static void fixture_init(fixture *f)
{
    host_persistent_reset(&f->nv, 16);
    host_hal_init(&f->hctx, &f->nv, &f->hal, 7);
    diana_prov_init(&f->prov, &f->hal, PV_DEVICE_ID, PV_SYSTEM_ID, PV_FINGERPRINT);
    diana_prov_set_root_key(&f->prov, PV_ROOT_KEY, PV_ROOT_KEY_ID);
}

/** Lanza una orden por nombre. `deleg` NULL = sin credencial adjunta. */
static void run_order(fixture *f, const char *name, const pv_delegation *deleg,
                      bool retained, diana_prov_outcome *out)
{
    const pv_order *v = order_named(name);
    diana_prov_command c;
    build_cmd(&c, v, deleg);
    diana_prov_handle(&f->prov, &c, retained, out);
}

static void test_state_machine(void)
{
    fixture f;
    diana_prov_outcome o;

    SECTION("arranque de fabrica: sin autoridad, se declara y no acepta juego");
    fixture_init(&f);
    CHECK(!diana_prov_accepts_game(&f.prov), "UNPROVISIONED no acepta el plano GAME");
    diana_prov_connect_declaration(&f.prov, &o);
    CHECK(o.publish && o.result == DIANA_PROV_RESULT_AUTHORITY_UNPROVISIONED,
          "declara AUTHORITY_UNPROVISIONED al conectar");

    SECTION("PROVISION verificado extremo a extremo");
    run_order(&f, "provision_ok", &PV_DELEGS[0], false, &o);
    CHECK_EQ_STR(diana_prov_result_str(o.result), "PROVISIONED",
                 "bootstrap firmado con delegacion valida se APLICA");
    CHECK_EQ_STR(reason_of(&o), "(ninguno)", "sin motivo de rechazo");
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state), "READY",
                 "tras PROVISION el estado es READY (no un sexto estado)");
    CHECK(o.authority_changed && strcmp(o.new_active_epoch, PV_EPOCH_A) == 0,
          "el epoch activo pasa a ser el de la orden");
    CHECK(diana_prov_accepts_game(&f.prov), "READY si acepta el plano GAME");

    SECTION("orden de verificacion EJECUTADO (traza), no solo el veredicto");
    CHECK(trace_idx(&o, "retained-check") == 0,
          "lo primero que se ejecuta es la comprobacion de retenido");
    CHECK(trace_idx(&o, "schema-conformance") < trace_idx(&o, "addressing-check"),
          "conformidad antes que direccionamiento");
    CHECK(trace_idx(&o, "delegation-signature") < trace_idx(&o, "order-signature"),
          "la delegacion se verifica ANTES que la firma de la orden");
    CHECK(trace_idx(&o, "order-signature") <
            trace_idx(&o, "provisioning-sequence-check"),
          "la firma antes que la barrera antirrepeticion");

    SECTION("un PROVISION repetido sobre READY es already_provisioned");
    run_order(&f, "provision_ok2", &PV_DELEGS[0], false, &o);
    CHECK_EQ_STR(reason_of(&o), "already_provisioned",
                 "no se re-provisiona un dispositivo con autoridad");

    SECTION("retenido: muere POR RETENIDO aunque todo lo demas sea valido");
    fixture_init(&f);
    run_order(&f, "provision_ok", &PV_DELEGS[0], true, &o);
    CHECK_EQ_STR(reason_of(&o), "retained_provisioning_rejected",
                 "un retenido criptograficamente valido se rechaza igual");
    CHECK(!trace_has(&o, "order-signature"),
          "ni siquiera llega a verificar la firma");
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state),
                 "UNPROVISIONED", "y no cambia nada del estado");

    SECTION("direccionamiento y raiz");
    fixture_init(&f);
    run_order(&f, "provision_other_device", &PV_DELEGS[0], false, &o);
    CHECK_EQ_STR(reason_of(&o), "device_mismatch",
                 "una orden firmada para otro modulo no es para este");
    fixture_init(&f);
    run_order(&f, "provision_bad_fp", &PV_DELEGS[0], false, &o);
    CHECK_EQ_STR(reason_of(&o), "provisioning_key_mismatch",
                 "firmada bajo otra raiz: diagnostico honesto, no 'firma mala'");

    SECTION("algoritmo: constante que se compara, no selector");
    fixture_init(&f);
    {
        const pv_order *v = order_named("provision_ok");
        diana_prov_command c;
        build_cmd(&c, v, &PV_DELEGS[0]);
        copy(c.signature_alg, sizeof(c.signature_alg), "ECDSA-P256-SHA256-DER");
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "signature_algorithm_rejected",
                     "otro literal de algoritmo se rechaza, no se 'soporta'");
    }

    SECTION("firma de la orden manipulada");
    fixture_init(&f);
    {
        const pv_order *v = order_named("provision_ok");
        diana_prov_command c;
        build_cmd(&c, v, &PV_DELEGS[0]);
        /* Firmada por la clave operativa 2, que esta delegacion NO autoriza. */
        copy(c.signature, sizeof(c.signature), v->signature_op2);
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "invalid_signature",
                     "una firma de una clave no autorizada por ESTA delegacion cae");
        CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state),
                     "UNPROVISIONED", "y no aplica nada");
    }

    SECTION("delegacion: raiz, version, secuencia y reafirmacion");
    fixture_init(&f);
    {
        diana_prov_command c;
        build_cmd(&c, order_named("provision_ok"), &PV_DELEGS[0]);
        /* (a) firma de la credencial manipulada */
        diana_prov_delegation good = c.delegation;
        c.delegation.root_signature[3] =
            c.delegation.root_signature[3] == 'A' ? 'B' : 'A';
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "delegation_invalid_signature",
                     "credencial con firma manipulada: fallo cerrado");

        /* (b) version distinta de 1 */
        c.delegation = good;
        c.delegation.delegation_version = 2;
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "delegation_invalid_signature",
                     "cambiar la version invalida la firma (esta dentro)");

        /* (c) scope distinto del const del esquema: NO conforma */
        c.delegation = good;
        copy(c.delegation.scope, sizeof(c.delegation.scope), "OTRO_SCOPE");
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "malformed_provisioning_message",
                     "scope distinto del const: mensaje no conforme");

        /* (c bis) credencial REALMENTE firmada por la raiz pero emitida para
         * OTRO sistema. system_mismatch cubre a la vez la orden y la
         * credencial que la acompana: una credencial legitima de otro
         * despliegue no autoriza nada aqui. */
        diana_prov_command c2;
        build_cmd(&c2, order_named("provision_ok"), &PV_DELEGS[3]);
        diana_prov_handle(&f.prov, &c2, false, &o);
        CHECK_EQ_STR(reason_of(&o), "system_mismatch",
                     "credencial valida de OTRO sistema: no autoriza aqui");
        CHECK(trace_has(&o, "delegation-system-check"),
              "y el paso de comprobacion del sistema se ejecuta de verdad");

        /* (c ter) root_key_id de fabrica distinto: diagnostico separado. */
        build_cmd(&c2, order_named("provision_ok"), &PV_DELEGS[0]);
        copy(c2.delegation.root_key_id, sizeof(c2.delegation.root_key_id),
             "root-key-de-otra-fabrica");
        diana_prov_handle(&f.prov, &c2, false, &o);
        CHECK_EQ_STR(reason_of(&o), "delegation_root_key_mismatch",
                     "root_key_id ajeno: diagnostico propio, no 'firma mala'");

        /* (d) sin raiz fijada, TODA credencial se rechaza */
        c.delegation = good;
        c.delegation = good;
        diana_prov_set_root_key(&f.prov, NULL, PV_ROOT_KEY_ID);
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "delegation_invalid_signature",
                     "sin raiz fijada no se acepta nada (nunca 'no puedo, acepto')");
        diana_prov_set_root_key(&f.prov, PV_ROOT_KEY, PV_ROOT_KEY_ID);
    }

    SECTION("delegacion: secuencia menor, igual y mayor");
    fixture_init(&f);
    run_order(&f, "provision_ok", &PV_DELEGS[1], false, &o);   /* seq 2 */
    CHECK_EQ_STR(reason_of(&o), "invalid_signature",
                 "la delegacion 2 autoriza otra clave: la orden no verifica");
    CHECK_EQ_INT(f.prov.st.last_delegation_sequence, 2,
                 "pero la credencial valida SI se persiste (decision declarada)");

    {
        /* Ahora la delegacion 1 (secuencia menor) es un replay. */
        diana_prov_command c;
        build_cmd(&c, order_named("prepare_ok"), &PV_DELEGS[0]);
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "delegation_sequence_rejected",
                     "una delegacion con secuencia MENOR es un replay");

        /* Misma secuencia y mismo contenido: reafirmacion idempotente. */
        build_cmd(&c, order_named("provision_ok2"), &PV_DELEGS[1]);
        uint64_t before = f.prov.st.last_delegation_sequence;
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK(trace_has(&o, "delegation-reaffirmed"),
              "misma secuencia y mismo fingerprint: reafirmacion idempotente");
        CHECK_EQ_INT(f.prov.st.last_delegation_sequence, before,
                     "la reafirmacion no cambia la autoridad");

        /* Misma secuencia, contenido DISTINTO: conflicto. D3 es otra credencial
         * REALMENTE firmada por la raiz con la misma delegation_sequence que
         * D2, que es el unico modo de llegar a este rechazo (manipular D2
         * moriria antes, por firma). */
        build_cmd(&c, order_named("provision_ok2"), &PV_DELEGS[2]);
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "delegation_sequence_conflict",
                     "misma secuencia autorizando contenido distinto: conflicto");
    }

    SECTION("rotacion en dos fases: PREPARE y COMMIT");
    fixture_init(&f);
    run_order(&f, "provision_ok", &PV_DELEGS[0], false, &o);
    CHECK(o.applied, "precondicion: dispositivo en READY sobre el epoch A");

    run_order(&f, "prepare_ok", NULL, false, &o);
    CHECK_EQ_STR(diana_prov_result_str(o.result), "PREPARED",
                 "PREPARE sin credencial nueva usa la clave ya aceptada");
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state), "PREPARED",
                 "el estado pasa a PREPARED");
    CHECK_EQ_STR(f.prov.st.pending_epoch, PV_EPOCH_B, "queda pendiente el epoch B");
    CHECK(diana_prov_accepts_game(&f.prov), "PREPARED sigue aceptando GAME");

    run_order(&f, "commit_ok", NULL, false, &o);
    CHECK_EQ_STR(diana_prov_result_str(o.result), "COMMITTED",
                 "COMMIT de la rotacion preparada se aplica");
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state), "READY",
                 "tras COMMIT el estado vuelve a READY (COMMITTED no es estado)");
    CHECK_EQ_STR(f.prov.st.active_epoch, PV_EPOCH_B, "el epoch B queda activo");
    CHECK_EQ_STR(f.prov.st.pending_epoch, "", "y no queda ninguno pendiente");

    SECTION("barrera antirrepeticion del canal");
    run_order(&f, "commit_ok", NULL, false, &o);
    CHECK_EQ_STR(reason_of(&o), "provisioning_sequence_rejected",
                 "reenviar la MISMA orden (misma secuencia) se rechaza");

    SECTION("PREPARE con current_epoch ajeno: el dispositivo queda STALE");
    run_order(&f, "prepare_stale", NULL, false, &o);
    CHECK_EQ_STR(reason_of(&o), "provisioning_sequence_rejected",
                 "secuencia 21 ya consumida por la 30: se rechaza antes");

    fixture_init(&f);
    run_order(&f, "provision_ok", &PV_DELEGS[0], false, &o);
    run_order(&f, "prepare_stale", NULL, false, &o);
    CHECK_EQ_STR(reason_of(&o), "current_epoch_mismatch",
                 "prueba firmada de que el servidor cree vigente otra autoridad");
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state), "STALE",
                 "y el dispositivo se declara STALE");
    CHECK(!diana_prov_accepts_game(&f.prov), "STALE deja de aceptar GAME");
    diana_prov_connect_declaration(&f.prov, &o);
    CHECK(o.publish && o.result == DIANA_PROV_RESULT_AUTHORITY_STALE,
          "y lo declara al reconectar");

    SECTION("COMMIT de una rotacion nunca preparada, en modo EMERGENCY");
    fixture_init(&f);
    run_order(&f, "provision_ok", &PV_DELEGS[0], false, &o);
    run_order(&f, "commit_unknown", NULL, false, &o);
    CHECK_EQ_STR(reason_of(&o), "rotation_id_unknown",
                 "COMMIT de una fase 1 que este dispositivo se perdio");
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state),
                 "QUARANTINED", "mode=EMERGENCY viaja FIRMADO y se aplica literal");
    CHECK(!diana_prov_accepts_game(&f.prov), "QUARANTINED no acepta GAME");

    SECTION("mensajes no conformes: sin modo heredado");
    fixture_init(&f);
    {
        diana_prov_command c;
        build_cmd(&c, order_named("provision_ok"), &PV_DELEGS[0]);
        c.has_provisioning_sequence = false;
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "malformed_provisioning_message",
                     "falta provisioning_sequence: malformado, NO 'orden antigua'");

        build_cmd(&c, order_named("provision_ok"), &PV_DELEGS[0]);
        c.has_request_id = false;
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK(!o.publish, "sin request_id no hay respuesta posible: se descarta");
        CHECK_EQ_INT(f.prov.undeliverable_rejections, 1, "y se contabiliza");

        build_cmd(&c, order_named("provision_ok"), &PV_DELEGS[0]);
        c.has_delegation = false;
        diana_prov_handle(&f.prov, &c, false, &o);
        CHECK_EQ_STR(reason_of(&o), "malformed_provisioning_message",
                     "un PROVISION sin credencial de delegacion no conforma");
    }
}

/* -------------------------------------------------- persistencia/reinicio -- */

static void test_persistence(void)
{
    SECTION("la autoridad sobrevive a un reinicio");

    fixture f;
    diana_prov_outcome o;
    fixture_init(&f);
    run_order(&f, "provision_ok", &PV_DELEGS[0], false, &o);
    run_order(&f, "prepare_ok", NULL, false, &o);
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)f.prov.st.state), "PREPARED",
                 "precondicion: rotacion preparada antes del corte");

    /* Reinicio: la NVS simulada sobrevive, todo lo demas se pierde. */
    host_reboot(&f.hctx, &f.hal, 7, 0);
    diana_prov_ctx after;
    diana_prov_init(&after, &f.hal, PV_DEVICE_ID, PV_SYSTEM_ID, PV_FINGERPRINT);
    diana_prov_set_root_key(&after, PV_ROOT_KEY, PV_ROOT_KEY_ID);

    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)after.st.state), "PREPARED",
                 "el estado se recupera de NVS tras el reinicio");
    CHECK_EQ_STR(after.st.active_epoch, PV_EPOCH_A, "el epoch activo sobrevive");
    CHECK_EQ_STR(after.st.pending_epoch, PV_EPOCH_B, "el pendiente tambien");
    CHECK_EQ_INT(after.st.last_provisioning_sequence, 20,
                 "la barrera antirrepeticion NO se reinicia con el dispositivo");
    CHECK_EQ_INT(after.st.last_delegation_sequence, 1,
                 "la secuencia de delegacion sobrevive");
    CHECK(after.st.has_operational_key &&
              memcmp(after.st.operational_key, f.prov.st.operational_key,
                     DIANA_P256_PUBKEY_LEN) == 0,
          "la clave operativa sobrevive ya decodificada");
    CHECK(after.st.has_delegation_fingerprint &&
              memcmp(after.st.delegation_fingerprint,
                     f.prov.st.delegation_fingerprint, 32) == 0,
          "el delegation_fingerprint de 32 B sobrevive");

    /* Y una orden replayada tras el reinicio sigue muriendo. */
    diana_prov_command c;
    build_cmd(&c, order_named("prepare_ok"), NULL);
    diana_prov_handle(&after, &c, false, &o);
    CHECK_EQ_STR(reason_of(&o), "provisioning_sequence_rejected",
                 "un replay que cruza el reinicio se rechaza igual");

    /* Y el COMMIT pendiente si se puede completar. */
    build_cmd(&c, order_named("commit_ok"), NULL);
    diana_prov_handle(&after, &c, false, &o);
    CHECK_EQ_STR(diana_prov_result_str(o.result), "COMMITTED",
                 "la rotacion preparada antes del corte se completa despues");

    SECTION("un blob de NVS de otro layout NO se reinterpreta");
    {
        uint8_t junk[64];
        memset(junk, 0xa5, sizeof(junk));
        f.hal.kv_set(f.hal.ctx, DIANA_PROV_NVS_NS, DIANA_PROV_NVS_KEY, junk,
                     sizeof(junk));
        diana_prov_ctx broken;
        diana_prov_init(&broken, &f.hal, PV_DEVICE_ID, PV_SYSTEM_ID, PV_FINGERPRINT);
        CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)broken.st.state),
                     "UNPROVISIONED",
                     "tamano distinto: arranca sin autoridad, no 'migra a ojo'");
    }

    SECTION("presupuesto NVS");
    CHECK(sizeof(diana_prov_persist) <= 512,
          "el estado persistente cabe en una clave holgada (<= 512 B)");
}

/* ------------------------------------------------- guardas por plano ------ */

static void test_guards(void)
{
    SECTION("un cambio de autoridad reprovisiona las guardas de los 3x3 planos");

    fixture f;
    diana_prov_outcome o;
    fixture_init(&f);

    static diana_seq_guard_set guards;
    diana_seq_guard_set_init(&guards, &f.hal);
    diana_prov_set_guards(&f.prov, &guards);

    int with_epoch = 0;
    for (int i = 0; i < SEQ_GUARD_ISSUER_COUNT; ++i) {
        for (int p = 0; p < SEQ_GUARD_PLANE_COUNT; ++p) {
            if (diana_seq_guard_has_epoch(&guards.entry[i][p])) with_epoch++;
        }
    }
    CHECK_EQ_INT(with_epoch, 0, "de fabrica ninguna guarda tiene epoch");

    run_order(&f, "provision_ok", &PV_DELEGS[0], false, &o);
    with_epoch = 0;
    for (int i = 0; i < SEQ_GUARD_ISSUER_COUNT; ++i) {
        for (int p = 0; p < SEQ_GUARD_PLANE_COUNT; ++p) {
            if (diana_seq_guard_has_epoch(&guards.entry[i][p])) with_epoch++;
        }
    }
    CHECK_EQ_INT(with_epoch, SEQ_GUARD_ISSUER_COUNT * SEQ_GUARD_PLANE_COUNT,
                 "tras PROVISION las nueve combinaciones (issuer, plane) tienen epoch");
}

/* ---------------------------------------------------------------- JSON ---- */

static void test_response_json(void)
{
    SECTION("respuesta module-provision-state");

    fixture f;
    diana_prov_outcome o;
    fixture_init(&f);

    const pv_order *v = order_named("provision_ok");
    diana_prov_command c;
    build_cmd(&c, v, &PV_DELEGS[0]);
    diana_prov_handle(&f.prov, &c, false, &o);

    char buf[1024];
    size_t n = diana_prov_state_json(&f.prov, &c, &o, buf, sizeof(buf));
    CHECK(n > 0, "serializa la respuesta del bootstrap");
    CHECK(strstr(buf, "\"result\":\"PROVISIONED\"") != NULL, "lleva result");
    CHECK(strstr(buf, "\"state\":\"READY\"") != NULL, "lleva el estado READY");
    CHECK(strstr(buf, "\"provision_id\"") != NULL,
          "un PROVISION responde con provision_id");
    CHECK(strstr(buf, "\"rotation_id\"") == NULL,
          "...y NUNCA con rotation_id (el esquema lo prohibe cruzarlos)");
    CHECK(strstr(buf, "\"reason\"") == NULL, "sin reason cuando no hay rechazo");

    /* Rechazo: el motivo es del vocabulario cerrado. */
    build_cmd(&c, v, &PV_DELEGS[0]);
    diana_prov_handle(&f.prov, &c, true, &o);
    n = diana_prov_state_json(&f.prov, &c, &o, buf, sizeof(buf));
    CHECK(n > 0 && strstr(buf, "\"reason\":\"retained_provisioning_rejected\"") != NULL,
          "el rechazo lleva el motivo del vocabulario del contrato");

    /* Cota de capacidad: nunca JSON truncado. */
    char tiny[32];
    CHECK(diana_prov_state_json(&f.prov, &c, &o, tiny, sizeof(tiny)) == 0,
          "devuelve 0 si la respuesta no cabe (nunca trunca)");
}

/* ------------------------------------------------------- vocabulario ------ */

static void test_vocabulary(void)
{
    SECTION("enumerados: cinco estados, ni uno mas");

    CHECK_EQ_STR(diana_prov_state_str(DIANA_PROV_UNPROVISIONED), "UNPROVISIONED", "estado 0");
    CHECK_EQ_STR(diana_prov_state_str(DIANA_PROV_READY), "READY", "estado 1");
    CHECK_EQ_STR(diana_prov_state_str(DIANA_PROV_PREPARED), "PREPARED", "estado 2");
    CHECK_EQ_STR(diana_prov_state_str(DIANA_PROV_STALE), "STALE", "estado 3");
    CHECK_EQ_STR(diana_prov_state_str(DIANA_PROV_QUARANTINED), "QUARANTINED", "estado 4");
    CHECK_EQ_STR(diana_prov_state_str((diana_prov_state)5), "?",
                 "no existe un sexto estado");
    CHECK_EQ_STR(diana_prov_result_str(DIANA_PROV_RESULT_PROVISIONED), "PROVISIONED",
                 "PROVISIONED es un RESULTADO");
    CHECK_EQ_STR(diana_prov_result_str(DIANA_PROV_RESULT_COMMITTED), "COMMITTED",
                 "COMMITTED es un RESULTADO");
    CHECK(diana_prov_reason_str(DIANA_PROV_REASON_NONE) == NULL,
          "'sin motivo' no es un motivo del vocabulario");
    CHECK_EQ_STR(diana_prov_reason_str(DIANA_PROV_REASON_DELEGATION_SEQUENCE_CONFLICT),
                 "delegation_sequence_conflict", "ultimo motivo del vocabulario");
}

/* ------------------------------------------------------------- runner ----- */


/* ===========================================================================
 * SEQ_GUARD_D1B_USED_PATHS
 * ===========================================================================
 * seq_guard entra en el arbol como DEPENDENCIA de D1b, pero su suite propia
 * (test_seq_guard.c) NO se ha integrado: depende de diana/calibration.h (A3/B5,
 * fuera de este gate) y recortarla obligaria a eliminar tambien su mutante M5,
 * es decir a mutilar el bloque que demuestra que sabe ponerse roja.
 *
 * Para no meter codigo con la etiqueta de "ya se probara despues", aqui se
 * ejerce EXACTAMENTE la superficie que provisioning.c invoca de verdad:
 *
 *     diana_seq_guard_set_init   ·  diana_prov_set_guards
 *     diana_seq_guard_reprovision (sobre las 9 combinaciones issuer x plane)
 *     diana_seq_guard_has_epoch
 *
 * NO se cubre aqui, y NO debe atribuirsele a MP0, el motor de ventana
 * deslizante — check, cache_result, max_seq, init_slot — que D1b no ejecuta y
 * que pertenece al filtrado por plano de A3/B5:
 *
 *     SEQ_GUARD_FULL_ANTI_REPLAY = DEFERRED_TO_A3_B5
 * =========================================================================== */

/** UUID textual -> 16 bytes, para poder comparar QUE epoch quedo, no solo que
 *  haya uno. Sin esto la prueba diria "tiene epoch" y pasaria aunque hubiera
 *  quedado el epoch ANTERIOR, que es justo el fallo que importa. */
static bool uuid_bytes_local(const char *u, uint8_t out[16])
{
    size_t n = 0;
    for (const char *p = u; *p && n < 16; ++p) {
        if (*p == '-') continue;
        int hi = (*p >= '0' && *p <= '9') ? *p - '0'
               : (*p >= 'a' && *p <= 'f') ? *p - 'a' + 10 : -1;
        ++p;
        if (!*p) return false;
        int lo = (*p >= '0' && *p <= '9') ? *p - '0'
               : (*p >= 'a' && *p <= 'f') ? *p - 'a' + 10 : -1;
        if (hi < 0 || lo < 0) return false;
        out[n++] = (uint8_t)((hi << 4) | lo);
    }
    return n == 16;
}

static int guards_con_epoch(const diana_seq_guard_set *g)
{
    int n = 0;
    for (int i = 0; i < SEQ_GUARD_ISSUER_COUNT; ++i)
        for (int p = 0; p < SEQ_GUARD_PLANE_COUNT; ++p)
            if (diana_seq_guard_has_epoch(&g->entry[i][p])) ++n;
    return n;
}

static int guards_con_epoch_igual_a(const diana_seq_guard_set *g, const uint8_t e[16])
{
    int n = 0;
    for (int i = 0; i < SEQ_GUARD_ISSUER_COUNT; ++i)
        for (int p = 0; p < SEQ_GUARD_PLANE_COUNT; ++p)
            if (memcmp(g->entry[i][p].state.epoch, e, 16) == 0) ++n;
    return n;
}

static void test_seq_guard_d1b_used_paths(void)
{
    const int TODAS = SEQ_GUARD_ISSUER_COUNT * SEQ_GUARD_PLANE_COUNT;

    SECTION("SEQ_GUARD_D1B_USED_PATHS: reprovision cambia el epoch y limpia la ventana");
    {
        fixture f; fixture_init(&f);
        diana_seq_guard g;
        diana_seq_guard_init(&g, &f.hal);
        CHECK(!diana_seq_guard_has_epoch(&g), "recien iniciada no tiene epoch");

        uint8_t e1[16]; memset(e1, 0xA1, sizeof(e1));
        diana_seq_guard_reprovision(&g, e1);
        CHECK(diana_seq_guard_has_epoch(&g), "tras reprovision tiene epoch");
        CHECK(memcmp(g.state.epoch, e1, 16) == 0, "el epoch es EL QUE SE PASO");

        /* La ventana se puebla A MANO antes de reprovisionar. Sin esto la
         * comprobacion siguiente seria decorativa: una guarda recien creada ya
         * tiene max_seq=0, asi que pasaria aunque reprovision no limpiara nada.
         * Se detecto porque la mutacion que quita la limpieza NO se ponia roja. */
        g.state.max_seq = 4242;
        g.state.has_seq = true;
        memset(g.state.bitmap, 0xFF, sizeof(g.state.bitmap));
        CHECK_EQ_INT((int)diana_seq_guard_max_seq(&g), 4242, "la ventana queda poblada antes de reprovisionar");

        uint8_t e2[16]; memset(e2, 0xB2, sizeof(e2));
        diana_seq_guard_reprovision(&g, e2);
        CHECK(memcmp(g.state.epoch, e2, 16) == 0, "un segundo reprovision SUSTITUYE el epoch");
        CHECK_EQ_INT((int)diana_seq_guard_max_seq(&g), 0,
                     "reprovision limpia la ventana: no arrastra secuencias del epoch anterior");
        CHECK(!g.state.has_seq, "reprovision borra la marca de secuencia vista");
    }

    SECTION("SEQ_GUARD_D1B_USED_PATHS: COMMIT reprovisiona las nueve con el epoch NUEVO");
    {
        fixture f; diana_prov_outcome o; fixture_init(&f);
        static diana_seq_guard_set guards;
        diana_seq_guard_set_init(&guards, &f.hal);
        diana_prov_set_guards(&f.prov, &guards);
        CHECK_EQ_INT(guards_con_epoch(&guards), 0, "de fabrica ninguna guarda tiene epoch");

        run_order(&f, "provision_ok", &PV_DELEGS[0], false, &o);
        uint8_t tras_prov[16];
        CHECK(uuid_bytes_local(f.prov.st.active_epoch, tras_prov), "epoch activo legible tras PROVISION");
        CHECK_EQ_INT(guards_con_epoch_igual_a(&guards, tras_prov), TODAS,
                     "las nueve llevan EL epoch activo tras PROVISION, no uno cualquiera");

        run_order(&f, "prepare_ok", &PV_DELEGS[0], false, &o);
        run_order(&f, "commit_ok", &PV_DELEGS[0], false, &o);
        uint8_t tras_commit[16];
        CHECK(uuid_bytes_local(f.prov.st.active_epoch, tras_commit), "epoch activo legible tras COMMIT");
        CHECK(memcmp(tras_prov, tras_commit, 16) != 0,
              "COMMIT promueve un epoch DISTINTO del anterior (si no, la prueba siguiente no probaria nada)");
        CHECK_EQ_INT(guards_con_epoch_igual_a(&guards, tras_commit), TODAS,
                     "COMMIT reprovisiona las nueve con el epoch nuevo: ninguna se queda en el viejo");
        CHECK_EQ_INT(guards_con_epoch_igual_a(&guards, tras_prov), 0,
                     "ninguna guarda conserva el epoch anterior tras COMMIT");
    }
}


/* ===========================================================================
 * PASO 6 · GATE ADVERSARIAL DEL CAMINO DE ORDENES
 * ===========================================================================
 * Las secciones anteriores comprueban VEREDICTOS. Esta comprueba EFECTOS.
 *
 * La diferencia importa: cinco casos negativos pueden pasar sin que el runtime
 * ejecute absolutamente nada. Por eso van dos controles positivos delante -- si
 * una orden valida no produce efecto observable, los negativos no demuestran
 * nada y esta suite debe morir ahi.
 *
 * Efecto observable = escritura en NVS (hal.kv_writes) + estado persistido.
 *
 * PROPIEDAD: una orden DEVICE_MANAGEMENT valida produce EXACTAMENTE un efecto;
 * cualquier orden invalida o repetida produce CERO.
 * =========================================================================== */

/* Efecto medido de una orden.
 *
 * OJO a la distincion, que costo dos fallos descubrir: contar escrituras a NVS
 * es DEMASIADO GRUESO. Una delegacion que verifica es una credencial valida en
 * si misma y SUS efectos se persisten aunque la orden que la acompana termine
 * rechazada -- esta declarado en provisioning.c:689-693. Asi que una firma
 * invalida SI deja una escritura, y eso es correcto.
 *
 * El efecto de la ORDEN es otra cosa: epoch activo, secuencia consumida y
 * estado. Eso es lo que debe quedar en cero cuando la orden no vale. */
typedef struct {
    uint32_t escrituras;   /* incluye la adopcion de delegacion: NO es el criterio */
    bool     aplicada;
    char     epoch[DIANA_PROV_UUID_BUF];
    uint64_t secuencia;    /* last_provisioning_sequence: se consume solo si vale */
    uint8_t  estado;
} efecto;

static efecto medir(fixture *f, const char *orden, const pv_delegation *deleg,
                    bool retenida)
{
    efecto e;
    uint32_t antes = f->hctx.kv_writes;
    diana_prov_outcome o;
    run_order(f, orden, deleg, retenida, &o);
    e.escrituras = f->hctx.kv_writes - antes;
    e.aplicada = o.applied;
    snprintf(e.epoch, sizeof(e.epoch), "%s", f->prov.st.active_epoch);
    e.secuencia = f->prov.st.last_provisioning_sequence;
    e.estado = f->prov.st.state;
    return e;
}

static void test_gate_adversarial_ordenes(void)
{
    SECTION("GATE ADVERSARIAL · CONTROL A: una orden valida SI produce efecto");
    {
        fixture f; fixture_init(&f);
        efecto e = medir(&f, "provision_ok", &PV_DELEGS[0], false);
        CHECK(e.aplicada, "CONTROL A: la orden valida se aplica");
        CHECK(e.escrituras >= 1, "CONTROL A: deja al menos una escritura en NVS");
        CHECK(e.epoch[0] != '\0', "CONTROL A: la autoridad queda con epoch activo");
        /* Sin este control, los cinco negativos de abajo pasarian aunque el
         * runtime no ejecutase nada en absoluto. */
    }

    SECTION("GATE ADVERSARIAL · CONTROL B: dos ordenes validas, dos efectos");
    {
        fixture f; diana_prov_outcome o; fixture_init(&f);
        efecto e1 = medir(&f, "provision_ok", &PV_DELEGS[0], false);
        run_order(&f, "prepare_ok", &PV_DELEGS[0], false, &o);
        efecto e2 = medir(&f, "commit_ok", &PV_DELEGS[0], false);
        CHECK(e1.aplicada && e2.aplicada, "CONTROL B: ambas ordenes se aplican");
        CHECK(e1.escrituras >= 1 && e2.escrituras >= 1,
              "CONTROL B: cada una deja su propia escritura");
        CHECK(strcmp(e1.epoch, e2.epoch) != 0,
              "CONTROL B: producen efectos DISTINTOS, no el mismo dos veces");
    }

    /* --- los seis negativos. Todos exigen CERO efectos. ------------------- */

    SECTION("GATE ADVERSARIAL · firma invalida -> 0 efectos");
    {
        /* No hay vector "bad_sig": se firma con la clave operativa 2, que ESTA
         * delegacion no autoriza. Misma tecnica que la seccion de firma
         * manipulada, pero midiendo EFECTO en vez de veredicto. */
        fixture f; diana_prov_outcome o; fixture_init(&f);
        const pv_order *v = order_named("provision_ok");
        diana_prov_command c;
        build_cmd(&c, v, &PV_DELEGS[0]);
        copy(c.signature, sizeof(c.signature), v->signature_op2);

        uint32_t antes = f.hctx.kv_writes;
        diana_prov_handle(&f.prov, &c, false, &o);
        uint32_t escrituras = f.hctx.kv_writes - antes;

        CHECK(!o.applied, "firma invalida: no se aplica");
        CHECK_EQ_STR(f.prov.st.active_epoch, "",
                     "firma invalida: CERO efecto de la orden (autoridad vacia)");
        CHECK_EQ_INT((int)f.prov.st.last_provisioning_sequence, 0,
                     "firma invalida: la secuencia NO se consume");
        CHECK(f.prov.st.state == DIANA_PROV_UNPROVISIONED,
              "firma invalida: el estado no avanza");
        /* La escritura que SI ocurre es la adopcion de la delegacion, que es una
         * credencial valida por si misma. Se comprueba explicitamente para que
         * quede documentado y no parezca un descuido. */
        CHECK_EQ_INT((int)escrituras, 1,
                     "la unica escritura es la adopcion de la delegacion, no la orden");
    }

    SECTION("GATE ADVERSARIAL · device_id ajeno -> 0 efectos");
    {
        fixture f; fixture_init(&f);
        efecto e = medir(&f, "provision_other_device", &PV_DELEGS[0], false);
        CHECK(!e.aplicada, "device ajeno: no se aplica");
        CHECK_EQ_STR(e.epoch, "", "device ajeno: CERO efecto de la orden");
        CHECK_EQ_INT((int)e.secuencia, 0, "device ajeno: la secuencia NO se consume");
    }

    SECTION("GATE ADVERSARIAL · retenido (replay del broker) -> 0 efectos");
    {
        fixture f; fixture_init(&f);
        efecto e = medir(&f, "provision_ok", &PV_DELEGS[0], true);
        CHECK(!e.aplicada, "retenido: no se aplica AUNQUE la firma sea valida");
        CHECK_EQ_STR(e.epoch, "", "retenido: CERO efecto de la orden");
        CHECK_EQ_INT((int)e.secuencia, 0, "retenido: la secuencia NO se consume");
    }

    SECTION("GATE ADVERSARIAL · replay de secuencia consumida -> 0 efectos ADICIONALES");
    {
        fixture f; fixture_init(&f);
        efecto primera = medir(&f, "provision_ok", &PV_DELEGS[0], false);
        CHECK(primera.escrituras >= 1, "la primera SI tiene efecto (control interno)");
        efecto repetida = medir(&f, "provision_ok", &PV_DELEGS[0], false);
        CHECK(!repetida.aplicada, "replay: no se aplica");
        CHECK_EQ_STR(repetida.epoch, primera.epoch,
                     "replay: CERO efecto de la orden (la autoridad no cambia)");
        CHECK(repetida.secuencia == primera.secuencia,
              "replay: la secuencia NO avanza por segunda vez");
        CHECK(repetida.estado == primera.estado, "replay: el estado no cambia");
    }

    SECTION("GATE ADVERSARIAL · huella de raiz ajena -> 0 efectos");
    {
        fixture f; fixture_init(&f);
        efecto e = medir(&f, "provision_bad_fp", &PV_DELEGS[0], false);
        CHECK(!e.aplicada, "raiz ajena: no se aplica");
        CHECK_EQ_STR(e.epoch, "", "raiz ajena: CERO efecto de la orden");
        CHECK_EQ_INT((int)e.secuencia, 0, "raiz ajena: la secuencia NO se consume");
    }

    SECTION("GATE ADVERSARIAL · sin root_key -> FALLO CERRADO, 0 efectos");
    {
        /* Fixture SIN diana_prov_set_root_key: es el estado real de un modulo
         * que no ha pasado por el utillaje de fabrica, que todavia no existe. */
        fixture f;
        host_persistent_reset(&f.nv, 16);
        host_hal_init(&f.hctx, &f.nv, &f.hal, 7);
        diana_prov_init(&f.prov, &f.hal, PV_DEVICE_ID, PV_SYSTEM_ID, PV_FINGERPRINT);

        efecto e = medir(&f, "provision_ok", &PV_DELEGS[0], false);
        CHECK(!e.aplicada, "sin root_key: no se aplica NI CON firma valida");
        CHECK_EQ_INT((int)e.secuencia, 0, "sin root_key: la secuencia NO se consume");
        CHECK_EQ_STR(e.epoch, "", "sin root_key: la autoridad sigue vacia");
        CHECK(f.prov.st.state == DIANA_PROV_UNPROVISIONED,
              "sin root_key: queda SIN APROVISIONAR, que es fallar cerrado");
    }
}

int run_provisioning(void)
{
    TEST_SUITE("provisioning");
    test_gate_adversarial_ordenes();
    test_seq_guard_d1b_used_paths();
    int before = g_tests_failed;

    test_base64url();
    test_canonical();
    test_p256();
    test_state_machine();
    test_persistence();
    test_guards();
    test_response_json();
    test_vocabulary();

    return g_tests_failed - before;
}
