#!/usr/bin/env python3
"""C-1 · la CA del broker no puede degradarse en silencio, y C-2 · el camino de
conexion distingue la capa que falla.

POR QUE HACE FALTA ESTO ADEMAS DE LAS PRUEBAS EN C
--------------------------------------------------
La suite de host EJECUTA diana_mqtt_ca_fingerprint() y
diana_mqtt_ca_is_declared() -- ahi es donde se demuestra que la huella es la de
openssl y que un certificado no declarado no autoriza nada. Esa parte es
falsable por comportamiento y no se repite aqui.

Lo que aqui se cubre es la zona ciega: main/app_main.c y mqtt_client.c NO se
compilan con gcc (necesitan ESP-IDF), y son justamente los que deciden si se
conecta y los que escriben lo que el operador leera en el banco. Ademas se
comprueba el CONTENIDO de main/certs/, que ninguna prueba de comportamiento
mira: el estado del arbol.

QUE SE PUEDE AFIRMAR CON ESTO, Y QUE NO
---------------------------------------
SE PUEDE: que en el arbol ACTUAL el PEM empotrado y su declaracion cuentan la
misma historia; que ningun certificado de ejemplo conocido esta plantado; que
el arranque pasa por la puerta de declaracion y que la rama negativa CORTA; y
que el camino de conexion emite un mensaje propio por capa.

NO SE PUEDE: que la CA declarada sea la del broker de produccion. Eso solo lo
demuestra el handshake contra el broker vivo -- PENDING_PHYSICAL_VALIDATION.
Tampoco se puede afirmar que sea imposible escribir un bypass: no hay AST.

RESIDUAL DECLARADO: la CORRESPONDENCIA entre la CA declarada y el broker real
solo se cierra en el banco.
"""
import base64
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FW = os.path.dirname(HERE)                       # firmware/esp32
CERTS = os.path.join(FW, "main/certs")
PEM = os.path.join(CERTS, "broker_ca.pem")
DECL = os.path.join(CERTS, "broker_ca.sha256")
APP_MAIN = os.path.join(FW, "main/app_main.c")
MQTT_CLIENT = os.path.join(FW, "components/diana_platform_esp/src/mqtt_client.c")

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


def strip_comments(src):
    """Codigo C sin comentarios, CONSERVANDO los literales. Igual criterio que
    check_mqtt_tls.py: buscar texto en el fuente crudo confundiria un ejemplo
    citado en un comentario con codigo real."""
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


def bloque_tras(codigo, pos):
    """Cuerpo { ... } que sigue a `pos`, con llaves equilibradas. Se mira QUE
    HACE la rama, no si cierto texto aparece cerca: sustituir un `return` por
    un ESP_LOGW dejaria verde cualquier comprobacion de presencia."""
    ini = codigo.find("{", pos)
    if ini == -1:
        return ""
    prof, i = 0, ini
    while i < len(codigo):
        if codigo[i] == "{":
            prof += 1
        elif codigo[i] == "}":
            prof -= 1
            if prof == 0:
                return codigo[ini:i + 1]
        i += 1
    return ""


def condicion_de(codigo, pos):
    ap = codigo.rfind("if", 0, pos)
    if ap == -1:
        return ""
    ini = codigo.find("(", ap)
    if ini == -1:
        return ""
    prof, i = 0, ini
    while i < len(codigo):
        if codigo[i] == "(":
            prof += 1
        elif codigo[i] == ")":
            prof -= 1
            if prof == 0:
                return codigo[ini:i + 1]
        i += 1
    return ""


# ---------------------------------------------------------------------------
# Certificados de ejemplo conocidos. La lista NO es la defensa -- la defensa es
# la declaracion, que rechaza CUALQUIER certificado no declarado, conocido o no.
# Esto es un segundo cinturon que nombra al culpable cuando el culpable es uno
# de los sospechosos habituales, para que el mensaje diga "esto es el snakeoil
# de Debian" en vez de "huella distinta".
#
# Se buscan como CADENAS DENTRO DEL DER: el subject y el issuer viajan ahi como
# texto, asi que un certificado de tutorial se delata por su propio nombre sin
# necesidad de un parser ASN.1.
# ---------------------------------------------------------------------------
MARCADORES_EJEMPLO = [
    b"snakeoil",
    b"Internet Widgits Pty Ltd",   # el default de `openssl req` sin -subj
    b"test.mosquitto.org",
    b"mosquitto.org",
    b"example.com",
    b"example.org",
    b"Example CA",
    b"localhost",
    b"changeme",
    b"DO NOT TRUST",
    b"Test CA",
    b"Dummy",
]


def pem_der(texto):
    """DER del primer bloque PEM, o None si no hay uno decodificable."""
    m = re.search(r"-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----",
                  texto, re.S)
    if not m:
        return None
    try:
        return base64.b64decode("".join(m.group(1).split()), validate=True)
    except Exception:
        return None


def main():
    print("--- C-1/C-2: CA declarada y diagnostico por capas ---")

    # ---- 1 · los dos ficheros existen -------------------------------------
    check(os.path.isfile(PEM), "existe main/certs/broker_ca.pem")
    check(os.path.isfile(DECL),
          "existe main/certs/broker_ca.sha256 (la DECLARACION)",
          "sin declaracion no hay nada contra lo que comparar")
    if not (os.path.isfile(PEM) and os.path.isfile(DECL)):
        print("BROKER_CA: %d comprobaciones, %d fallidas" % (checks, len(failures)))
        return 1

    pem_txt = open(PEM, encoding="utf-8", errors="replace").read()
    decl_raw = open(DECL, encoding="utf-8", errors="replace").read()
    decl = decl_raw.strip()

    # ---- 2 · la declaracion esta en uno de los dos estados legales ---------
    es_none = (decl == "NONE")
    es_hex = bool(re.fullmatch(r"[0-9a-f]{64}", decl))
    check(es_none or es_hex,
          "la declaracion es 'NONE' o 64 cifras hex en minusculas",
          "encontrado: %r" % decl[:80])
    check(":" not in decl,
          "la declaracion NO lleva el formato con ':' de openssl",
          "usa `sed 's/://g' | tr A-Z a-z`")

    der = pem_der(pem_txt)
    hay_pem = der is not None

    # ---- 3 · PEM y declaracion cuentan la MISMA historia -------------------
    # Este es el corazon de C-1: el estado prohibido es "hay certificado y la
    # declaracion sigue diciendo que no hay ninguno". Es exactamente lo que
    # ocurre cuando alguien planta un certificado para que el modulo arranque.
    check(not (es_none and hay_pem),
          "declaracion NONE => no hay ningun PEM plantado en broker_ca.pem",
          "hay un certificado empotrado y NADIE ha declarado cual es")

    check(not (es_hex and not hay_pem),
          "declaracion con huella => broker_ca.pem contiene ese certificado",
          "se declara una huella pero el fichero no es un PEM decodificable")

    if hay_pem and es_hex:
        real = hashlib.sha256(der).hexdigest()
        check(real == decl,
              "la huella real del PEM coincide con la declarada",
              "real=%s declarada=%s" % (real, decl))

    # ---- 4 · ningun certificado de ejemplo conocido ------------------------
    if hay_pem:
        encontrados = [m.decode() for m in MARCADORES_EJEMPLO if m in der]
        check(not encontrados,
              "el certificado empotrado no es un ejemplo conocido",
              "aparece en el DER: " + ", ".join(encontrados))
    else:
        check(True, "no hay PEM que inspeccionar (estado NONE, marcador)")

    # ---- 5 · los dos ficheros VIAJAN en la imagen --------------------------
    cml = open(os.path.join(FW, "main/CMakeLists.txt"), encoding="utf-8").read()
    check("certs/broker_ca.pem" in cml,
          "broker_ca.pem se empota en la imagen (EMBED_TXTFILES)")
    check("certs/broker_ca.sha256" in cml,
          "broker_ca.sha256 se empota en la imagen",
          "sin esto la declaracion no llega al modulo y la guarda es decorativa")

    # ---- 6 · el arranque pasa por la puerta de declaracion -----------------
    acode = strip_comments(open(APP_MAIN, encoding="utf-8").read())
    i_dec = acode.find("diana_mqtt_ca_is_declared")
    check(i_dec != -1,
          "app_main.c consulta diana_mqtt_ca_is_declared antes de conectar")
    check("_binary_broker_ca_sha256_start" in acode,
          "app_main.c toma la declaracion del simbolo EMPOTRADO",
          "leerla de otro sitio la desligaria del binario")

    # EFECTO, no presencia: la rama de CA no declarada no puede arrancar MQTT.
    cuerpo = bloque_tras(acode, i_dec) if i_dec != -1 else ""
    check("diana_platform_mqtt_start" not in cuerpo,
          "la rama de CA NO DECLARADA no arranca MQTT")
    check(bool(re.search(r"\bdiana_module_fsm_apply\b", cuerpo)),
          "la rama de CA NO DECLARADA lleva el modulo a error (no solo registra)",
          cuerpo.strip()[:100])
    cond = condicion_de(acode, i_dec) if i_dec != -1 else ""
    check("false" not in cond and "0 &&" not in cond,
          "la condicion de la puerta de declaracion no esta neutralizada",
          cond.strip()[:100])

    # ---- 7 · segunda capa en mqtt_client.c --------------------------------
    mcode = strip_comments(open(MQTT_CLIENT, encoding="utf-8").read())
    j_dec = mcode.find("diana_mqtt_ca_is_declared")
    j_init = mcode.find("esp_mqtt_client_init")
    check(j_dec != -1, "mqtt_client.c comprueba la declaracion")
    check(j_dec != -1 and j_init != -1 and j_dec < j_init,
          "la guarda de declaracion precede a esp_mqtt_client_init")
    cuerpo_m = bloque_tras(mcode, j_dec) if j_dec != -1 else ""
    check(bool(re.search(r"\breturn\b\s*-?\w*\s*;", cuerpo_m)),
          "la rama de CA no declarada RETORNA (no solo avisa)",
          cuerpo_m.strip()[:80])
    check("esp_mqtt_client_init" not in cuerpo_m,
          "la rama de CA no declarada NO crea el cliente")
    cond_m = condicion_de(mcode, j_dec) if j_dec != -1 else ""
    check("false" not in cond_m and "0 &&" not in cond_m,
          "la condicion de la segunda capa no esta neutralizada",
          cond_m.strip()[:80])

    # ---- 8 · C-2 · cada capa tiene un mensaje PROPIO -----------------------
    # Sin esto el banco es una adivinanza: los seis fallos se ven igual desde
    # fuera. Se exige la etiqueta EN UN LITERAL del camino de conexion.
    for etiqueta, porque in [
        ("[TCP]", "no hay socket: cable, IP, ruta o puerto"),
        ("[TLS]", "hay socket y el handshake no cuaja"),
        ("[CERT]", "la cadena no llega a la CA empotrada"),
        ("[HOSTNAME]", "el nombre no esta en el CN/SAN"),
        ("[AUTH]", "CONNACK rechaza credenciales (rc=4 / rc=135)"),
        ("[ACL]", "autenticado si, autorizado no"),
    ]:
        check(etiqueta in mcode, "se distingue la capa %-10s (%s)" % (etiqueta, porque))

    # El caso medido que motiva la tarea: una denegacion de ACL en publicacion
    # devuelve rc=0. La UNICA senal en el cliente es el PUBACK que no llega, asi
    # que el firmware tiene que contarlos. Si alguien retira el contador, el
    # fallo de ACL vuelve a ser invisible y esto se pone rojo.
    check("MQTT_EVENT_PUBLISHED" in mcode,
          "se atiende el PUBACK (MQTT_EVENT_PUBLISHED)",
          "sin el, un PUBLISH denegado por ACL es indistinguible de uno aceptado")
    check("mqtt_pub_acked" in mcode and "mqtt_pub_sent" in mcode,
          "se cuentan publicaciones entregadas y confirmadas por separado")
    check("MQTT_ERROR_TYPE_SUBSCRIBE_FAILED" in mcode,
          "se detecta el SUBACK 0x80 (ACL en suscripcion)")
    check("esp_tls_cert_verify_flags" in mcode,
          "se lee esp_tls_cert_verify_flags",
          "es lo unico que separa 'cadena mala' de 'hostname malo'")
    check("connect_return_code" in mcode,
          "se lee el codigo de CONNACK (autenticacion)")

    print("BROKER_CA: %d comprobaciones estructurales, %d fallidas"
          % (checks, len(failures)))
    if failures:
        print("residual declarado: que la CA declarada sea la del broker real "
              "solo se cierra en el banco (PENDING_PHYSICAL_VALIDATION)")
        return 1
    print("CA declarada + diagnostico por capas: guarda estructural PASS "
          "(residual declarado: correspondencia con el broker real, en banco)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
