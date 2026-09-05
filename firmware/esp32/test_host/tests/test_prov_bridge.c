/**
 * @file test_prov_bridge.c
 * @brief MP0-F.0 · el PUENTE del plano DEVICE_MANAGEMENT (ADR-0008, v1.2).
 *
 * Este fichero NO prueba el motor de D1b -- eso es test_provisioning.c, y esa
 * logica no se ha tocado. Prueba el puente que faltaba:
 *
 *   1. ROUTING EXACTO. El despacho emparejaba por subcadena (`strstr`) y
 *      colisionaba: "/maintenance/command" contiene "/command". Aqui se
 *      ejercita diana_topic_route() sobre los seis topicos del enunciado y se
 *      comprueba que cada uno cae en EXACTAMENTE un TopicKind y en ninguno de
 *      los otros cinco. La comprobacion es una MATRIZ 6x6, no seis asertos
 *      sueltos: seis asertos sueltos no ven una colision, una matriz si.
 *
 *   2. TABLA DE PUBLICACION. `provision` NUNCA retenido, `provision/state`
 *      SIEMPRE retenido, los dos QoS 1. Sale de diana_topic_qos/retain, que es
 *      de donde lo lee el publicador real.
 *
 *   3. NO_SECRET_IN_STATE, con CONTROL POSITIVO. Una prueba de ausencia que no
 *      sabe ponerse roja no prueba nada: el mismo escaner se aplica a un
 *      payload adulterado que si lleva secreto, y debe detectarlo.
 *
 *   4. CONFORMIDAD CON EL ESQUEMA. Se vuelcan ejemplares reales de
 *      module-provision-state (bootstrap aplicado, rechazo por retenido y
 *      declaracion de arranque) para que tools/validate_messages.py los valide
 *      contra contracts/mqtt/module-provision-state.schema.json.
 *
 * LO QUE ESTA PRUEBA NO PUEDE AFIRMAR, y conviene no confundirlo: main/ y
 * components/diana_platform_esp/ NO se compilan en la suite de host. Que
 * app_commands.c llame al handler correcto para cada TopicKind, y que
 * mqtt_client.c suscriba de verdad `provision`, son propiedades ESTRUCTURALES
 * y las fija tools/check_prov_bridge.py. Aqui se demuestra que la DECISION de
 * enrutado es exacta; alli, que el codigo la usa.
 */
#include <string.h>

#include "diana/messages.h"
#include "diana/provisioning.h"
#include "diana/topic_route.h"
#include "hal_host.h"
#include "test_util.h"

#include "prov_vectors.h"

/* ------------------------------------------------------------ utilidades -- */

static void bcopy_str(char *dst, size_t cap, const char *src)
{
    size_t n = strlen(src);
    if (n >= cap) n = cap - 1u;
    memcpy(dst, src, n);
    dst[n] = '\0';
}

static const pv_order *bridge_order(const char *name)
{
    for (size_t i = 0; i < sizeof(PV_ORDERS) / sizeof(PV_ORDERS[0]); ++i)
        if (strcmp(PV_ORDERS[i].name, name) == 0) return &PV_ORDERS[i];
    return NULL;
}

static void bridge_delegation(diana_prov_delegation *d, const pv_delegation *v)
{
    memset(d, 0, sizeof(*d));
    d->delegation_version = v->version;
    bcopy_str(d->delegation_id, sizeof(d->delegation_id), v->delegation_id);
    bcopy_str(d->root_key_id, sizeof(d->root_key_id), v->root_key_id);
    bcopy_str(d->operational_key_id, sizeof(d->operational_key_id), v->operational_key_id);
    bcopy_str(d->operational_public_key, sizeof(d->operational_public_key),
              v->operational_public_key);
    bcopy_str(d->scope, sizeof(d->scope), v->scope);
    d->delegation_sequence = v->sequence;
    bcopy_str(d->system_id, sizeof(d->system_id), v->system_id);
    bcopy_str(d->signature_alg, sizeof(d->signature_alg), DIANA_PROV_SIGNATURE_ALG);
    bcopy_str(d->root_signature, sizeof(d->root_signature), v->root_signature);
}

static void bridge_cmd(diana_prov_command *c, const pv_order *v,
                       const pv_delegation *deleg)
{
    memset(c, 0, sizeof(*c));
    bcopy_str(c->request_id, sizeof(c->request_id),
              "9f9f9f9f-0000-4000-8000-000000000001");
    bcopy_str(c->device_id, sizeof(c->device_id), v->device_id);
    bcopy_str(c->system_id, sizeof(c->system_id), v->system_id);
    if (strcmp(v->action, "PROVISION") == 0) c->action = DIANA_PROV_ACTION_PROVISION;
    else if (strcmp(v->action, "PREPARE") == 0) c->action = DIANA_PROV_ACTION_PREPARE;
    else c->action = DIANA_PROV_ACTION_COMMIT;
    if (strcmp(v->mode, "NORMAL") == 0) c->mode = DIANA_PROV_MODE_NORMAL;
    else if (strcmp(v->mode, "EMERGENCY") == 0) c->mode = DIANA_PROV_MODE_EMERGENCY;
    else c->mode = DIANA_PROV_MODE_NONE;
    c->provisioning_sequence = v->sequence;
    bcopy_str(c->rotation_id, sizeof(c->rotation_id), v->rotation_id);
    bcopy_str(c->current_epoch, sizeof(c->current_epoch), v->current_epoch);
    bcopy_str(c->next_epoch, sizeof(c->next_epoch), v->next_epoch);
    bcopy_str(c->epoch, sizeof(c->epoch), v->epoch);
    bcopy_str(c->provision_id, sizeof(c->provision_id), v->provision_id);
    c->issued_at_ms = v->issued_at_ms;
    bcopy_str(c->provisioning_key_fingerprint,
              sizeof(c->provisioning_key_fingerprint), v->fingerprint);
    bcopy_str(c->signature_alg, sizeof(c->signature_alg), DIANA_PROV_SIGNATURE_ALG);
    bcopy_str(c->signature, sizeof(c->signature), v->signature);
    c->has_request_id = true;
    c->has_provisioning_sequence = true;
    c->has_issued_at_ms = true;
    c->has_schema_version_1 = true;
    c->has_command_plane_device_management = true;
    if (deleg != NULL) {
        c->has_delegation = true;
        bridge_delegation(&c->delegation, deleg);
    }
}

typedef struct {
    host_persistent nv;
    host_hal_ctx    hctx;
    diana_hal       hal;
    diana_prov_ctx  prov;
} bridge_fixture;

static void bridge_fixture_init(bridge_fixture *f)
{
    host_persistent_reset(&f->nv, 16);
    host_hal_init(&f->hctx, &f->nv, &f->hal, 7);
    diana_prov_init(&f->prov, &f->hal, PV_DEVICE_ID, PV_SYSTEM_ID, PV_FINGERPRINT);
    diana_prov_set_root_key(&f->prov, PV_ROOT_KEY, PV_ROOT_KEY_ID);
}

/* ------------------------------------------------- 1 · routing exacto ----- */

/** Los SEIS casos del enunciado, con el TopicKind que les toca. */
typedef struct {
    const char            *topic;
    diana_topic_route_kind expected;
    const char            *label;
} route_case;

static const route_case CASES[] = {
    { "targets/v1/module/module-07/command",
      DIANA_ROUTE_MODULE_COMMAND,              "game command" },
    { "targets/v1/module/module-07/maintenance/command",
      DIANA_ROUTE_MODULE_MAINTENANCE_COMMAND,  "maintenance command" },
    { "targets/v1/module/module-07/provision",
      DIANA_ROUTE_MODULE_PROVISION_COMMAND,    "provision command" },
    { "targets/v1/module/module-07/config/desired",
      DIANA_ROUTE_MODULE_CONFIG_DESIRED,       "config desired" },
    { "targets/v1/module/module-07/ota",
      DIANA_ROUTE_MODULE_OTA,                  "ota" },
    { "targets/v1/system/system-a/game/state",
      DIANA_ROUTE_GAME_STATE,                  "game state" },
};
#define NCASES (sizeof(CASES) / sizeof(CASES[0]))

static void test_routing_matrix(void)
{
    SECTION("routing EXACTO: cada topico a un unico destino");

    /* MATRIZ 6x6. Para cada topico se cuenta contra cuantos destinos
     * esperados casa. Debe ser exactamente 1, y el suyo.
     *
     * Con el `strstr(topic, "/command")` que habia antes, la fila de
     * "maintenance command" casaba tambien con "game command": la cuenta daba
     * 2 y esta prueba se pone ROJA. Ese es el defecto que fija. */
    for (size_t i = 0; i < NCASES; ++i) {
        diana_topic_route_kind got = diana_topic_route(CASES[i].topic, NULL, 0);
        size_t hits = 0;
        for (size_t j = 0; j < NCASES; ++j)
            if (got == CASES[j].expected) hits++;
        CHECK_EQ_INT((int)hits, 1, CASES[i].label);
        CHECK(got == CASES[i].expected, CASES[i].label);
    }

    SECTION("routing EXACTO: las colisiones de subcadena que existian");

    /* Las cuatro que un emparejado por subcadena confunde. */
    CHECK(diana_topic_route("targets/v1/module/module-07/maintenance/command",
                            NULL, 0) != DIANA_ROUTE_MODULE_COMMAND,
          "maintenance/command NO es el canal de juego");
    CHECK(diana_topic_route("targets/v1/module/module-07/provision/state",
                            NULL, 0) != DIANA_ROUTE_MODULE_PROVISION_COMMAND,
          "provision/state NO es la ORDEN de provisioning");
    CHECK(diana_topic_route("targets/v1/module/module-07/provision/state",
                            NULL, 0) == DIANA_ROUTE_MODULE_PROVISION_STATE,
          "provision/state es su propio TopicKind");
    CHECK(diana_topic_route("targets/v1/system/system-a/command", NULL, 0) ==
              DIANA_ROUTE_SYSTEM_COMMAND,
          "system/command es del sistema, no del modulo");
    CHECK(diana_topic_route("targets/v1/system/system-a/command", NULL, 0) !=
              DIANA_ROUTE_MODULE_COMMAND,
          "...y NO del canal de juego del modulo");

    SECTION("routing EXACTO: lo que no esta en la tabla no entra");

    CHECK_EQ_INT((int)diana_topic_route("targets/v1/module/module-07/commander",
                                        NULL, 0),
                 (int)DIANA_ROUTE_UNKNOWN, "prefijo mas largo: desconocido");
    CHECK_EQ_INT((int)diana_topic_route("targets/v1/module/module-07/provisionx",
                                        NULL, 0),
                 (int)DIANA_ROUTE_UNKNOWN, "provisionx no es provision");
    CHECK_EQ_INT((int)diana_topic_route("otro/prefijo/module/module-07/command",
                                        NULL, 0),
                 (int)DIANA_ROUTE_UNKNOWN, "raiz distinta: desconocido");
    CHECK_EQ_INT((int)diana_topic_route("targets/v1/module/+/provision", NULL, 0),
                 (int)DIANA_ROUTE_UNKNOWN, "un comodin '+' no es una identidad");
    CHECK_EQ_INT((int)diana_topic_route("targets/v1/module/module-07/#", NULL, 0),
                 (int)DIANA_ROUTE_UNKNOWN, "un comodin '#' no es un topico");
    CHECK_EQ_INT((int)diana_topic_route("targets/v1/module/MODULE-07/provision",
                                        NULL, 0),
                 (int)DIANA_ROUTE_UNKNOWN,
                 "identidad en mayusculas: fuera del patron del contrato");
    CHECK_EQ_INT((int)diana_topic_route(NULL, NULL, 0), (int)DIANA_ROUTE_UNKNOWN,
                 "topico nulo: desconocido, sin desreferenciar");

    SECTION("routing: extraccion de identidad");

    char id[DIANA_ROUTE_ID_BUF];
    CHECK(diana_topic_route("targets/v1/module/module-07/provision", id,
                            sizeof(id)) == DIANA_ROUTE_MODULE_PROVISION_COMMAND,
          "ruta con extraccion de id");
    CHECK_EQ_STR(id, "module-07", "el id extraido es el del topico");
    diana_topic_route("targets/v1/module/module-07/desconocido", id, sizeof(id));
    CHECK_EQ_STR(id, "",
                 "de un topico desconocido no se extrae identidad alguna");

    CHECK_EQ_STR(diana_topic_route_str(DIANA_ROUTE_MODULE_PROVISION_COMMAND),
                 "module-provision-command", "nombre de contrato del comando");
    CHECK_EQ_STR(diana_topic_route_str(DIANA_ROUTE_MODULE_PROVISION_STATE),
                 "module-provision-state", "nombre de contrato del estado");
    CHECK(diana_topic_route_str(DIANA_ROUTE_UNKNOWN) == NULL,
          "lo desconocido no tiene nombre de contrato");
}

/* --------------------------------------------- 2 · tabla de publicacion --- */

static void test_topic_table(void)
{
    SECTION("tabla de topicos v1.2: QoS y retain del contrato");

    char buf[DIANA_TOPIC_MAXLEN];
    CHECK(diana_topic_build(buf, sizeof(buf), DIANA_TOPIC_PROVISION_COMMAND,
                            "module-07") > 0,
          "se construye el topico de la orden");
    CHECK_EQ_STR(buf, "targets/v1/module/module-07/provision",
                 "orden: targets/v1/module/{id}/provision");
    CHECK(diana_topic_build(buf, sizeof(buf), DIANA_TOPIC_PROVISION_STATE,
                            "module-07") > 0,
          "se construye el topico del estado");
    CHECK_EQ_STR(buf, "targets/v1/module/module-07/provision/state",
                 "estado: targets/v1/module/{id}/provision/state");

    CHECK_EQ_INT(diana_topic_qos(DIANA_TOPIC_PROVISION_COMMAND), 1,
                 "la orden va a QoS 1");
    CHECK_EQ_INT(diana_topic_qos(DIANA_TOPIC_PROVISION_STATE), 1,
                 "el estado va a QoS 1");

    /* El comando retenido es un replay servido por el broker: el modulo lo
     * rechaza al recibirlo Y no puede publicarlo retenido. */
    CHECK(!diana_topic_retain(DIANA_TOPIC_PROVISION_COMMAND),
          "la ORDEN nunca se publica retenida");
    CHECK(diana_topic_retain(DIANA_TOPIC_PROVISION_STATE),
          "el ESTADO se publica RETENIDO (ultima fotografia)");

    /* Que el enumerado haya crecido no puede haber desplazado el resto. */
    CHECK(diana_topic_build(buf, sizeof(buf), DIANA_TOPIC_OTA, "module-07") > 0 &&
              strcmp(buf, "targets/v1/module/module-07/ota") == 0,
          "los topicos previos no se han desplazado al ampliar el enumerado");
    CHECK(diana_topic_retain(DIANA_TOPIC_HIT) == false,
          "hit sigue sin retener tras la ampliacion");
}

/* ------------------------------------- 3 · el comando retenido se rechaza - */

static void test_retained_command_still_rejected(void)
{
    SECTION("la ORDEN retenida sigue muriendo por retenida (regresion D1b)");

    bridge_fixture f;
    bridge_fixture_init(&f);

    const pv_order *v = bridge_order("provision_ok");
    diana_prov_command c;
    diana_prov_outcome o;

    /* Firma valida, secuencia buena, credencial buena: solo el flag de
     * transporte esta mal. Tiene que morir POR RETENIDO, antes de la firma. */
    bridge_cmd(&c, v, &PV_DELEGS[0]);
    diana_prov_handle(&f.prov, &c, true, &o);
    CHECK(o.result == DIANA_PROV_RESULT_REJECTED,
          "una orden retenida se rechaza aunque todo lo demas sea valido");
    CHECK(o.reason == DIANA_PROV_REASON_RETAINED_PROVISIONING_REJECTED,
          "...con retained_provisioning_rejected");
    CHECK(!o.applied, "y no aplica NADA");
    CHECK(o.state == DIANA_PROV_UNPROVISIONED,
          "el modulo sigue sin autoridad");

    /* Y el rechazo se PUBLICA: es reported state, no silencio. */
    char buf[1024];
    size_t n = diana_prov_state_json(&f.prov, &c, &o, buf, sizeof(buf));
    CHECK(o.publish && n > 0, "el rechazo por retenido se emite como estado");
    CHECK(strstr(buf, "\"reason\":\"retained_provisioning_rejected\"") != NULL,
          "el motivo publicado es el del vocabulario cerrado");
    dump_message("module-provision-state.schema.json",
                 "provision_state_retained_rejected", buf);
}

/* ------------------------------------------- 4 · NO_SECRET_IN_STATE ------- */

/**
 * Escaner de material sensible. Devuelve el nombre de lo que ha encontrado, o
 * NULL si el payload esta limpio.
 *
 * Busca DOS cosas distintas a proposito: nombres de campo prohibidos (alguien
 * anade "root_key") y VALORES concretos del material del banco (alguien
 * publica la clave sin llamarla por su nombre). Con solo lo primero, renombrar
 * el campo esquivaria la prueba.
 */
static const char *scan_secrets(const char *json)
{
    /* Los nombres de clave van ENTRECOMILLADOS donde hace falta para no
     * confundir un contador legitimo con material: `last_delegation_sequence`
     * es un numero de secuencia publico, no la credencial. Buscar "delegation"
     * a pelo lo daba por secreto (falso positivo), y un escaner que grita con
     * lo bueno acaba desactivado. */
    static const char *const FIELDS[] = {
        "root_key", "private", "privkey", "secret", "password", "passwd",
        "mqtt_password", "operational_public_key", "operational_key",
        "\"signature\"", "root_signature", "\"delegation\"",
    };
    for (size_t i = 0; i < sizeof(FIELDS) / sizeof(FIELDS[0]); ++i)
        if (strstr(json, FIELDS[i]) != NULL) return FIELDS[i];

    /* Valores del banco: la clave operativa en base64url y la firma de la
     * orden. Ninguno tiene nada que hacer en un reported state. */
    if (strstr(json, PV_DELEGS[0].operational_public_key) != NULL)
        return "valor: clave operativa";
    if (strstr(json, PV_DELEGS[0].root_signature) != NULL)
        return "valor: firma de la raiz";
    return NULL;
}

static void test_no_secret_in_state(void)
{
    SECTION("NO_SECRET_IN_STATE");

    bridge_fixture f;
    bridge_fixture_init(&f);
    const pv_order *v = bridge_order("provision_ok");
    diana_prov_command c;
    diana_prov_outcome o;
    bridge_cmd(&c, v, &PV_DELEGS[0]);
    diana_prov_handle(&f.prov, &c, false, &o);

    char buf[1024];
    size_t n = diana_prov_state_json(&f.prov, &c, &o, buf, sizeof(buf));
    CHECK(n > 0 && o.result == DIANA_PROV_RESULT_PROVISIONED,
          "bootstrap aplicado: hay estado que publicar");

    const char *found = scan_secrets(buf);
    if (found != NULL) printf("  ...material encontrado: %s\n", found);
    CHECK(found == NULL, "el estado publicado NO contiene material sensible");

    /* La huella SI puede ir: es un identificador publico, no material. */
    CHECK(strstr(buf, "provisioning_key_fingerprint") != NULL,
          "la huella publica si viaja (es un identificador, no un secreto)");

    /* --- CONTROL POSITIVO. Sin esto la prueba de arriba no vale nada: una
     * comprobacion de ausencia que no sabe ponerse roja pasa siempre. Se
     * adultera una copia del payload metiendole un campo secreto y el MISMO
     * escaner tiene que cazarlo. */
    char doctored[1200];
    snprintf(doctored, sizeof(doctored),
             "{\"schema_version\":1,\"root_key\":\"%s\"}",
             PV_DELEGS[0].operational_public_key);
    CHECK(scan_secrets(doctored) != NULL,
          "CONTROL POSITIVO: el escaner detecta un root_key anadido");

    char doctored2[1200];
    snprintf(doctored2, sizeof(doctored2),
             "{\"schema_version\":1,\"material\":\"%s\"}",
             PV_DELEGS[0].operational_public_key);
    CHECK(scan_secrets(doctored2) != NULL,
          "CONTROL POSITIVO: lo caza tambien con el campo RENOMBRADO");

    CHECK(scan_secrets("{\"schema_version\":1,\"state\":\"READY\"}") == NULL,
          "CONTROL NEGATIVO: un payload limpio no dispara el escaner");

    dump_message("module-provision-state.schema.json",
                 "provision_state_provisioned", buf);
}

/* -------------------------------- 5 · declaracion de arranque ------------- */

static void test_connect_declaration(void)
{
    SECTION("declaracion de autoridad al conectar");

    bridge_fixture f;
    bridge_fixture_init(&f);

    diana_prov_outcome o;
    diana_prov_connect_declaration(&f.prov, &o);
    CHECK(o.publish, "sin autoridad SI hay algo que declarar");
    CHECK(o.result == DIANA_PROV_RESULT_AUTHORITY_UNPROVISIONED,
          "se declara AUTHORITY_UNPROVISIONED");

    char buf[1024];
    /* cmd = NULL: la declaracion no responde a ninguna orden y por eso no
     * lleva request_id. El esquema lo deja opcional justo para este caso. */
    size_t n = diana_prov_state_json(&f.prov, NULL, &o, buf, sizeof(buf));
    CHECK(n > 0, "la declaracion serializa sin orden que correlar");
    CHECK(strstr(buf, "request_id") == NULL,
          "sin orden no se inventa un request_id");
    CHECK(scan_secrets(buf) == NULL, "la declaracion tampoco lleva secretos");
    dump_message("module-provision-state.schema.json",
                 "provision_state_declaration", buf);

    /* Con autoridad utilizable no se declara nada: publish=false, y el
     * publicador real NO emite. */
    const pv_order *v = bridge_order("provision_ok");
    diana_prov_command c;
    diana_prov_outcome ap;
    bridge_cmd(&c, v, &PV_DELEGS[0]);
    diana_prov_handle(&f.prov, &c, false, &ap);
    CHECK(ap.result == DIANA_PROV_RESULT_PROVISIONED, "bootstrap aplicado");

    diana_prov_connect_declaration(&f.prov, &o);
    CHECK(!o.publish, "en READY no hay nada que declarar");
    CHECK_EQ_INT((int)diana_prov_state_json(&f.prov, NULL, &o, buf, sizeof(buf)), 0,
                 "publish=false no produce payload: no se inventa fotografia");
}

int run_prov_bridge(void)
{
    TEST_SUITE("prov_bridge");
    int before = g_tests_failed;

    test_routing_matrix();
    test_topic_table();
    test_retained_command_still_rejected();
    test_no_secret_in_state();
    test_connect_declaration();

    return g_tests_failed - before;
}
