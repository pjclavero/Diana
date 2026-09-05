/**
 * @file test_mqtt_endpoint.c
 * @brief COHERENCIA DE IDENTIDAD MQTT entre CUATRO fuentes, y fallo cerrado TLS.
 *
 * ===========================================================================
 * QUE ATA ESTA PRUEBA
 * ===========================================================================
 *
 *   (1) el firmware        -> diana_mqtt_username(), EJECUTADA de verdad
 *   (2) el contrato        -> regla §8 "el usuario es exactamente el module_id"
 *   (3) identities.json    -> fuente unica de identidades del broker
 *   (4) el acl generado    -> autorizacion real de Mosquitto, y users.generated.txt
 *
 * Las cuatro tienen que coincidir LETRA A LETRA. El hallazgo F-02 se cerro en
 * el broker (3 y 4) pero el firmware (1) se quedo construyendo
 * "module-" + module_id, es decir "module-module-01": un usuario que no existe
 * en ningun sitio. Nada se puso rojo porque nada ejecutaba esa linea.
 *
 * Por eso esta prueba NO comprueba una constante escrita a mano: LEE los
 * ficheros reales del repositorio, en el arbol en el que se ejecuta, y compara
 * contra la salida real de la funcion del firmware. Si alguien reintroduce el
 * prefijo, o renombra una identidad en identities.json sin regenerar el acl, o
 * anade un modulo al acl que el firmware no sabria construir, esto se pone rojo.
 *
 * ===========================================================================
 * COMO ENCUENTRA LOS FICHEROS
 * ===========================================================================
 *
 * Por __FILE__, que el Makefile de host pasa como ruta ABSOLUTA
 * ($(FW)/test_host/tests/...). Se sube hasta la raiz del repositorio quitando
 * el sufijo conocido. No depende del directorio de trabajo (la suite se ejecuta
 * desde build-host/) ni de variables de entorno que alguien pueda no definir.
 * Si los ficheros no aparecen, la prueba FALLA: una fuente ausente no puede
 * contarse como conformidad.
 *
 * ===========================================================================
 * LIMITE HONESTO
 * ===========================================================================
 *
 * Esto demuestra que el firmware produce los usuarios que el broker autoriza.
 * NO demuestra que el broker acepte la conexion: eso exige un Mosquitto vivo y
 * una placa, y sigue siendo PENDING_PHYSICAL_VALIDATION.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "diana/mqtt_endpoint.h"
#include "test_util.h"

/* --------------------------------------------------------------------------
 * Localizacion de la raiz del repositorio
 * -------------------------------------------------------------------------- */

static const char *repo_root(void)
{
    static char root[1024];
    if (root[0]) return root;

    static const char SUFFIX[] = "/firmware/esp32/test_host/tests/test_mqtt_endpoint.c";
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

/* --------------------------------------------------------------------------
 * Lector JSON minimo, recursivo. Parsea la GRAMATICA, no busca subcadenas:
 * un `"username"` dentro del bloque `_comment` de identities.json no se
 * confunde con una clave, porque el comentario se recorre como cadena.
 * -------------------------------------------------------------------------- */

typedef struct { const char *p; bool err; } jr;

static void j_ws(jr *r) { while (*r->p == ' ' || *r->p == '\t' || *r->p == '\n' || *r->p == '\r') r->p++; }

static void j_value(jr *r);

/* Lee una cadena JSON a `out` (sin comillas). Soporta los escapes simples. */
static void j_string(jr *r, char *out, size_t cap)
{
    size_t n = 0;
    j_ws(r);
    if (*r->p != '"') { r->err = true; return; }
    r->p++;
    while (*r->p && *r->p != '"') {
        char c = *r->p++;
        if (c == '\\') {
            char e = *r->p++;
            switch (e) {
            case 'n': c = '\n'; break;
            case 't': c = '\t'; break;
            case 'r': c = '\r'; break;
            case 'u': /* no se usa en este fichero; se salta el codepoint */
                for (int i = 0; i < 4 && *r->p; ++i) r->p++;
                c = '?';
                break;
            default: c = e; break;
            }
            if (e == '\0') { r->err = true; return; }
        }
        if (out && n + 1 < cap) out[n++] = c;
    }
    if (*r->p != '"') { r->err = true; return; }
    r->p++;
    if (out && cap) out[n < cap ? n : cap - 1] = '\0';
}

static void j_skip_scalar(jr *r)
{
    while (*r->p && *r->p != ',' && *r->p != '}' && *r->p != ']') r->p++;
}

static void j_value(jr *r)
{
    j_ws(r);
    if (r->err) return;
    if (*r->p == '"') { j_string(r, NULL, 0); return; }
    if (*r->p == '{') {
        r->p++;
        j_ws(r);
        if (*r->p == '}') { r->p++; return; }
        for (;;) {
            j_string(r, NULL, 0);
            j_ws(r);
            if (*r->p != ':') { r->err = true; return; }
            r->p++;
            j_value(r);
            if (r->err) return;
            j_ws(r);
            if (*r->p == ',') { r->p++; continue; }
            if (*r->p == '}') { r->p++; return; }
            r->err = true; return;
        }
    }
    if (*r->p == '[') {
        r->p++;
        j_ws(r);
        if (*r->p == ']') { r->p++; return; }
        for (;;) {
            j_value(r);
            if (r->err) return;
            j_ws(r);
            if (*r->p == ',') { r->p++; continue; }
            if (*r->p == ']') { r->p++; return; }
            r->err = true; return;
        }
    }
    j_skip_scalar(r);
}

/* --------------------------------------------------------------------------
 * Extraccion de identidades de infrastructure/mosquitto/identities.json
 * -------------------------------------------------------------------------- */

#define MAX_IDS 64
#define NAMELEN 96

typedef struct {
    char username[NAMELEN];
    char module_id[NAMELEN];
} identity_pair;

typedef struct {
    identity_pair modules[MAX_IDS];
    size_t        n_modules;
    char          services[MAX_IDS][NAMELEN];
    size_t        n_services;
    bool          identity_equals_module_id;
    bool          saw_flag;
    bool          ok;
} identities;

/* Parsea el objeto raiz buscando las claves "modules", "service_identities" y
 * "identity_equals_module_id" EN EL NIVEL RAIZ. Cualquier otra clave se salta
 * con j_value(), que respeta anidamiento y cadenas. */
static void parse_identities(const char *text, identities *out)
{
    memset(out, 0, sizeof(*out));
    jr r = { text, false };
    j_ws(&r);
    if (*r.p != '{') return;
    r.p++;
    j_ws(&r);
    if (*r.p == '}') { out->ok = true; return; }

    for (;;) {
        char key[NAMELEN];
        j_string(&r, key, sizeof(key));
        j_ws(&r);
        if (r.err || *r.p != ':') return;
        r.p++;
        j_ws(&r);

        if (strcmp(key, "modules") == 0 && *r.p == '[') {
            r.p++;
            j_ws(&r);
            while (*r.p != ']') {
                j_ws(&r);
                if (*r.p != '{') return;
                r.p++;
                identity_pair pair;
                memset(&pair, 0, sizeof(pair));
                j_ws(&r);
                while (*r.p != '}') {
                    char k[NAMELEN];
                    j_string(&r, k, sizeof(k));
                    j_ws(&r);
                    if (r.err || *r.p != ':') return;
                    r.p++;
                    j_ws(&r);
                    if (strcmp(k, "username") == 0 && *r.p == '"')
                        j_string(&r, pair.username, sizeof(pair.username));
                    else if (strcmp(k, "module_id") == 0 && *r.p == '"')
                        j_string(&r, pair.module_id, sizeof(pair.module_id));
                    else
                        j_value(&r);
                    if (r.err) return;
                    j_ws(&r);
                    if (*r.p == ',') { r.p++; j_ws(&r); }
                }
                r.p++;
                if (out->n_modules < MAX_IDS) out->modules[out->n_modules++] = pair;
                j_ws(&r);
                if (*r.p == ',') { r.p++; j_ws(&r); }
            }
            r.p++;
        } else if (strcmp(key, "service_identities") == 0 && *r.p == '{') {
            r.p++;
            j_ws(&r);
            while (*r.p != '}') {
                char svc[NAMELEN];
                j_string(&r, svc, sizeof(svc));
                j_ws(&r);
                if (r.err || *r.p != ':') return;
                r.p++;
                j_value(&r);
                if (r.err) return;
                if (out->n_services < MAX_IDS)
                    snprintf(out->services[out->n_services++], NAMELEN, "%s", svc);
                j_ws(&r);
                if (*r.p == ',') { r.p++; j_ws(&r); }
            }
            r.p++;
        } else if (strcmp(key, "identity_equals_module_id") == 0) {
            out->saw_flag = true;
            out->identity_equals_module_id = (strncmp(r.p, "true", 4) == 0);
            j_skip_scalar(&r);
        } else {
            j_value(&r);
        }
        if (r.err) return;
        j_ws(&r);
        if (*r.p == ',') { r.p++; j_ws(&r); continue; }
        if (*r.p == '}') { out->ok = true; return; }
        return;
    }
}

/* --------------------------------------------------------------------------
 * Extraccion de usuarios del ACL de Mosquitto.
 * La gramatica del acl ES por lineas: `user <nombre>` abre una seccion. Aqui
 * contar lineas no es "contar texto": es leer el formato en sus propios
 * terminos. Los comentarios (#) se descartan explicitamente.
 * -------------------------------------------------------------------------- */

typedef struct {
    char   users[MAX_IDS][NAMELEN];
    size_t n;
} userset;

static bool userset_has(const userset *s, const char *name)
{
    for (size_t i = 0; i < s->n; ++i)
        if (strcmp(s->users[i], name) == 0) return true;
    return false;
}

static void userset_add(userset *s, const char *name)
{
    if (userset_has(s, name) || s->n >= MAX_IDS) return;
    snprintf(s->users[s->n++], NAMELEN, "%s", name);
}

static void parse_acl_users(const char *text, userset *out)
{
    memset(out, 0, sizeof(*out));
    const char *p = text;
    while (*p) {
        const char *eol = strchr(p, '\n');
        size_t len = eol ? (size_t)(eol - p) : strlen(p);

        char line[512];
        size_t n = len < sizeof(line) - 1 ? len : sizeof(line) - 1;
        memcpy(line, p, n);
        line[n] = '\0';

        char *hash = strchr(line, '#');
        if (hash) *hash = '\0';

        char *s = line;
        while (*s == ' ' || *s == '\t') s++;
        if (strncmp(s, "user", 4) == 0 && (s[4] == ' ' || s[4] == '\t')) {
            s += 4;
            while (*s == ' ' || *s == '\t') s++;
            char *e = s;
            while (*e && *e != ' ' && *e != '\t' && *e != '\r') e++;
            *e = '\0';
            if (*s) userset_add(out, s);
        }

        if (!eol) break;
        p = eol + 1;
    }
}

/* users.generated.txt: un usuario por linea, '#' comenta. */
static void parse_users_file(const char *text, userset *out)
{
    memset(out, 0, sizeof(*out));
    const char *p = text;
    while (*p) {
        const char *eol = strchr(p, '\n');
        size_t len = eol ? (size_t)(eol - p) : strlen(p);
        char line[512];
        size_t n = len < sizeof(line) - 1 ? len : sizeof(line) - 1;
        memcpy(line, p, n);
        line[n] = '\0';
        char *hash = strchr(line, '#');
        if (hash) *hash = '\0';
        char *s = line;
        while (*s == ' ' || *s == '\t') s++;
        char *e = s;
        while (*e && *e != ' ' && *e != '\t' && *e != '\r') e++;
        *e = '\0';
        if (*s) userset_add(out, s);
        if (!eol) break;
        p = eol + 1;
    }
}

/* --------------------------------------------------------------------------
 * Suite
 * -------------------------------------------------------------------------- */

static void suite_identity_coherence(void)
{
    SECTION("F-02 · identidad MQTT: firmware == contrato == identities.json == acl");

    size_t n_json = 0, n_acl = 0, n_users = 0;
    char *json  = slurp("infrastructure/mosquitto/identities.json", &n_json);
    char *acl   = slurp("infrastructure/mosquitto/acl", &n_acl);
    char *users = slurp("infrastructure/mosquitto/users.generated.txt", &n_users);

    CHECK(json != NULL, "identities.json legible desde el arbol de trabajo");
    CHECK(acl != NULL, "acl de Mosquitto legible desde el arbol de trabajo");
    CHECK(users != NULL, "users.generated.txt legible desde el arbol de trabajo");
    if (!json || !acl || !users) { free(json); free(acl); free(users); return; }

    identities ids;
    parse_identities(json, &ids);
    CHECK(ids.ok, "identities.json parseado como JSON completo");
    CHECK(ids.n_modules > 0, "identities.json declara al menos un modulo");
    CHECK(ids.saw_flag && ids.identity_equals_module_id,
          "identities.json declara identity_equals_module_id=true");

    userset acl_users, file_users;
    parse_acl_users(acl, &acl_users);
    parse_users_file(users, &file_users);
    CHECK(acl_users.n > 0, "el acl declara reglas `user <nombre>`");

    /* --- El nucleo de la prueba: la funcion del firmware, EJECUTADA -------- */
    size_t matched = 0;
    for (size_t i = 0; i < ids.n_modules; ++i) {
        const identity_pair *m = &ids.modules[i];

        char produced[DIANA_MQTT_USER_MAXLEN];
        int rc = diana_mqtt_username(m->module_id, produced, sizeof(produced));

        char desc[192];
        snprintf(desc, sizeof(desc), "%s: el firmware acepta el module_id", m->module_id);
        CHECK_EQ_INT(rc, DIANA_MQTT_OK, desc);
        if (rc != DIANA_MQTT_OK) continue;

        /* (1) == (3): lo que construye el firmware es el username declarado. */
        snprintf(desc, sizeof(desc), "%s: usuario del firmware == identities.json", m->module_id);
        CHECK_EQ_STR(produced, m->username, desc);

        /* (2): la regla del contrato §8, sin prefijo, literal. */
        snprintf(desc, sizeof(desc), "%s: usuario == module_id (contrato §8, F-02)", m->module_id);
        CHECK_EQ_STR(produced, m->module_id, desc);

        /* (4): ese usuario existe de verdad en el acl y en users.generated.txt.
         * Con el prefijo `module-` esto era imposible: "module-module-01" no
         * esta autorizado en ninguna regla, y el modulo no autenticaria jamas. */
        snprintf(desc, sizeof(desc), "%s: el acl autoriza al usuario del firmware", m->module_id);
        CHECK(userset_has(&acl_users, produced), desc);

        snprintf(desc, sizeof(desc), "%s: users.generated.txt contiene ese usuario", m->module_id);
        CHECK(userset_has(&file_users, produced), desc);

        if (userset_has(&acl_users, produced)) matched++;
    }
    CHECK_EQ_INT(matched, ids.n_modules,
                 "todos los modulos de identities.json quedan autorizados");

    /* Sin huecos en el otro sentido: cada `user` del acl que no sea un servicio
     * declarado tiene que ser un module_id que el firmware sepa construir. Asi
     * un modulo anadido al broker y olvidado en identities.json tambien duele. */
    size_t orphans = 0;
    for (size_t i = 0; i < acl_users.n; ++i) {
        const char *u = acl_users.users[i];
        bool is_service = false;
        for (size_t s = 0; s < ids.n_services; ++s)
            if (strcmp(u, ids.services[s]) == 0) is_service = true;
        if (is_service) continue;

        bool known = false;
        for (size_t m = 0; m < ids.n_modules; ++m)
            if (strcmp(u, ids.modules[m].username) == 0) known = true;
        if (!known) orphans++;
    }
    CHECK_EQ_INT(orphans, 0, "el acl no autoriza usuarios ajenos a identities.json");

    free(json); free(acl); free(users);
}

static void suite_username_rules(void)
{
    SECTION("usuario MQTT · reglas de construccion");

    char u[DIANA_MQTT_USER_MAXLEN];

    CHECK_EQ_INT(diana_mqtt_username("module-01", u, sizeof(u)), DIANA_MQTT_OK, "acepta module-01");
    CHECK_EQ_STR(u, "module-01", "copia literal, sin decorar");

    CHECK_EQ_INT(diana_mqtt_username(NULL, u, sizeof(u)), DIANA_MQTT_ERR_INVALID, "rechaza NULL");
    CHECK_EQ_STR(u, "", "deja el buffer vacio al rechazar");
    CHECK_EQ_INT(diana_mqtt_username("", u, sizeof(u)), DIANA_MQTT_ERR_INVALID, "rechaza vacio");
    CHECK_EQ_INT(diana_mqtt_username("mod ule", u, sizeof(u)), DIANA_MQTT_ERR_INVALID, "rechaza espacios");
    CHECK_EQ_INT(diana_mqtt_username("a/b", u, sizeof(u)), DIANA_MQTT_ERR_INVALID, "rechaza '/'");
    CHECK_EQ_INT(diana_mqtt_username("a+b", u, sizeof(u)), DIANA_MQTT_ERR_INVALID, "rechaza comodin '+'");
    CHECK_EQ_INT(diana_mqtt_username("a#b", u, sizeof(u)), DIANA_MQTT_ERR_INVALID, "rechaza comodin '#'");
    CHECK_EQ_INT(diana_mqtt_username("a:b", u, sizeof(u)), DIANA_MQTT_ERR_INVALID, "rechaza ':'");

    char small[5];
    CHECK_EQ_INT(diana_mqtt_username("module-01", small, sizeof(small)),
                 DIANA_MQTT_ERR_SPACE, "no trunca una identidad que no cabe");
    CHECK_EQ_STR(small, "", "buffer vacio tras ERR_SPACE");
}

static void suite_transport(void)
{
    SECTION("P0-2 · transporte: mqtts por defecto, puerto configurable");

    char uri[DIANA_MQTT_URI_MAXLEN];

    CHECK_EQ_INT(diana_mqtt_uri("broker.local", 8883, DIANA_MQTT_TRANSPORT_TLS, uri, sizeof(uri)),
                 DIANA_MQTT_OK, "construye la URI TLS");
    CHECK_EQ_STR(uri, "mqtts://broker.local:8883", "TLS -> mqtts:// con el puerto pedido");

    CHECK_EQ_INT(diana_mqtt_uri("192.168.1.209", 18883, DIANA_MQTT_TRANSPORT_TLS, uri, sizeof(uri)),
                 DIANA_MQTT_OK, "puerto no estandar aceptado");
    CHECK_EQ_STR(uri, "mqtts://192.168.1.209:18883", "el puerto es configurable, no 1883 fijo");

    /* El valor 0 del enum (el que sale de cualquier struct a cero, y de una
     * variable sin inicializar puesta a 0) tiene que ser el seguro. */
    diana_mqtt_transport zero = (diana_mqtt_transport)0;
    CHECK_EQ_INT(diana_mqtt_uri("h", 8883, zero, uri, sizeof(uri)), DIANA_MQTT_OK, "transporte 0 valido");
    CHECK_EQ_STR(uri, "mqtts://h:8883", "el transporte por defecto (0) es TLS, no plaintext");

    CHECK_EQ_INT(diana_mqtt_uri("h", 1883, DIANA_MQTT_TRANSPORT_INSECURE_LAB, uri, sizeof(uri)),
                 DIANA_MQTT_OK, "el perfil de banco construye URI");
    CHECK_EQ_STR(uri, "mqtt://h:1883", "solo el perfil EXPLICITO produce mqtt://");

    CHECK_EQ_INT(diana_mqtt_uri(NULL, 8883, DIANA_MQTT_TRANSPORT_TLS, uri, sizeof(uri)),
                 DIANA_MQTT_ERR_INVALID, "rechaza host NULL");
    CHECK_EQ_INT(diana_mqtt_uri("", 8883, DIANA_MQTT_TRANSPORT_TLS, uri, sizeof(uri)),
                 DIANA_MQTT_ERR_INVALID, "rechaza host vacio");
    CHECK_EQ_INT(diana_mqtt_uri("mqtt://h", 8883, DIANA_MQTT_TRANSPORT_TLS, uri, sizeof(uri)),
                 DIANA_MQTT_ERR_INVALID, "rechaza un host que ya trae esquema");
    CHECK_EQ_INT(diana_mqtt_uri("h", 0, DIANA_MQTT_TRANSPORT_TLS, uri, sizeof(uri)),
                 DIANA_MQTT_ERR_INVALID, "rechaza puerto 0");
    CHECK_EQ_INT(diana_mqtt_uri("h", 8883, (diana_mqtt_transport)7, uri, sizeof(uri)),
                 DIANA_MQTT_ERR_INVALID, "rechaza un transporte desconocido");

    char tiny[8];
    CHECK_EQ_INT(diana_mqtt_uri("broker.local", 8883, DIANA_MQTT_TRANSPORT_TLS, tiny, sizeof(tiny)),
                 DIANA_MQTT_ERR_SPACE, "no trunca la URI");
}

/* Una CA de juguete, sintacticamente valida. No se usa para conectar con nada:
 * solo ejercita el guardian de forma cerrada. */
static const char CA_OK[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIIBkTCB+wIJAK0000000000MA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNVBAMMCWRp\n"
    "YW5hLXRlc3QwHhcNMjUwMTAxMDAwMDAwWhcNMzUwMTAxMDAwMDAwWjAUMRIwEAYD\n"
    "VQQDDAlkaWFuYS10ZXN0MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBAL0000000000\n"
    "-----END CERTIFICATE-----\n";

static void suite_fail_closed(void)
{
    SECTION("P0-2 · fallo cerrado: sin CA valida no hay MQTT");

    CHECK(diana_mqtt_ca_is_valid(CA_OK, sizeof(CA_OK)), "acepta un PEM con BEGIN/END y cuerpo");
    CHECK(!diana_mqtt_ca_is_valid(NULL, 0), "rechaza CA nula");
    CHECK(!diana_mqtt_ca_is_valid("", 1), "rechaza CA vacia");

    /* Un buffer largo de basura sin delimitadores: la longitud no basta. */
    char junk[512];
    memset(junk, 'x', sizeof(junk) - 1);
    junk[sizeof(junk) - 1] = '\0';
    CHECK(!diana_mqtt_ca_is_valid(junk, sizeof(junk)), "rechaza relleno sin delimitadores PEM");

    char headless[512];
    snprintf(headless, sizeof(headless),
             "%s", "-----BEGIN CERTIFICATE----------END CERTIFICATE-----"
                   "                                                    "
                   "                                                    ");
    CHECK(!diana_mqtt_ca_is_valid(headless, strlen(headless) + 1),
          "rechaza un PEM con delimitadores pegados y sin cuerpo");

    /* Sin NUL final: entregarselo a esp-mqtt seria leer fuera del buffer. */
    char nonul[256];
    memset(nonul, 'A', sizeof(nonul));
    memcpy(nonul, "-----BEGIN CERTIFICATE-----", 27);
    CHECK(!diana_mqtt_ca_is_valid(nonul, sizeof(nonul)), "rechaza un PEM sin terminador NUL");

    SECTION("P0-2 · decision de arranque (diana_mqtt_may_connect)");

    CHECK(diana_mqtt_may_connect(DIANA_MQTT_TRANSPORT_TLS, CA_OK, sizeof(CA_OK), "module-01"),
          "TLS + CA valida + identidad -> conecta");
    CHECK(!diana_mqtt_may_connect(DIANA_MQTT_TRANSPORT_TLS, NULL, 0, "module-01"),
          "TLS sin CA -> NO conecta (no degrada a plaintext)");
    CHECK(!diana_mqtt_may_connect(DIANA_MQTT_TRANSPORT_TLS, junk, sizeof(junk), "module-01"),
          "TLS con CA invalida -> NO conecta");
    CHECK(!diana_mqtt_may_connect(DIANA_MQTT_TRANSPORT_TLS, CA_OK, sizeof(CA_OK), ""),
          "TLS sin identidad -> NO conecta");
    CHECK(!diana_mqtt_may_connect((diana_mqtt_transport)7, CA_OK, sizeof(CA_OK), "module-01"),
          "transporte desconocido -> NO conecta");
    CHECK(diana_mqtt_may_connect(DIANA_MQTT_TRANSPORT_INSECURE_LAB, NULL, 0, "module-01"),
          "el perfil de banco no exige CA (pero hay que pedirlo en Kconfig)");
}

int run_mqtt_endpoint(void)
{
    TEST_SUITE("mqtt_endpoint");
    suite_identity_coherence();
    suite_username_rules();
    suite_transport();
    suite_fail_closed();
    return g_tests_failed;
}
