/**
 * @file prov_runner.c
 * @brief EL DISPOSITIVO, compilado en HOST, como proceso de larga vida.
 *
 * Carril E2E-3 (DEVICE MANAGEMENT). Este binario NO es una prueba: es el
 * extremo "modulo" del escenario. Recibe por stdin los payloads que llegaron
 * de VERDAD por el broker Mosquitto (TLS + ACL) y los mete por
 * diana_prov_message(), que es el camino de runtime completo del firmware:
 *
 *     payload crudo -> diana_prov_parse -> diana_prov_handle -> NVS -> veredicto
 *
 * Por que un proceso de LARGA VIDA y no uno por mensaje: la autoridad del
 * modulo vive en NVS (host_persistent). Un proceso por mensaje empezaria de
 * fabrica cada vez y el control positivo ("repetir la orden produce CERO
 * efectos adicionales") pasaria trivialmente por amnesia, no por
 * antirrepeticion. Aqui el estado persiste entre mensajes, y REBOOT
 * reinicializa el contexto CONSERVANDO la NVS, igual que un reinicio real.
 *
 * Lo que este binario NO es: silicio. No hay ESP32, ni cliente MQTT dentro del
 * firmware, ni ISR, ni piezo. Todo lo que se afirme con el debe decir
 * "firmware-en-host". Ver el informe del carril.
 *
 * Protocolo de linea (stdin -> stdout), pensado para que el arnes no tenga que
 * escapar nada: los payloads viajan en base64url.
 *
 *   INIT <device_id> <system_id> <fingerprint_hex> <root_pubkey_b64url> [root_key_id]
 *   MSG <0|1 retained> <payload_b64url>
 *   SNAP
 *   REBOOT
 *   QUIT
 *
 * Respuestas, siempre terminadas por una linea "END":
 *   OUT   k=v;k=v;...      veredicto de diana_prov_message
 *   STATE <json_b64url>    module-provision-state serializado por el firmware
 *   SNAP  k=v;...          estado PERSISTIDO + contadores del HAL
 *   ERR   <motivo>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "diana/base64url.h"
#include "diana/p256.h"
#include "diana/provisioning.h"
#include "hal_host.h"

#define LINE_MAX_LEN 16384
#define PAYLOAD_MAX  8192

static host_persistent g_nv;
static host_hal_ctx    g_hal_ctx;
static diana_hal       g_hal;
static diana_prov_ctx  g_prov;
static bool            g_ready;

static char g_device[DIANA_PROV_ID_BUF];
static char g_system[DIANA_PROV_ID_BUF];
static char g_fprint[DIANA_PROV_FP_HEX_BUF];

static void copy_bounded(char *dst, size_t cap, const char *src)
{
    size_t n = strlen(src);
    if (n >= cap) n = cap - 1u;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

static const char *yn(bool v) { return v ? "1" : "0"; }

/** Emite el veredicto COMPLETO, incluida la traza de pasos EJECUTADOS. */
static void print_outcome(const diana_prov_outcome *o)
{
    printf("OUT publish=%s;result=%s;state=%s;reason=%s;applied=%s;"
           "authority_changed=%s;new_epoch=%s;kv_writes=%u;undeliverable=%u;"
           "bootstraps=%u;trace=",
           yn(o->publish),
           diana_prov_result_str(o->result),
           diana_prov_state_str(o->state),
           o->reason == DIANA_PROV_REASON_NONE ? "-" : diana_prov_reason_str(o->reason),
           yn(o->applied), yn(o->authority_changed),
           o->new_active_epoch[0] ? o->new_active_epoch : "-",
           (unsigned)g_hal_ctx.kv_writes,
           (unsigned)g_prov.undeliverable_rejections,
           (unsigned)g_prov.applied_bootstraps);
    for (size_t i = 0; i < o->trace_len; ++i) {
        printf("%s%s", i ? "|" : "", o->trace[i]);
    }
    printf("\n");
}

static void print_snapshot(void)
{
    const diana_prov_persist *st = &g_prov.st;
    printf("SNAP state=%s;active_epoch=%s;pending_epoch=%s;last_prov_seq=%llu;"
           "last_rotation=%s;last_deleg_seq=%llu;has_op_key=%s;has_deleg_fp=%s;"
           "fingerprint=%s;kv_writes=%u;reboots=%u\n",
           diana_prov_state_str((diana_prov_state)st->state),
           st->active_epoch[0] ? st->active_epoch : "-",
           st->pending_epoch[0] ? st->pending_epoch : "-",
           (unsigned long long)st->last_provisioning_sequence,
           st->last_rotation_id[0] ? st->last_rotation_id : "-",
           (unsigned long long)st->last_delegation_sequence,
           yn(st->has_operational_key), yn(st->has_delegation_fingerprint),
           st->provisioning_key_fingerprint,
           (unsigned)g_hal_ctx.kv_writes,
           (unsigned)g_hal_ctx.reboots);
}

static void done(void) { printf("END\n"); fflush(stdout); }

static void fail(const char *why) { printf("ERR %s\n", why); done(); }

static void cmd_init(char *args)
{
    char *dev = strtok(args, " ");
    char *sys = strtok(NULL, " ");
    char *fp  = strtok(NULL, " ");
    char *rk  = strtok(NULL, " ");
    char *rkid = strtok(NULL, " \n");
    if (!dev || !sys || !fp || !rk) {
        fail("INIT necesita device system fingerprint rootkey");
        return;
    }

    /* "NONE" = dispositivo SIN identidad de raiz fijada. No es un atajo del
     * arnes: es el estado de un modulo al que el utillaje de fabrica no le
     * grabo la raiz, y el contrato exige que entonces TODA credencial se
     * rechace (fallo cerrado), nunca "acepta porque no puede comprobar". */
    bool no_root = (strcmp(rk, "NONE") == 0);
    uint8_t root[DIANA_P256_PUBKEY_LEN];
    size_t root_len = sizeof(root);
    if (!no_root &&
        (!diana_base64url_decode(rk, root, &root_len) || root_len != DIANA_P256_PUBKEY_LEN)) {
        fail("la clave raiz no es un punto SEC1 de 65 bytes en base64url");
        return;
    }

    host_persistent_reset(&g_nv, 16);
    host_hal_init(&g_hal_ctx, &g_nv, &g_hal, 0x1234u);
    copy_bounded(g_device, sizeof(g_device), dev);
    copy_bounded(g_system, sizeof(g_system), sys);
    copy_bounded(g_fprint, sizeof(g_fprint), fp);
    memset(&g_prov, 0, sizeof(g_prov));
    diana_prov_init(&g_prov, &g_hal, g_device, g_system, g_fprint);
    if (!no_root) diana_prov_set_root_key(&g_prov, root, rkid ? rkid : "");
    /* Las escrituras de NVS del arranque no son efecto de ninguna orden: el
     * contador se pone a cero DESPUES de inicializar, para que "cero efecto"
     * signifique cero escrituras atribuibles a la orden medida. */
    g_hal_ctx.kv_writes = 0;
    g_ready = true;
    print_snapshot();
    done();
}

static void cmd_reboot(void)
{
    if (!g_ready) { fail("sin INIT"); return; }
    /* Reinicio REAL del modulo: contexto nuevo, NVS intacta. */
    uint32_t writes = g_hal_ctx.kv_writes;
    uint8_t root[DIANA_P256_PUBKEY_LEN];
    memcpy(root, g_prov.root_key, sizeof(root));
    char rkid[DIANA_PROV_ID_BUF];
    copy_bounded(rkid, sizeof(rkid), g_prov.root_key_id);
    bool had_root = g_prov.has_root_key;

    g_hal_ctx.reboots += 1u;
    memset(&g_prov, 0, sizeof(g_prov));
    diana_prov_init(&g_prov, &g_hal, g_device, g_system, g_fprint);
    if (had_root) diana_prov_set_root_key(&g_prov, root, rkid);
    g_hal_ctx.kv_writes = writes;   /* el reinicio no inventa efectos */
    print_snapshot();
    done();
}

static void cmd_msg(char *args)
{
    if (!g_ready) { fail("sin INIT"); return; }
    char *retained_s = strtok(args, " ");
    char *b64 = strtok(NULL, " \n");
    if (!retained_s || !b64) { fail("MSG necesita <0|1> <payload_b64url>"); return; }
    bool retained = (retained_s[0] == '1');

    static uint8_t payload[PAYLOAD_MAX];
    size_t len = sizeof(payload) - 1u;
    if (!diana_base64url_decode(b64, payload, &len)) { fail("payload no es base64url"); return; }
    payload[len] = '\0';

    diana_prov_command cmd;
    diana_prov_outcome out;
    memset(&cmd, 0, sizeof(cmd));
    memset(&out, 0, sizeof(out));
    diana_prov_message(&g_prov, (const char *)payload, len, retained, &cmd, &out);
    print_outcome(&out);

    if (out.publish) {
        char json[2048];
        size_t n = diana_prov_state_json(&g_prov, &cmd, &out, json, sizeof(json));
        if (n == 0) {
            printf("ERR la respuesta provision/state no cabe\n");
        } else {
            char enc[4096];
            size_t m = diana_base64url_encode((const uint8_t *)json, n, enc, sizeof(enc));
            if (m == 0) printf("ERR no se pudo codificar la respuesta\n");
            else printf("STATE %s\n", enc);
        }
    }
    print_snapshot();
    done();
}

int main(void)
{
    static char line[LINE_MAX_LEN];
    setvbuf(stdout, NULL, _IOLBF, 0);
    while (fgets(line, sizeof(line), stdin)) {
        size_t n = strlen(line);
        while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r')) line[--n] = '\0';
        if (n == 0) continue;
        char *sp = strchr(line, ' ');
        char *args = sp ? sp + 1 : line + n;
        if (sp) *sp = '\0';

        if (strcmp(line, "INIT") == 0)        cmd_init(args);
        else if (strcmp(line, "MSG") == 0)    cmd_msg(args);
        else if (strcmp(line, "SNAP") == 0)   { if (!g_ready) fail("sin INIT"); else { print_snapshot(); done(); } }
        else if (strcmp(line, "REBOOT") == 0) cmd_reboot();
        else if (strcmp(line, "QUIT") == 0)   break;
        else                                  fail("orden desconocida");
    }
    return 0;
}
