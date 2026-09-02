#!/usr/bin/env python3
"""DEVICE_MANAGEMENT_COMMAND_PATH = UNIQUE, fijado sobre el codigo.

Afirmar que "no hay otro camino" es facil de escribir y facil de romper sin
enterarse. La version anterior de este guardian lo intentaba con expresiones
regulares y una supervision independiente la evadio por TRES vias triviales,
todas con la suite entera en verde:

  a) kv_set(..., "diana_prov", ...) con el literal en vez de la macro;
  b) kv_set_str(hal, DIANA_PROV_NVS_NS, ...), un envoltorio que ya existia en
     el arbol y que el patron `kv_set\\s*\\(` no reconocia;
  c) un fichero en otro componente con el MISMO nombre base, porque se
     comparaban nombres (p.name) en vez de rutas.

La leccion no es "mejor regex". Es que una propiedad estructural no puede
depender de detectar al infractor. Por eso la proteccion es ahora, en este
orden:

  1. ENCAPSULACION. El espacio NVS de la autoridad ya no es publico: vive en
     components/diana_core/src/prov_nvs.h. Fuera de diana_core nadie puede
     NOMBRARLO, y nombrarlo es la capacidad de escribir en el. La unica via
     desde fuera es diana_prov_factory_read(), que es de solo lectura.
  2. Este analizador, que comprueba que la encapsulacion sigue en pie y que el
     camino de entrada sigue siendo uno. Trabaja sobre RUTAS, resuelve las
     macros hasta su valor y sigue los envoltorios; no busca una forma de
     escribir una llamada.

Propiedades comprobadas:

  P1  El VALOR del espacio de autoridad solo aparece en diana_core.
  P2  La cabecera privada solo se incluye desde diana_core.
  P3  Nadie fuera de diana_core escribe ese espacio, ni directamente ni a
      traves de un envoltorio.
  P4  El plano tiene UN solo punto de entrada desde el runtime, y por la
      puerta correcta (diana_prov_message, no diana_prov_handle).
  P5  El interceptor se ejecuta ANTES del despacho de juego y corta el flujo.

Las tres evasiones de la supervision son ahora mutaciones permanentes: cada una
tiene que poner esto en rojo. Se comprueban con --autotest.
"""
import re, sys, pathlib

FW = pathlib.Path(__file__).resolve().parents[1]
NUCLEO_DIR = FW / "components/diana_core"
PRIV = NUCLEO_DIR / "src/prov_nvs.h"
DESPACHO = FW / "main/app_commands.c"

# Nombre del espacio NVS de la autoridad, leido de la cabecera privada. No se
# escribe aqui a mano: si alguien lo renombra, esto lo sigue.
def valor_espacio() -> str:
    m = re.search(r'#define\s+DIANA_PROV_NVS_NS\s+"([^"]+)"',
                  PRIV.read_text(encoding="utf8"))
    if not m:
        raise SystemExit("no encuentro DIANA_PROV_NVS_NS en %s" % PRIV)
    return m.group(1)

def ficheros(exts=(".c", ".h")):
    """Solo arboles de FUENTE. `build/` contiene generados y enlaces rotos de
    ESP-IDF; `diagnostics/` es otro proyecto; test_host es codigo de prueba con
    acceso privado DECLARADO (simula corrupcion del estado persistido)."""
    for base in ("components", "main"):
        for p in sorted((FW / base).rglob("*")):
            if p.suffix not in exts or not p.is_file():
                continue
            if "build" in p.parts or "test_host" in p.parts:
                continue
            yield p

def rel(p: pathlib.Path) -> str:
    return str(p.relative_to(FW))

def codigo(p: pathlib.Path) -> str:
    """Sin comentarios: un comentario que menciona kv_set no escribe nada."""
    t = p.read_text(encoding="utf8", errors="ignore")
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', t)

def es_nucleo(p: pathlib.Path) -> bool:
    """Por RUTA, no por nombre. Un fichero llamado igual en otro componente NO
    es el nucleo: esa colision de nombre base era una de las evasiones."""
    return NUCLEO_DIR in p.parents

def macros_del_espacio(espacio: str):
    """Todo identificador que se expanda al valor del espacio, en cualquier
    cabecera del arbol. Asi da igual que se use la macro o el literal: las dos
    formas quedan reducidas al mismo hecho -- el fichero nombra el recurso."""
    nombres = set()
    for p in ficheros((".h",)):
        for m in re.finditer(r'#define\s+(\w+)\s+"([^"]*)"', p.read_text(encoding="utf8", errors="ignore")):
            if m.group(2) == espacio:
                nombres.add(m.group(1))
    return nombres

def argumentos(texto: str, pos: int):
    """Lista de argumentos de la llamada que empieza en `pos` (indice del '('),
    con parentesis EQUILIBRADOS. La version anterior usaba `[^;]*`, que se
    perdia en cuanto habia una llamada anidada o un ';' dentro."""
    prof, ini, args = 0, pos + 1, []
    i = pos
    while i < len(texto):
        ch = texto[i]
        if ch == '(':
            prof += 1
        elif ch == ')':
            prof -= 1
            if prof == 0:
                args.append(texto[ini:i]); return args, i
        elif ch == ',' and prof == 1:
            args.append(texto[ini:i]); ini = i + 1
        i += 1
    return args, len(texto)

def llamadas(texto: str):
    """(nombre, [argumentos]) de cada llamada del fichero."""
    for m in re.finditer(r'\b(\w+)\s*\(', texto):
        args, fin = argumentos(texto, m.end() - 1)
        yield m.group(1), args

def analizar(espacio: str):
    fallos = []
    tokens = macros_del_espacio(espacio) | {'"%s"' % espacio}

    def nombra_espacio(arg: str) -> bool:
        a = arg.strip()
        if '"%s"' % espacio in a:
            return True
        return any(re.search(r'\b%s\b' % re.escape(t), a) for t in tokens if not t.startswith('"'))

    # --- P1 y P3: quien puede nombrar el espacio, y quien escribe en el ------
    #
    # Escribir requiere nombrar. Se recogen las dos cosas por separado para que
    # el diagnostico diga cual de las dos se rompio.
    nombradores, escritores = [], []
    for p in ficheros((".c",)):
        c = codigo(p)
        if not any(nombra_espacio(c) for _ in (0,)) and not any(
                re.search(r'\b%s\b' % re.escape(t), c) for t in tokens if not t.startswith('"')) \
           and '"%s"' % espacio not in c:
            continue
        nombradores.append(rel(p))
        # Envoltorios: cualquier funcion cuyo nombre contenga kv_set o set_str y
        # reciba el espacio como argumento. No se busca UNA forma de escribir:
        # se busca que el recurso viaje a una llamada de escritura.
        for nombre, args in llamadas(c):
            if not any(nombra_espacio(a) for a in args):
                continue
            if re.search(r'(^|_)(kv_)?set(_|$)|write|save|store|erase', nombre, re.I):
                escritores.append(rel(p))
                break

    fuera_nucleo = [f for f in sorted(set(nombradores))
                    if not es_nucleo(FW / f)]
    if fuera_nucleo:
        fallos.append("nombran el espacio de la autoridad fuera de diana_core: %s. "
                      "El espacio es privado (src/prov_nvs.h): nombrarlo ES poder "
                      "escribir en el. Para leer material de fabrica esta "
                      "diana_prov_factory_read()." % fuera_nucleo)

    escritores = sorted(set(escritores))
    if escritores != ["components/diana_core/src/provisioning.c"]:
        fallos.append("escriben el espacio NVS de la autoridad: %s. Debe ser solo "
                      "components/diana_core/src/provisioning.c, y solo por "
                      "diana_prov_save()." % (escritores or "nadie"))

    # --- P2: la cabecera privada no se filtra fuera del nucleo ---------------
    filtran = [rel(p) for p in ficheros()
               if not es_nucleo(p) and re.search(r'#\s*include\s*[<"][^">]*prov_nvs\.h', codigo(p))]
    if filtran:
        fallos.append("incluyen la cabecera PRIVADA prov_nvs.h fuera de diana_core: "
                      "%s. Eso reabre la capacidad de escribir en la autoridad." % filtran)

    # --- P4: un unico punto de entrada, por la puerta correcta ---------------
    #
    # components/diana_core/src es la IMPLEMENTACION de la cadena: prov_parse.c
    # define diana_prov_message() y encadena a diana_prov_handle(). Eso no es un
    # bypass. Lo seria que el runtime llamase a diana_prov_handle() saltandose
    # el parser.
    fuera, directos = [], []
    for p in ficheros((".c",)):
        if es_nucleo(p):
            continue
        c = codigo(p)
        for nombre, _ in llamadas(c):
            if nombre == "diana_prov_message":
                fuera.append(rel(p))
            elif nombre == "diana_prov_handle":
                directos.append(rel(p))
    fuera = sorted(set(fuera))
    if fuera != ["main/app_provision.c"]:
        fallos.append("entran al plano desde fuera del nucleo: %s. Debe haber UN "
                      "solo punto de entrada (main/app_provision.c)." % (fuera or "ningun sitio"))
    if directos:
        fallos.append("llaman a diana_prov_handle() DIRECTAMENTE desde fuera del "
                      "nucleo: %s. Eso salta el parser; hay que entrar por "
                      "diana_prov_message()." % sorted(set(directos)))

    # --- P5: el interceptor, antes del despacho de juego y cortando ----------
    d = codigo(DESPACHO)
    m = re.search(r'void\s+diana_handle_message\s*\([^)]*\)\s*\{', d)
    if not m:
        fallos.append("no encuentro diana_handle_message")
    else:
        cuerpo = d[m.end():]
        icept = cuerpo.find("diana_prov_app_handle")
        parse = re.search(r'cJSON_Parse\w*\s*\(', cuerpo)
        if icept < 0:
            fallos.append("diana_handle_message NO llama a diana_prov_app_handle: "
                          "una orden de DEVICE_MANAGEMENT entraria por el canal de juego")
        elif parse and icept > parse.start():
            fallos.append("el interceptor de DEVICE_MANAGEMENT va DESPUES del parseo "
                          "del canal de juego: debe ir antes")
        elif not re.search(r'if\s*\(\s*diana_prov_app_handle\s*\([^)]*\)\s*\)\s*return\s*;', cuerpo):
            fallos.append("el interceptor no corta el flujo: debe ser "
                          "`if (diana_prov_app_handle(...)) return;`")
    return fallos

def main(argv) -> int:
    espacio = valor_espacio()
    fallos = analizar(espacio)
    if fallos:
        print("D1b camino unico: %d FALLOS" % len(fallos))
        for f in fallos: print("  FALLO %s" % f)
        return 1
    print("D1b camino unico: encapsulacion, persistencia, entrada e interceptor  ok")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
