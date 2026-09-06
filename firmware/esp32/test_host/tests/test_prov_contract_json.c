/*
 * El EJEMPLO DEL CONTRATO tiene que atravesar el parser del firmware.
 * ============================================================================
 *
 * Esta prueba existe por un defecto real, encontrado por el E2E-3 y no por las
 * 1005 comprobaciones de esta suite:
 *
 *   conforms() EXIGE delegation.signature_alg (provisioning.c:325), pero el
 *   esquema del contrato lo OMITIA y lleva additionalProperties:false. El
 *   backend valida cada publicacion contra el esquema, asi que no podia
 *   emitirlo, y el firmware rechazaba la orden como
 *   malformed_provisioning_message con CERO escrituras de NVS.
 *
 *   Consecuencia: NINGUNA orden PROVISION conforme al contrato podia
 *   aprovisionar un modulo. GAP-D1B-DELEG-ALG.
 *
 * Por que no lo vio nadie: test_provisioning.c construye la delegacion EN
 * MEMORIA (fill_delegation) en vez de parsear un JSON conforme, asi que
 * comprobaba el parser contra sus propias estructuras, nunca contra el
 * contrato. Un lazo cerrado sobre si mismo.
 *
 * Aqui se lee el ejemplo REAL de contracts/examples/valid/ y se hace pasar por
 * diana_prov_message(). Si el contrato y el parser vuelven a divergir en
 * CUALQUIER campo -- no solo en este -- esto se pone rojo.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "diana/provisioning.h"
#include "hal_host.h"
#include "test_util.h"

static const char *repo_root(void)
{
    static char root[1024];
    if (root[0]) return root;
    static const char SUFFIX[] =
        "/firmware/esp32/test_host/tests/test_prov_contract_json.c";
    const char *self = __FILE__;
    size_t sl = strlen(self), xl = sizeof(SUFFIX) - 1;
    if (sl <= xl || strcmp(self + (sl - xl), SUFFIX) != 0) return NULL;
    size_t rl = sl - xl;
    if (rl >= sizeof(root)) return NULL;
    memcpy(root, self, rl);
    root[rl] = '\0';
    return root;
}

static char *slurp(const char *relative, size_t *out_len)
{
    const char *root = repo_root();
    if (!root) return NULL;
    char path[1536];
    snprintf(path, sizeof(path), "%s/%s", root, relative);
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    size_t cap = 1 << 16, len = 0;
    char *buf = malloc(cap);
    if (!buf) { fclose(f); return NULL; }
    for (;;) {
        if (len + 4096 + 1 > cap) {
            cap *= 2;
            char *nb = realloc(buf, cap);
            if (!nb) { free(buf); fclose(f); return NULL; }
            buf = nb;
        }
        size_t n = fread(buf + len, 1, 4096, f);
        len += n;
        if (n < 4096) break;
    }
    fclose(f);
    buf[len] = '\0';
    if (out_len) *out_len = len;
    return buf;
}

/* Quita las claves de metadatos del ejemplo (_schema, _reason): no son del
 * contrato, las anade el arnes de ejemplos. Se hace con un barrido textual
 * simple porque el JSON de los ejemplos esta generado y es estable. */
static void strip_meta(char *json)
{
    static const char *META[] = {"\"_schema\"", "\"_reason\""};
    for (size_t m = 0; m < sizeof(META) / sizeof(META[0]); ++m) {
        char *k = strstr(json, META[m]);
        if (!k) continue;
        char *end = strchr(k, '\n');
        if (!end) continue;
        memmove(k, end + 1, strlen(end + 1) + 1);
    }
}

int run_prov_contract_json(void)
{
    TEST_SUITE("contrato-json");
    int before = g_tests_failed;

    SECTION("el ejemplo VALIDO del contrato atraviesa el parser del firmware");
    {
        size_t len = 0;
        char *json = slurp(
            "contracts/examples/valid/module-provision-command/provision.json",
            &len);
        CHECK(json != NULL, "se localiza el ejemplo del contrato");
        if (json) {
            strip_meta(json);

            host_persistent nv;
            host_hal_ctx    hctx;
            diana_hal       hal;
            host_persistent_reset(&nv, 16);
            host_hal_init(&hctx, &nv, &hal, 7);
            diana_prov_ctx ctx;
            diana_prov_init(&ctx, &hal, "module-07", "system-a",
                            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

            diana_prov_outcome out;
            diana_prov_command cmd;
            diana_prov_message(&ctx, json, strlen(json), false, &cmd, &out);

            /* NO se exige que se aplique: la firma del ejemplo es de relleno y
             * el fingerprint no coincide. Lo que se exige es que NO muera por
             * MALFORMED: eso significaria que el contrato describe un mensaje
             * que el parser no acepta, que es exactamente el defecto que esta
             * prueba existe para impedir. */
            CHECK(out.reason != DIANA_PROV_REASON_MALFORMED_PROVISIONING_MESSAGE,
                  "el ejemplo del contrato NO es malformed para el firmware");
            free(json);
        }
    }

    return g_tests_failed - before;
}
