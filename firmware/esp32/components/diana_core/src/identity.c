#include "diana/identity.h"

#include <string.h>

#include "diana/ids.h"

static int kv_get_str(const diana_hal *hal, const char *ns, const char *key,
                      char *out, size_t cap)
{
    size_t len = 0;
    out[0] = '\0';
    if (!hal || !hal->kv_get) return DIANA_HAL_ERR_GENERIC;
    int rc = hal->kv_get(hal->ctx, ns, key, out, cap, &len);
    if (rc != DIANA_HAL_OK) {
        out[0] = '\0';
        return rc;
    }
    if (len >= cap) len = cap - 1;
    out[len] = '\0';
    return DIANA_HAL_OK;
}

static int kv_set_str(const diana_hal *hal, const char *ns, const char *key,
                      const char *val)
{
    if (!hal || !hal->kv_set) return DIANA_HAL_ERR_GENERIC;
    return hal->kv_set(hal->ctx, ns, key, val, strlen(val));
}

static int kv_get_u64(const diana_hal *hal, const char *ns, const char *key,
                      uint64_t *out)
{
    size_t len = 0;
    if (!hal || !hal->kv_get) return DIANA_HAL_ERR_GENERIC;
    int rc = hal->kv_get(hal->ctx, ns, key, out, sizeof(*out), &len);
    if (rc != DIANA_HAL_OK || len != sizeof(*out)) return DIANA_HAL_ERR_NOT_FOUND;
    return DIANA_HAL_OK;
}

static int kv_set_u64(const diana_hal *hal, const char *ns, const char *key,
                      uint64_t val)
{
    if (!hal || !hal->kv_set) return DIANA_HAL_ERR_GENERIC;
    return hal->kv_set(hal->ctx, ns, key, &val, sizeof(val));
}

static void copy_bounded(char *dst, size_t cap, const char *src)
{
    if (!src) { dst[0] = '\0'; return; }
    size_t n = strlen(src);
    if (n >= cap) n = cap - 1;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

int diana_identity_load(diana_identity *id, const diana_hal *hal,
                        const char *firmware_version)
{
    memset(id, 0, sizeof(*id));
    copy_bounded(id->firmware_version, sizeof(id->firmware_version),
                 firmware_version);

    /* boot_id nuevo en cada arranque: ADR-0003. */
    diana_uuid4(hal, id->boot_id);

    id->reset_reason = DIANA_RESET_UNKNOWN;
    if (hal && hal->reset_reason) {
        int r = hal->reset_reason(hal->ctx);
        if (r >= 0 && r < DIANA_RESET_COUNT) id->reset_reason = (diana_reset_reason)r;
    }

    kv_get_str(hal, DIANA_NVS_NS_IDENTITY, "module_id", id->module_id,
               sizeof(id->module_id));
    kv_get_str(hal, DIANA_NVS_NS_IDENTITY, "system_id", id->system_id,
               sizeof(id->system_id));
    kv_get_str(hal, DIANA_NVS_NS_IDENTITY, "serial", id->serial,
               sizeof(id->serial));
    kv_get_str(hal, DIANA_NVS_NS_IDENTITY, "hw_rev", id->hardware_revision,
               sizeof(id->hardware_revision));
    kv_get_str(hal, DIANA_NVS_NS_IDENTITY, "mqtt_user", id->mqtt_user,
               sizeof(id->mqtt_user));
    kv_get_str(hal, DIANA_NVS_NS_IDENTITY, "mqtt_pass", id->mqtt_pass,
               sizeof(id->mqtt_pass));

    /* Reserva de secuencia: se arranca desde la frontera persistida, nunca
     * desde el ultimo valor emitido. Asi un corte de corriente puede saltar
     * numeros pero jamas repetirlos. */
    uint64_t frontier = 0;
    if (kv_get_u64(hal, DIANA_NVS_NS_IDENTITY, "seq_hi", &frontier) != DIANA_HAL_OK)
        frontier = 0;
    id->local_sequence = frontier;
    id->seq_persisted_upto = frontier + DIANA_SEQ_RESERVE_BLOCK;
    kv_set_u64(hal, DIANA_NVS_NS_IDENTITY, "seq_hi", id->seq_persisted_upto);

    id->loaded = (id->module_id[0] != '\0');
    return id->loaded ? DIANA_HAL_OK : DIANA_HAL_ERR_NOT_FOUND;
}

int diana_identity_provision(diana_identity *id, const diana_hal *hal,
                             const char *module_id, const char *system_id,
                             const char *serial, const char *hw_rev,
                             const char *mqtt_user, const char *mqtt_pass)
{
    if (!diana_is_identifier(module_id)) return DIANA_HAL_ERR_INVALID;
    if (system_id && system_id[0] && !diana_is_identifier(system_id))
        return DIANA_HAL_ERR_INVALID;

    copy_bounded(id->module_id, sizeof(id->module_id), module_id);
    copy_bounded(id->system_id, sizeof(id->system_id), system_id);
    copy_bounded(id->serial, sizeof(id->serial), serial);
    copy_bounded(id->hardware_revision, sizeof(id->hardware_revision), hw_rev);
    copy_bounded(id->mqtt_user, sizeof(id->mqtt_user), mqtt_user);
    copy_bounded(id->mqtt_pass, sizeof(id->mqtt_pass), mqtt_pass);

    kv_set_str(hal, DIANA_NVS_NS_IDENTITY, "module_id", id->module_id);
    kv_set_str(hal, DIANA_NVS_NS_IDENTITY, "system_id", id->system_id);
    kv_set_str(hal, DIANA_NVS_NS_IDENTITY, "serial", id->serial);
    kv_set_str(hal, DIANA_NVS_NS_IDENTITY, "hw_rev", id->hardware_revision);
    kv_set_str(hal, DIANA_NVS_NS_IDENTITY, "mqtt_user", id->mqtt_user);
    kv_set_str(hal, DIANA_NVS_NS_IDENTITY, "mqtt_pass", id->mqtt_pass);

    id->loaded = true;
    return DIANA_HAL_OK;
}

int diana_identity_set_system(diana_identity *id, const diana_hal *hal,
                              const char *system_id)
{
    if (!system_id || !diana_is_identifier(system_id)) return DIANA_HAL_ERR_INVALID;
    copy_bounded(id->system_id, sizeof(id->system_id), system_id);
    return kv_set_str(hal, DIANA_NVS_NS_IDENTITY, "system_id", id->system_id);
}

uint64_t diana_identity_next_sequence(diana_identity *id, const diana_hal *hal)
{
    uint64_t v = id->local_sequence++;
    if (id->local_sequence >= id->seq_persisted_upto) {
        id->seq_persisted_upto = id->local_sequence + DIANA_SEQ_RESERVE_BLOCK;
        kv_set_u64(hal, DIANA_NVS_NS_IDENTITY, "seq_hi", id->seq_persisted_upto);
    }
    return v;
}
