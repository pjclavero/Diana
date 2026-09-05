#!/usr/bin/env python3
"""P0-2 · el transporte MQTT no puede degradar a texto en claro, y F-02 no
puede reabrirse desde el firmware.

POR QUE HACE FALTA ESTO ADEMAS DE LAS PRUEBAS EN C
--------------------------------------------------
La suite de host EJECUTA diana_mqtt_username(), diana_mqtt_uri(),
diana_mqtt_ca_is_valid() y diana_mqtt_may_connect(): esas cuatro propiedades
son falsables por comportamiento y ahi es donde de verdad se demuestran.

Pero hay dos ficheros que NINGUNA prueba puede ejecutar, porque necesitan
ESP-IDF y no se compilan con gcc:

    main/app_main.c
    components/diana_platform_esp/src/mqtt_client.c

Y son justamente los que deciden si se conecta. El bug original vivio ahi
durante todo F-02 sin que nada se pusiera rojo. Este guardian cubre esa zona
ciega con propiedades ESTRUCTURALES sobre el codigo, no sobre el comportamiento.

QUE SE PUEDE AFIRMAR CON ESTO, Y QUE NO
---------------------------------------
SE PUEDE: que en el arbol ACTUAL ningun fichero de firmware fuera de
mqtt_endpoint.c nombra el esquema en claro, que ninguno activa un relajamiento
conocido de la verificacion TLS, y que el arranque pasa por la puerta de fallo
cerrado.

NO SE PUEDE: que sea imposible escribir un bypass. No hay AST ni analisis de
flujo; se tokeniza C para separar codigo, comentarios y literales (asi un
"mqtt://" citado en un comentario no cuenta, y uno escondido en codigo si). Un
esquema construido por concatenacion en tiempo de ejecucion se le escapa. La
defensa real contra eso es que el esquema solo se decide en UN sitio
(diana_mqtt_uri), que si esta cubierto por pruebas ejecutadas.

RESIDUAL DECLARADO: construccion dinamica del esquema fuera de diana_mqtt_uri.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FW = os.path.dirname(HERE)                       # firmware/esp32
ENDPOINT = os.path.join(FW, "components/diana_core/src/mqtt_endpoint.c")

# Ficheros de firmware que se analizan. No se toca test_host/: ahi el codigo de
# prueba nombra a proposito los casos malos.
ROOTS = [
    os.path.join(FW, "main"),
    os.path.join(FW, "components"),
    os.path.join(FW, "boards"),
]

# Ajustes de esp-mqtt / esp-tls que desactivan o ablandan la verificacion del
# servidor. Ninguno debe aparecer en el arbol, ni siquiera a false: escribirlos
# normaliza el identificador y hace que cambiarlos a true parezca inocuo.
FORBIDDEN_IDENTIFIERS = [
    "skip_cert_common_name_check",
    "use_global_ca_store",
    "esp_crt_bundle_attach",
    "crt_bundle_attach",
    "esp_tls_init_global_ca_store",
    "skip_verify",
    "MBEDTLS_SSL_VERIFY_NONE",
    "esp_tls_conn_new_sync_insecure",
]


def split_c(src):
    """Separa una unidad C en (codigo, literales). Los comentarios se tiran.

    Se recorre caracter a caracter respetando comillas y escapes, que es la
    unica forma de no confundir un // dentro de una cadena con un comentario ni
    un "mqtt://" en un comentario con codigo real.
    """
    code, lits = [], []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i += 2
            continue
        if c in '"\'':
            quote = c
            j = i + 1
            buf = []
            while j < n:
                if src[j] == '\\':
                    buf.append(src[j:j + 2])
                    j += 2
                    continue
                if src[j] == quote:
                    break
                buf.append(src[j])
                j += 1
            lits.append(("".join(buf), src.count("\n", 0, i) + 1))
            code.append(" ")
            i = j + 1
            continue
        code.append(c)
        i += 1
    return "".join(code), lits


def strip_comments(src):
    """Igual que split_c pero CONSERVA los literales en su sitio.

    Necesario para las comprobaciones que miran DENTRO de una rama concreta:
    ahi el literal es justo lo que se quiere ver, y borrarlo dejaria la rama
    vacia (y la comprobacion, verde por vacuidad -- que es peor que no tenerla).
    """
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i += 2
            continue
        if c in '"\'':
            quote = c
            out.append(c)
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    out.append(src[j:j + 2])
                    j += 2
                    continue
                out.append(src[j])
                if src[j] == quote:
                    break
                j += 1
            i = j + 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def c_sources():
    out = []
    for root in ROOTS:
        for dirpath, _dirs, files in os.walk(root):
            if "build" in dirpath.split(os.sep):
                continue
            for f in files:
                if f.endswith((".c", ".h")):
                    out.append(os.path.join(dirpath, f))
    return sorted(out)


def rel(path):
    return os.path.relpath(path, os.path.dirname(os.path.dirname(FW)))


failures = []
checks = 0


def check(ok, desc, detail=""):
    global checks
    checks += 1
    if ok:
        print("  ok    %s" % desc)
    else:
        failures.append(desc)
        print("  FALLO %s%s" % (desc, ("  -- " + detail) if detail else ""))


def main():
    sources = c_sources()
    if not sources:
        print("FALLO: no se ha encontrado ningun fuente de firmware")
        return 1

    parsed = {}
    for path in sources:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            parsed[path] = split_c(fh.read())

    # ---- 1 · ningun relajamiento de la verificacion TLS --------------------
    for ident in FORBIDDEN_IDENTIFIERS:
        hits = []
        pat = re.compile(r"\b%s\b" % re.escape(ident))
        for path, (code, _lits) in parsed.items():
            if pat.search(code):
                hits.append(rel(path))
        check(not hits, "no se usa '%s'" % ident, ", ".join(hits))

    # ---- 2 · el esquema en claro solo se nombra en mqtt_endpoint.c ---------
    # "mqtts://" es libre; lo que se acota es el esquema SIN TLS.
    plain = re.compile(r"(?<!s)mqtt://")
    offenders = []
    for path, (_code, lits) in parsed.items():
        if os.path.abspath(path) == os.path.abspath(ENDPOINT):
            continue
        for text, line in lits:
            if plain.search(text):
                offenders.append("%s:%d" % (rel(path), line))
    check(not offenders,
          "el esquema 'mqtt://' no aparece fuera de mqtt_endpoint.c",
          ", ".join(offenders))

    # ---- 3 · dentro de mqtt_endpoint.c, mqtt:// cuelga del perfil de banco -
    with open(ENDPOINT, "r", encoding="utf-8") as fh:
        endpoint_src = fh.read()
    ecode = strip_comments(endpoint_src)
    m = re.search(
        r"case\s+DIANA_MQTT_TRANSPORT_INSECURE_LAB\s*:(?P<body>.*?)break\s*;",
        ecode, re.S)
    check(m is not None,
          "diana_mqtt_uri decide el esquema en un case por transporte")
    if m:
        check('"mqtt://"' in m.group("body").replace(" ", ""),
              "'mqtt://' esta dentro del case INSECURE_LAB")
        # Fuera de ese case no puede haber otro sitio que lo produzca.
        rest = ecode[:m.start()] + ecode[m.end():]
        check(not plain.search(rest),
              "'mqtt://' no aparece en ninguna otra rama de mqtt_endpoint.c")

    tls_case = re.search(
        r"case\s+DIANA_MQTT_TRANSPORT_TLS\s*:(?P<body>.*?)break\s*;", ecode, re.S)
    check(tls_case is not None and '"mqtts://"' in tls_case.group("body").replace(" ", ""),
          "el case TLS produce 'mqtts://'")

    # ---- 4 · el arranque pasa por la puerta de fallo cerrado ---------------
    app_main = os.path.join(FW, "main/app_main.c")
    acode = strip_comments(open(app_main, encoding="utf-8").read())
    check("diana_mqtt_may_connect" in acode,
          "app_main.c consulta diana_mqtt_may_connect antes de conectar")
    check("diana_mqtt_username" in acode,
          "app_main.c construye el usuario con diana_mqtt_username")
    n_start = len(re.findall(r"\bdiana_platform_mqtt_start\s*\(", acode))
    check(n_start == 1,
          "app_main.c arranca MQTT en un unico punto",
          "encontrados %d" % n_start)

    # ---- 5 · F-02: el firmware no vuelve a decorar la identidad -----------
    # Un literal que empieza por 'module-' en app_main.c solo puede ser el
    # prefijo retirado: los module_id reales vienen de NVS, nunca del codigo.
    bad = []
    for path in (app_main, os.path.join(FW, "components/diana_platform_esp/src/mqtt_client.c"),
                 ENDPOINT):
        _c, lits = parsed.get(path, split_c(open(path, encoding="utf-8").read()))
        for text, line in lits:
            if text.startswith("module-") or "module-%" in text:
                bad.append("%s:%d '%s'" % (rel(path), line, text))
    check(not bad,
          "ningun literal reintroduce el prefijo 'module-' en la identidad",
          "; ".join(bad))

    # ---- 6 · la capa ESP exige CA cuando el esquema es mqtts -------------
    mc = os.path.join(FW, "components/diana_platform_esp/src/mqtt_client.c")
    mcode = strip_comments(open(mc, encoding="utf-8").read())
    check("diana_mqtt_ca_is_valid" in mcode,
          "mqtt_client.c valida la CA antes de crear el cliente")
    # La guarda tiene que estar ANTES de esp_mqtt_client_init: si estuviera
    # despues, ya habria un cliente configurado sin verificacion.
    i_guard = mcode.find("diana_mqtt_ca_is_valid")
    i_init = mcode.find("esp_mqtt_client_init")
    check(i_guard != -1 and i_init != -1 and i_guard < i_init,
          "la guarda de CA precede a esp_mqtt_client_init")
    check("verification.certificate" in mcode,
          "mqtt_client.c pasa una CA explicita a esp-mqtt")

    print("MQTT/TLS: %d comprobaciones estructurales, %d fallidas"
          % (checks, len(failures)))
    if failures:
        print("residual declarado: construccion dinamica del esquema fuera de "
              "diana_mqtt_uri")
        return 1
    print("P0-2 fallo cerrado + F-02 identidad: guarda estructural PASS "
          "(residual declarado: construccion dinamica del esquema)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
