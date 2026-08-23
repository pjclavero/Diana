/**
 * @file provisioning.c
 * @brief Protocolo D1b v1.7.1 en el dispositivo. Ver diana/provisioning.h.
 */
#include "diana/provisioning.h"

#include <string.h>

#include "diana/base64url.h"
#include "diana/json.h"
#include "diana/sha256.h"

/* ------------------------------------------------ nombres de contrato ----- */

static const char *const STATE_STR[] = {
    "UNPROVISIONED", "READY", "PREPARED", "STALE", "QUARANTINED"};

static const char *const RESULT_STR[] = {
    "PROVISIONED", "PREPARED", "COMMITTED",
    "AUTHORITY_UNPROVISIONED", "AUTHORITY_STALE", "REJECTED"};

static const char *const REASON_STR[] = {
    "invalid_signature",
    "signature_algorithm_rejected",
    "provisioning_key_mismatch",
    "provisioning_sequence_rejected",
    "rotation_id_replayed",
    "rotation_id_unknown",
    "current_epoch_mismatch",
    "epoch_not_provisioned",
    "epoch_reuse_rejected",
    "already_provisioned",
    "retained_provisioning_rejected",
    "device_mismatch",
    "system_mismatch",
    "malformed_provisioning_message",
    "delegation_missing",
    "delegation_invalid_signature",
    "delegation_root_key_mismatch",
    "delegation_sequence_rejected",
    "delegation_sequence_conflict",
    "delegation_version_rejected"};

static const char *const ACTION_STR[] = {"PROVISION", "PREPARE", "COMMIT"};
static const char *const MODE_STR[] = {"", "NORMAL", "EMERGENCY"};

const char *diana_prov_state_str(diana_prov_state s)
{
    return (unsigned)s < 5u ? STATE_STR[s] : "?";
}
const char *diana_prov_result_str(diana_prov_result r)
{
    return (unsigned)r < 6u ? RESULT_STR[r] : "?";
}
const char *diana_prov_reason_str(diana_prov_reason r)
{
    return (r >= 0 && (unsigned)r < 20u) ? REASON_STR[r] : NULL;
}
const char *diana_prov_action_str(diana_prov_action a)
{
    return (unsigned)a < 3u ? ACTION_STR[a] : "?";
}
const char *diana_prov_mode_str(diana_prov_mode m)
{
    return (unsigned)m < 3u ? MODE_STR[m] : "";
}

/* ------------------------------------------------------------ utilidades -- */

static bool str_eq(const char *a, const char *b)
{
    return a != NULL && b != NULL && strcmp(a, b) == 0;
}

static bool is_set(const char *s) { return s != NULL && s[0] != '\0'; }

static void str_copy(char *dst, size_t cap, const char *src)
{
    if (src == NULL) { dst[0] = '\0'; return; }
    size_t n = strlen(src);
    if (n >= cap) n = cap - 1u;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

/** UUID canonico 8-4-4-4-12. Se comprueba porque el epoch se usa despues como
 *  16 bytes binarios para la barrera antirrepeticion. */
static bool is_uuid(const char *s)
{
    if (!is_set(s)) return false;
    if (strlen(s) != (size_t)DIANA_PROV_UUID_LEN) return false;
    static const int dashes[4] = {8, 13, 18, 23};
    for (size_t i = 0; i < 36u; ++i) {
        bool is_dash = false;
        for (int d = 0; d < 4; ++d) {
            if ((int)i == dashes[d]) is_dash = true;
        }
        char c = s[i];
        if (is_dash) {
            if (c != '-') return false;
        } else {
            bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
                       (c >= 'A' && c <= 'F');
            if (!hex) return false;
        }
    }
    return true;
}

static int hexval(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/** UUID textual -> 16 bytes, que es la forma que consume diana_seq_guard. */
static bool uuid_to_bytes(const char *s, uint8_t out[16])
{
    if (!is_uuid(s)) return false;
    size_t o = 0;
    for (size_t i = 0; i < 36u; ++i) {
        if (s[i] == '-') continue;
        int hi = hexval(s[i]);
        int lo = hexval(s[i + 1]);
        if (hi < 0 || lo < 0) return false;
        out[o++] = (uint8_t)((hi << 4) | lo);
        ++i;
    }
    return o == 16u;
}

static void trace_push(diana_prov_outcome *out, const char *step)
{
    if (out->trace_len < DIANA_PROV_TRACE_MAX) out->trace[out->trace_len++] = step;
}

/* ---------------------------------------------------------- persistencia -- */

void diana_prov_factory_state(diana_prov_persist *st, const char *fingerprint_hex)
{
    memset(st, 0, sizeof(*st));
    st->state = (uint8_t)DIANA_PROV_UNPROVISIONED;
    st->pending_mode = (uint8_t)DIANA_PROV_MODE_NONE;
    str_copy(st->provisioning_key_fingerprint,
             sizeof(st->provisioning_key_fingerprint), fingerprint_hex);
}

bool diana_prov_load(diana_prov_ctx *ctx)
{
    if (ctx->hal == NULL || ctx->hal->kv_get == NULL) return false;
    diana_prov_persist tmp;
    size_t len = sizeof(tmp);
    int rc = ctx->hal->kv_get(ctx->hal->ctx, DIANA_PROV_NVS_NS, DIANA_PROV_NVS_KEY,
                              &tmp, sizeof(tmp), &len);
    /* Un blob de tamano distinto es de OTRA version del layout: no se
     * reinterpreta ni se "migra a ojo". Se ignora y el dispositivo arranca sin
     * autoridad, que es el fallo cerrado correcto — mejor sin provisionar que
     * con una autoridad leida de bytes que significan otra cosa. */
    if (rc != DIANA_HAL_OK || len != sizeof(tmp)) return false;
    if (tmp.state > (uint8_t)DIANA_PROV_QUARANTINED) return false;
    ctx->st = tmp;
    return true;
}

bool diana_prov_save(const diana_prov_ctx *ctx)
{
    if (ctx->hal == NULL || ctx->hal->kv_set == NULL) return false;
    return ctx->hal->kv_set(ctx->hal->ctx, DIANA_PROV_NVS_NS, DIANA_PROV_NVS_KEY,
                            &ctx->st, sizeof(ctx->st)) == DIANA_HAL_OK;
}

void diana_prov_init(diana_prov_ctx *ctx, const diana_hal *hal,
                     const char *device_id, const char *system_id,
                     const char *fingerprint_hex)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->hal = hal;
    str_copy(ctx->device_id, sizeof(ctx->device_id), device_id);
    str_copy(ctx->system_id, sizeof(ctx->system_id), system_id);
    diana_prov_factory_state(&ctx->st, fingerprint_hex);
    (void)diana_prov_load(ctx);
}

void diana_prov_set_root_key(diana_prov_ctx *ctx,
                             const uint8_t root_key[DIANA_P256_PUBKEY_LEN],
                             const char *root_key_id)
{
    if (root_key == NULL) {
        ctx->has_root_key = false;
        memset(ctx->root_key, 0, sizeof(ctx->root_key));
    } else {
        memcpy(ctx->root_key, root_key, DIANA_P256_PUBKEY_LEN);
        ctx->has_root_key = true;
    }
    str_copy(ctx->root_key_id, sizeof(ctx->root_key_id), root_key_id);
}

void diana_prov_set_guards(diana_prov_ctx *ctx, diana_seq_guard_set *guards)
{
    ctx->guards = guards;
}

bool diana_prov_accepts_game(const diana_prov_ctx *ctx)
{
    return ctx->st.state == (uint8_t)DIANA_PROV_READY ||
           ctx->st.state == (uint8_t)DIANA_PROV_PREPARED;
}

/**
 * Propaga el cambio de autoridad a las guardas antirrepeticion por plano.
 * El epoch de 128 bits de diana_seq_guard son EXACTAMENTE los 16 bytes del
 * UUID del epoch de aprovisionamiento: una sola identidad de sesion, no dos.
 */
static void reprovision_guards(diana_prov_ctx *ctx, const char *epoch_uuid)
{
    if (ctx->guards == NULL) return;
    uint8_t bytes[16];
    if (!uuid_to_bytes(epoch_uuid, bytes)) return;
    for (int issuer = 0; issuer < SEQ_GUARD_ISSUER_COUNT; ++issuer) {
        for (int plane = 0; plane < SEQ_GUARD_PLANE_COUNT; ++plane) {
            diana_seq_guard_reprovision(&ctx->guards->entry[issuer][plane], bytes);
        }
    }
}

/* --------------------------------------------------------- resultados ----- */

static void outcome_reset(diana_prov_outcome *out)
{
    memset(out, 0, sizeof(*out));
    out->reason = DIANA_PROV_REASON_NONE;
}

static void set_reject(diana_prov_ctx *ctx, diana_prov_outcome *out,
                       diana_prov_reason reason)
{
    out->publish = true;
    out->applied = false;
    out->result = DIANA_PROV_RESULT_REJECTED;
    out->reason = reason;
    out->state = (diana_prov_state)ctx->st.state;
}

static void set_applied(diana_prov_ctx *ctx, diana_prov_outcome *out,
                        diana_prov_result result)
{
    out->publish = true;
    out->applied = true;
    out->result = result;
    out->reason = DIANA_PROV_REASON_NONE;
    out->state = (diana_prov_state)ctx->st.state;
}

/* ------------------------------------------- conformidad estructural ------ */

/**
 * Paso 1 del orden de verificacion: el mensaje CONFORMA o no conforma. No hay
 * ninguna rama "si faltan epoch o sequence, aceptar como comando antiguo": la
 * ausencia de un campo obligatorio es malformed_provisioning_message y punto.
 */
static bool conforms(const diana_prov_command *c)
{
    if (!c->has_schema_version_1) return false;
    if (!c->has_command_plane_device_management) return false;
    if (!c->has_provisioning_sequence) return false;
    if (!c->has_issued_at_ms) return false;
    if (!is_set(c->device_id) || !is_set(c->system_id)) return false;
    if (strlen(c->provisioning_key_fingerprint) != 64u) return false;
    if (!is_set(c->signature_alg) || !is_set(c->signature)) return false;
    if ((unsigned)c->action > (unsigned)DIANA_PROV_ACTION_COMMIT) return false;

    /* Presencia POR ACCION, la misma que imponen los if/then del esquema. Un
     * campo presente donde el esquema lo prohibe tambien es no conforme: si se
     * admitiese, la cadena canonica firmaria un registro que el emisor no
     * habria puesto. */
    switch (c->action) {
    case DIANA_PROV_ACTION_PROVISION:
        if (!is_uuid(c->epoch) || !is_uuid(c->provision_id)) return false;
        if (is_set(c->rotation_id) || is_set(c->current_epoch) ||
            is_set(c->next_epoch) || c->mode != DIANA_PROV_MODE_NONE) return false;
        if (!c->has_delegation) return false;   /* el bootstrap la exige */
        break;
    case DIANA_PROV_ACTION_PREPARE:
        if (!is_uuid(c->rotation_id) || !is_uuid(c->current_epoch) ||
            !is_uuid(c->next_epoch)) return false;
        if (c->mode == DIANA_PROV_MODE_NONE) return false;
        if (is_set(c->epoch) || is_set(c->provision_id)) return false;
        break;
    case DIANA_PROV_ACTION_COMMIT:
        if (!is_uuid(c->rotation_id)) return false;
        if (c->mode == DIANA_PROV_MODE_NONE) return false;
        if (is_set(c->epoch) || is_set(c->current_epoch) ||
            is_set(c->next_epoch) || is_set(c->provision_id)) return false;
        break;
    default:
        return false;
    }

    if (c->has_delegation) {
        const diana_prov_delegation *d = &c->delegation;
        if (!is_uuid(d->delegation_id)) return false;
        if (!is_set(d->root_key_id) || !is_set(d->operational_key_id)) return false;
        if (!is_set(d->operational_public_key) || !is_set(d->system_id)) return false;
        if (!is_set(d->signature_alg) || !is_set(d->root_signature)) return false;
        /* scope esta fijado por const en el esquema: un valor distinto hace el
         * mensaje NO CONFORME. Por eso el motivo delegation_scope_rejected fue
         * RETIRADO en la v1.7.1 y aqui la comprobacion vive con las de forma. */
        if (!str_eq(d->scope, DIANA_PROV_DELEGATION_SCOPE)) return false;
    }
    return true;
}

/* -------------------------------------------------------- delegacion ------ */

typedef struct {
    bool     ok;
    uint8_t  operational_key[DIANA_P256_PUBKEY_LEN];
    /* Borrador de estado: se aplica solo si el llamante decide persistirlo. */
    uint64_t next_delegation_sequence;
    uint8_t  next_fingerprint[32];
    bool     next_has_key;
    uint8_t  next_key[DIANA_P256_PUBKEY_LEN];
    bool     next_has_fingerprint;
    bool     dirty;                  /* la delegacion cambia el estado persistido */
} deleg_result;

/**
 * Pasos 4-7 del orden criptografico: verificar la credencial contra la raiz
 * FIJADA y obtener de ella la clave operativa autorizada. Se resuelve ANTES de
 * mirar la firma de la orden: obtener la clave autorizada es prerrequisito de
 * verificar la orden, no una comprobacion paralela.
 */
static bool resolve_operational_key(diana_prov_ctx *ctx, const diana_prov_command *c,
                                    diana_prov_outcome *out, deleg_result *res)
{
    memset(res, 0, sizeof(*res));
    res->next_delegation_sequence = ctx->st.last_delegation_sequence;
    res->next_has_key = ctx->st.has_operational_key;
    memcpy(res->next_key, ctx->st.operational_key, sizeof(res->next_key));
    res->next_has_fingerprint = ctx->st.has_delegation_fingerprint;
    memcpy(res->next_fingerprint, ctx->st.delegation_fingerprint,
           sizeof(res->next_fingerprint));

    if (!c->has_delegation) {
        trace_push(out, "delegation-presence-check");
        if (!ctx->st.has_operational_key) {
            set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_MISSING);
            return false;
        }
        /* Sin credencial nueva se sigue confiando en la clave YA aceptada. */
        memcpy(res->operational_key, ctx->st.operational_key,
               sizeof(res->operational_key));
        res->ok = true;
        return true;
    }

    const diana_prov_delegation *d = &c->delegation;

    /* (a) Diagnostico OPCIONAL de fabrica. El dispositivo NO selecciona la raiz
     * por root_key_id: verifica siempre contra la unica que tiene fijada. */
    if (is_set(ctx->root_key_id)) {
        trace_push(out, "delegation-root-key-id-check");
        if (!str_eq(d->root_key_id, ctx->root_key_id)) {
            set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_ROOT_KEY_MISMATCH);
            return false;
        }
    }

    /* (4) root_signature contra la raiz FIJADA, nunca contra una clave que
     * venga en el propio mensaje. */
    trace_push(out, "delegation-signature");
    if (!ctx->has_root_key) {
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_INVALID_SIGNATURE);
        return false;
    }
    /* El algoritmo de la credencial tampoco se negocia. */
    if (!str_eq(d->signature_alg, DIANA_PROV_SIGNATURE_ALG)) {
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_INVALID_SIGNATURE);
        return false;
    }
    uint8_t sig[DIANA_P256_SIG_LEN];
    size_t sig_len = sizeof(sig);
    if (!diana_base64url_decode(d->root_signature, sig, &sig_len) ||
        sig_len != (size_t)DIANA_P256_SIG_LEN) {
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_INVALID_SIGNATURE);
        return false;
    }
    uint8_t canon[DIANA_PROV_CANON_MAX];
    size_t canon_len = diana_prov_delegation_canonical(d, canon, sizeof(canon));
    if (canon_len == 0 ||
        !diana_p256_verify_message(ctx->root_key, canon, canon_len, sig)) {
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_INVALID_SIGNATURE);
        return false;
    }

    /* system_mismatch cubre a la vez la orden y la credencial que la acompana. */
    trace_push(out, "delegation-system-check");
    if (!str_eq(d->system_id, ctx->system_id)) {
        set_reject(ctx, out, DIANA_PROV_REASON_SYSTEM_MISMATCH);
        return false;
    }

    trace_push(out, "delegation-version-check");
    if (d->delegation_version != (uint64_t)DIANA_PROV_DELEGATION_VERSION) {
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_VERSION_REJECTED);
        return false;
    }

    /* (6) delegation_sequence — regla EXACTA del contrato v1.7.1:
     *   MENOR                              -> rechazo (replay).
     *   IGUAL y mismo fingerprint          -> REAFIRMACION idempotente, cero
     *                                         cambio de autoridad.
     *   IGUAL y fingerprint DISTINTO       -> delegation_sequence_conflict.
     *   MAYOR                              -> delegacion nueva. */
    trace_push(out, "delegation-sequence-check");
    uint8_t fp[32];
    diana_prov_delegation_fingerprint(d, fp);

    if (d->delegation_sequence < ctx->st.last_delegation_sequence) {
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_SEQUENCE_REJECTED);
        return false;
    }

    if (d->delegation_sequence == ctx->st.last_delegation_sequence) {
        if (ctx->st.has_delegation_fingerprint && ctx->st.has_operational_key &&
            memcmp(fp, ctx->st.delegation_fingerprint, sizeof(fp)) == 0) {
            /* REAFIRMACION: misma secuencia, misma delegacion. Se sigue con la
             * clave YA persistida y no se toca nada del estado. */
            trace_push(out, "delegation-reaffirmed");
            memcpy(res->operational_key, ctx->st.operational_key,
                   sizeof(res->operational_key));
            res->ok = true;
            return true;
        }
        /* La MISMA secuencia autorizando contenido DISTINTO es exactamente la
         * confusion que la barrera existe para impedir. Tambien se rechaza si
         * no hay fingerprint persistido contra el que reafirmar: fallo cerrado. */
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_SEQUENCE_CONFLICT);
        return false;
    }

    /* (7) Solo AHORA, tras los seis pasos anteriores, se confia en el valor que
     * trae el mensaje. */
    trace_push(out, "operational-key-extraction");
    uint8_t key[DIANA_P256_PUBKEY_LEN];
    if (!diana_prov_decode_pubkey(d->operational_public_key, key)) {
        set_reject(ctx, out, DIANA_PROV_REASON_DELEGATION_INVALID_SIGNATURE);
        return false;
    }

    memcpy(res->operational_key, key, sizeof(key));
    res->next_delegation_sequence = d->delegation_sequence;
    memcpy(res->next_key, key, sizeof(key));
    res->next_has_key = true;
    memcpy(res->next_fingerprint, fp, sizeof(fp));
    res->next_has_fingerprint = true;
    res->dirty = true;
    res->ok = true;
    return true;
}

/** Adopta en el estado persistido el borrador que dejo la delegacion. */
static void adopt_delegation(diana_prov_ctx *ctx, const deleg_result *res)
{
    if (!res->dirty) return;
    ctx->st.last_delegation_sequence = res->next_delegation_sequence;
    memcpy(ctx->st.operational_key, res->next_key, sizeof(ctx->st.operational_key));
    ctx->st.has_operational_key = res->next_has_key;
    memcpy(ctx->st.delegation_fingerprint, res->next_fingerprint,
           sizeof(ctx->st.delegation_fingerprint));
    ctx->st.has_delegation_fingerprint = res->next_has_fingerprint;
}

/* ----------------------------------------------- maquina de estados ------- */

static void apply_provision(diana_prov_ctx *ctx, const diana_prov_command *c,
                            diana_prov_outcome *out)
{
    /* already_provisioned SI Y SOLO SI el dispositivo esta en READY o PREPARED.
     * En STALE y en QUARANTINED un PROVISION verificado SUSTITUYE active_epoch:
     * es la unica salida de la cuarentena. */
    if (ctx->st.state == (uint8_t)DIANA_PROV_READY ||
        ctx->st.state == (uint8_t)DIANA_PROV_PREPARED) {
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_ALREADY_PROVISIONED);
        return;
    }

    str_copy(ctx->st.active_epoch, sizeof(ctx->st.active_epoch), c->epoch);
    ctx->st.pending_epoch[0] = '\0';
    ctx->st.last_rotation_id[0] = '\0';
    ctx->st.pending_mode = (uint8_t)DIANA_PROV_MODE_NONE;
    ctx->st.state = (uint8_t)DIANA_PROV_READY;
    (void)diana_prov_save(ctx);
    ctx->applied_bootstraps++;

    reprovision_guards(ctx, c->epoch);
    set_applied(ctx, out, DIANA_PROV_RESULT_PROVISIONED);
    out->authority_changed = true;
    str_copy(out->new_active_epoch, sizeof(out->new_active_epoch), c->epoch);
}

static void apply_prepare(diana_prov_ctx *ctx, const diana_prov_command *c,
                          diana_prov_outcome *out)
{
    if (ctx->st.state == (uint8_t)DIANA_PROV_UNPROVISIONED ||
        ctx->st.state == (uint8_t)DIANA_PROV_STALE ||
        ctx->st.state == (uint8_t)DIANA_PROV_QUARANTINED) {
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_EPOCH_NOT_PROVISIONED);
        return;
    }

    /* Rotacion ya TERMINADA que se reintenta. state == PREPARED distingue "en
     * curso" de "terminada" sin necesidad de guardar lista alguna. */
    if (str_eq(ctx->st.last_rotation_id, c->rotation_id) &&
        ctx->st.state != (uint8_t)DIANA_PROV_PREPARED) {
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_ROTATION_ID_REPLAYED);
        return;
    }

    if (!str_eq(c->current_epoch, ctx->st.active_epoch)) {
        /* Prueba FIRMADA de que el servidor cree vigente otra autoridad: este
         * dispositivo se perdio una rotacion. Se rechaza igual (el contrato lo
         * exige) y ademas deja de aceptar GAME hasta reprovisionarse. */
        ctx->st.state = (uint8_t)DIANA_PROV_STALE;
        ctx->st.pending_epoch[0] = '\0';
        ctx->st.pending_mode = (uint8_t)DIANA_PROV_MODE_NONE;
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_CURRENT_EPOCH_MISMATCH);
        return;
    }

    /* Un epoch NUNCA se reutiliza, ni para volver a una configuracion identica. */
    if (str_eq(c->next_epoch, ctx->st.active_epoch)) {
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_EPOCH_REUSE_REJECTED);
        return;
    }

    str_copy(ctx->st.pending_epoch, sizeof(ctx->st.pending_epoch), c->next_epoch);
    str_copy(ctx->st.last_rotation_id, sizeof(ctx->st.last_rotation_id), c->rotation_id);
    ctx->st.pending_mode = (uint8_t)c->mode;
    ctx->st.state = (uint8_t)DIANA_PROV_PREPARED;
    (void)diana_prov_save(ctx);

    set_applied(ctx, out, DIANA_PROV_RESULT_PREPARED);
}

static void apply_commit(diana_prov_ctx *ctx, const diana_prov_command *c,
                         diana_prov_outcome *out)
{
    if (str_eq(ctx->st.last_rotation_id, c->rotation_id) &&
        ctx->st.state != (uint8_t)DIANA_PROV_PREPARED) {
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_ROTATION_ID_REPLAYED);
        return;
    }

    if (ctx->st.state != (uint8_t)DIANA_PROV_PREPARED ||
        !str_eq(ctx->st.last_rotation_id, c->rotation_id) ||
        !is_set(ctx->st.pending_epoch)) {
        /* COMMIT de una rotacion que este dispositivo nunca preparo: firmado y
         * fresco, luego se perdio la fase 1. `mode` viaja FIRMADO y se aplica
         * LITERALMENTE, sin reinterpretarse. */
        if (ctx->st.state == (uint8_t)DIANA_PROV_READY ||
            ctx->st.state == (uint8_t)DIANA_PROV_PREPARED) {
            ctx->st.state = (c->mode == DIANA_PROV_MODE_EMERGENCY)
                                ? (uint8_t)DIANA_PROV_QUARANTINED
                                : (uint8_t)DIANA_PROV_STALE;
            ctx->st.pending_epoch[0] = '\0';
            ctx->st.pending_mode = (uint8_t)DIANA_PROV_MODE_NONE;
        }
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_ROTATION_ID_UNKNOWN);
        return;
    }

    /* Cambio ATOMICO: una sola escritura deja las dos mitades hechas. No existe
     * un instante persistido con B activa y B todavia pendiente. */
    char activated[DIANA_PROV_UUID_BUF];
    str_copy(activated, sizeof(activated), ctx->st.pending_epoch);
    str_copy(ctx->st.active_epoch, sizeof(ctx->st.active_epoch), activated);
    ctx->st.pending_epoch[0] = '\0';
    ctx->st.pending_mode = (uint8_t)DIANA_PROV_MODE_NONE;
    ctx->st.state = (uint8_t)DIANA_PROV_READY;
    /* last_rotation_id se CONSERVA: es lo que hace que un COMMIT repetido caiga
     * en rotation_id_replayed sin guardar ninguna lista. */
    (void)diana_prov_save(ctx);

    reprovision_guards(ctx, activated);
    set_applied(ctx, out, DIANA_PROV_RESULT_COMMITTED);
    out->authority_changed = true;
    str_copy(out->new_active_epoch, sizeof(out->new_active_epoch), activated);
}

/* ------------------------------------------------------------- handle ----- */

void diana_prov_handle(diana_prov_ctx *ctx, const diana_prov_command *cmd,
                       bool retained, diana_prov_outcome *out)
{
    outcome_reset(out);
    out->state = (diana_prov_state)ctx->st.state;

    if (cmd == NULL) {
        ctx->undeliverable_rejections++;
        out->reason = DIANA_PROV_REASON_MALFORMED_PROVISIONING_MESSAGE;
        return;
    }

    /* Sin un request_id utilizable no existe respuesta REJECTED valida contra
     * el esquema (lo exige). Se descarta de forma controlada y se cuenta. */
    if (!cmd->has_request_id || !is_uuid(cmd->request_id)) {
        ctx->undeliverable_rejections++;
        trace_push(out, "request-id-missing");
        out->publish = false;
        out->reason = DIANA_PROV_REASON_MALFORMED_PROVISIONING_MESSAGE;
        return;
    }

    /* (1) RETENIDO, ANTES QUE NADA. Un PROVISION/PREPARE/COMMIT retenido es un
     * replay servido por el propio broker. Se comprueba antes de la firma y de
     * la secuencia a proposito: un retenido criptograficamente valido y con
     * secuencia buena tiene que morir POR RETENIDO, no por otra defensa, o el
     * dia que la firma cambie el agujero se abre sin que falle ninguna prueba. */
    trace_push(out, "retained-check");
    if (retained) {
        set_reject(ctx, out, DIANA_PROV_REASON_RETAINED_PROVISIONING_REJECTED);
        return;
    }

    /* (2) Conformidad de forma. Sin modo heredado. */
    trace_push(out, "schema-conformance");
    if (!conforms(cmd)) {
        set_reject(ctx, out, DIANA_PROV_REASON_MALFORMED_PROVISIONING_MESSAGE);
        return;
    }

    /* (3) Es para ESTE dispositivo y ESTE sistema? Una orden firmada para otro
     * modulo no es una orden para este, aunque la firma verifique. */
    trace_push(out, "addressing-check");
    if (!str_eq(cmd->device_id, ctx->device_id)) {
        set_reject(ctx, out, DIANA_PROV_REASON_DEVICE_MISMATCH);
        return;
    }
    if (!str_eq(cmd->system_id, ctx->system_id)) {
        set_reject(ctx, out, DIANA_PROV_REASON_SYSTEM_MISMATCH);
        return;
    }

    /* (4) El algoritmo NO se negocia: se compara contra la unica constante
     * admitida. Este literal NO selecciona verificador — el verificador es
     * siempre diana_p256_*, fijo en el codigo. */
    trace_push(out, "signature-algorithm-check");
    if (!str_eq(cmd->signature_alg, DIANA_PROV_SIGNATURE_ALG)) {
        set_reject(ctx, out, DIANA_PROV_REASON_SIGNATURE_ALGORITHM_REJECTED);
        return;
    }

    /* (5) Raiz de aprovisionamiento CONOCIDA: diagnostico honesto ("firmado
     * bajo otra raiz") separado de "firma corrupta". */
    trace_push(out, "root-fingerprint-check");
    if (!str_eq(cmd->provisioning_key_fingerprint,
                ctx->st.provisioning_key_fingerprint)) {
        set_reject(ctx, out, DIANA_PROV_REASON_PROVISIONING_KEY_MISMATCH);
        return;
    }

    /* (6) Delegacion raiz -> operativa, ANTES de la firma de la orden. */
    deleg_result deleg;
    if (!resolve_operational_key(ctx, cmd, out, &deleg)) return;

    /* (7) Firma de la ORDEN sobre la CADENA CANONICA, verificada con la clave
     * OPERATIVA ya autorizada por la delegacion — nunca con la raiz
     * directamente, y nunca con una clave que "diga confiar en mi". */
    trace_push(out, "order-signature");
    uint8_t canon[DIANA_PROV_CANON_MAX];
    size_t canon_len = diana_prov_canonical(cmd, canon, sizeof(canon));
    uint8_t sig[DIANA_P256_SIG_LEN];
    size_t sig_len = sizeof(sig);
    bool sig_ok = canon_len != 0 &&
                  diana_base64url_decode(cmd->signature, sig, &sig_len) &&
                  sig_len == (size_t)DIANA_P256_SIG_LEN &&
                  diana_p256_verify_message(deleg.operational_key, canon, canon_len, sig);
    if (!sig_ok) {
        /* La delegacion, si llego y verifico, es una credencial valida en si
         * misma: sus efectos SI se persisten aunque la orden que la acompana
         * termine rechazada. Decision declarada, igual que en el simulador. */
        adopt_delegation(ctx, &deleg);
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_INVALID_SIGNATURE);
        return;
    }

    adopt_delegation(ctx, &deleg);

    /* (8) Barrera antirrepeticion del propio canal. Una sola secuencia
     * monotonica persistente basta para los cinco ataques: PREPARE antiguo,
     * COMMIT antiguo, rotacion repetida, retenido viejo y duplicado de QoS 1. */
    trace_push(out, "provisioning-sequence-check");
    if (cmd->provisioning_sequence <= ctx->st.last_provisioning_sequence) {
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_PROVISIONING_SEQUENCE_REJECTED);
        return;
    }

    /* A partir de aqui el mensaje esta AUTENTICADO y es fresco: se consume
     * exactamente una vez. El contador avanza aunque el resultado sea un
     * rechazo por estado, y por eso la respuesta publica siempre
     * last_provisioning_sequence. */
    ctx->st.last_provisioning_sequence = cmd->provisioning_sequence;

    /* (9) Estado del dominio, persistencia y efecto/respuesta. */
    trace_push(out, "domain-state-machine");
    switch (cmd->action) {
    case DIANA_PROV_ACTION_PROVISION: apply_provision(ctx, cmd, out); break;
    case DIANA_PROV_ACTION_PREPARE:   apply_prepare(ctx, cmd, out);   break;
    case DIANA_PROV_ACTION_COMMIT:    apply_commit(ctx, cmd, out);    break;
    default:
        /* Inalcanzable: conforms() ya cerro el enum. Fallo cerrado explicito
         * en vez de caer en silencio. */
        (void)diana_prov_save(ctx);
        set_reject(ctx, out, DIANA_PROV_REASON_MALFORMED_PROVISIONING_MESSAGE);
        break;
    }
}

void diana_prov_connect_declaration(diana_prov_ctx *ctx, diana_prov_outcome *out)
{
    outcome_reset(out);
    out->state = (diana_prov_state)ctx->st.state;

    if (ctx->st.state == (uint8_t)DIANA_PROV_UNPROVISIONED) {
        out->publish = true;
        out->result = DIANA_PROV_RESULT_AUTHORITY_UNPROVISIONED;
        return;
    }
    if (ctx->st.state == (uint8_t)DIANA_PROV_STALE ||
        ctx->st.state == (uint8_t)DIANA_PROV_QUARANTINED) {
        out->publish = true;
        out->result = DIANA_PROV_RESULT_AUTHORITY_STALE;
        return;
    }
    /* READY/PREPARED: no hay nada que declarar, y anunciarlo obligaria al
     * servidor a responder a cada reconexion. */
    out->publish = false;
}

/* --------------------------------------------------------------- JSON ----- */

size_t diana_prov_state_json(const diana_prov_ctx *ctx, const diana_prov_command *cmd,
                             const diana_prov_outcome *out, char *buf, size_t cap)
{
    if (!out->publish) return 0;

    diana_json j;
    diana_json_init(&j, buf, cap);
    diana_json_obj_open(&j);
    diana_json_int(&j, "schema_version", 1);
    if (cmd != NULL && cmd->has_request_id && is_set(cmd->request_id)) {
        diana_json_str(&j, "request_id", cmd->request_id);
    }
    diana_json_str(&j, "device_id", ctx->device_id);
    diana_json_str(&j, "system_id", ctx->system_id);
    diana_json_str(&j, "command_plane", "DEVICE_MANAGEMENT");
    diana_json_str(&j, "result", diana_prov_result_str(out->result));
    diana_json_str(&j, "state", diana_prov_state_str((diana_prov_state)ctx->st.state));

    if (is_set(ctx->st.active_epoch)) {
        diana_json_str(&j, "active_epoch", ctx->st.active_epoch);
    } else {
        diana_json_null(&j, "active_epoch");
    }
    if (is_set(ctx->st.pending_epoch)) {
        diana_json_str(&j, "pending_epoch", ctx->st.pending_epoch);
    } else {
        diana_json_null(&j, "pending_epoch");
    }

    /* rotation_id solo en las respuestas de rotacion, provision_id solo en la
     * del bootstrap: el esquema PROHIBE cruzarlos, y cruzarlos volveria a
     * mezclar los dos dominios de identidad que el contrato separa. */
    if (out->result == DIANA_PROV_RESULT_PREPARED ||
        out->result == DIANA_PROV_RESULT_COMMITTED) {
        diana_json_str(&j, "rotation_id", cmd != NULL ? cmd->rotation_id : "");
    }
    if (out->result == DIANA_PROV_RESULT_PROVISIONED) {
        diana_json_str(&j, "provision_id", cmd != NULL ? cmd->provision_id : "");
    }

    diana_json_uint(&j, "last_delegation_sequence", ctx->st.last_delegation_sequence);
    diana_json_uint(&j, "last_provisioning_sequence", ctx->st.last_provisioning_sequence);
    diana_json_str(&j, "provisioning_key_fingerprint",
                   ctx->st.provisioning_key_fingerprint);

    const char *reason = diana_prov_reason_str(out->reason);
    if (reason != NULL) diana_json_str(&j, "reason", reason);

    diana_json_obj_close(&j);
    return diana_json_ok(&j) ? diana_json_len(&j) : 0;
}
