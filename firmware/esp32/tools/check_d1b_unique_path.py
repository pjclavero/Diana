#!/usr/bin/env python3
"""DEVICE_MANAGEMENT_COMMAND_PATH, fijado sobre el codigo en DOS CAPAS.

Historia, porque explica el diseno. Este guardian ha sido evadido dos veces:

  4ª ronda (revision de cierre): el recurso viajando por una VARIABLE de
     ambito de fichero (invisible porque solo se miraban cuerpos de
     funcion), incluida una exportada con extern que permitia escribir
     desde fuera del nucleo sin nombrar nada; y el SHADOWING de un nombre
     de LECTURAS_OK, que era una whitelist por identificador... elegido
     por quien escribe el bypass. Se corrige propagando tambien variables
     globales a punto fijo entre unidades, y exigiendo que un nombre de
     lectura solo cuente como tal si NO esta definido en la unidad.

  3ª ronda (supervision final): indireccion ENTRE unidades de traduccion --
     el grafo se construia dentro de una unidad, asi que bastaba partir el
     bypass en dos ficheros; y el alias del puntero a kv_set, que esquivaba una
     lista de nombres de escritura. Se corrige propagando el recurso entre
     unidades a punto fijo, e invirtiendo la carga: se lista lo que NO escribe
     (LECTURAS_OK) en vez de lo que escribe.

  1ª ronda (supervision S1), sobre fuente cruda y nombres base:
     (a) literal "diana_prov" en vez de la macro;
     (b) envoltorio kv_set_str, que ya existia en el arbol;
     (c) fichero con el MISMO nombre base en otro componente.

  2ª ronda (revision post-fix), sobre fuente cruda con parentesis equilibrados:
     (A-1) concatenacion de literales adyacentes: "diana" "_prov";
     (A-2) static inline que escribe, dentro de una cabecera;
     (A-3) igual, en boards/, fuera de components/ y main/;
     (A-4) macro de dos niveles: NS_LVL2 -> NS_LVL1 -> "diana_prov";
     (A-5) segundo entrypoint static inline en una cabecera.

La leccion de las dos rondas es la misma: mientras el analisis mire TEXTO
FUENTE, siempre hay otra forma de escribir lo mismo. Y la encapsulacion sola
tampoco basta: protege la MACRO, no el RECURSO -- "diana_prov" son diez
caracteres que cualquiera puede teclear.

Por eso ahora hay dos capas independientes:

  CAPA A · PREPROCESADO. Se preprocesa cada unidad de traduccion real con
  `gcc -E`. Ahi las macros ya estan expandidas (a cualquier profundidad), los
  `static inline` de las cabeceras estan materializados dentro de la unidad, y
  las cabeceras de cualquier directorio entran por inclusion. Ademas se
  concatenan los literales adyacentes, que el preprocesador NO une (es una fase
  posterior del compilador). Asi "diana" "_prov", NS_LVL2 y "diana_prov" son el
  mismo token.

  CAPA B · GRAFO DE LLAMADAS. Sobre esa misma unidad preprocesada se construye
  el grafo de llamadas y se PROPAGA el recurso: si una funcion recibe el
  espacio como argumento y lo pasa a otra, la marca viaja. El conjunto de
  funciones persistentes se calcula por punto fijo partiendo de kv_set, sin
  depender del NOMBRE del envoltorio. Asi caen wrapper -> wrapper -> kv_set y
  las funciones llamadas `persist`, `flush` o `put`.

QUE SE PUEDE Y QUE NO SE PUEDE AFIRMAR CON ESTO

Esta herramienta NO demuestra una propiedad matematica sobre todo programa C
posible. No hay AST ni analisis de flujo de datos. Por eso hay DOS afirmaciones
distintas, y conviene no confundirlas nunca:

  DEVICE_MANAGEMENT_COMMAND_PATH_CURRENT_TREE = UNIQUE
      Sobre el arbol compilado ACTUAL: no existe un segundo camino. Es una
      afirmacion sobre este codigo, verificada sobre las unidades reales.

  D1B_PATH_REGRESSION_GUARD = PASS_WITH_DECLARED_DYNAMIC_RESIDUAL
      La herramienta pone rojo manana si alguien introduce un bypass, CON un
      residual declarado abajo.

Tabla adversarial, medida ejecutando cada caso (no razonada):

  literal directo                                   ROJO
  literal concatenado  "diana" "_prov"              ROJO
  escape hexadecimal   "\x64iana_prov"              ROJO
  array de caracteres  {'d','i','a',...}            ROJO
  array de codigos     {100,105,97,...}             ROJO
  array hexadecimal    {0x64,0x69,...}              ROJO
  macro de dos niveles                              ROJO
  envoltorio kv_set_str                             ROJO
  wrapper -> wrapper -> kv_set                      ROJO
  funcion que devuelve el namespace                 ROJO
  static inline que escribe, en cabecera            ROJO
  cabecera en directorio no listado (stub)          ROJO
  colision de nombre base en otro componente        ROJO
  segundo entrypoint inline en cabecera             ROJO
  diana_prov_handle directo desde el runtime        ROJO
  interceptor que no corta el flujo                 ROJO
  INDIRECCION ENTRE UNIDADES: una funcion del
    nucleo devuelve el literal y otra unidad
    escribe con el resultado, sin nombrarlo         ROJO
  ALIAS del puntero: diana_hal_kv_set_fn w =
    hal->kv_set; w(ctx, "diana_prov", ...)          ROJO
  VARIABLE DE AMBITO DE FICHERO con el recurso     ROJO
  variable EXPORTADA + extern: escritura en otra
    unidad que nunca nombra el literal              ROJO
  TABLA global  {"otro", DIANA_PROV_NVS_NS}        ROJO
  SHADOWING de un nombre de lectura (definir un
    kv_get propio que por dentro escribe)           ROJO

  superstring + desplazamiento  "zzdiana_prov"+2   ROJO
  macro superstring + indice    &S[2]               ROJO
  array con RELLENO tras el cero {...,0,'q'}        ROJO

  namespace CONSTRUIDO EN EJECUCION (strcpy+strcat) SOBREVIVE

RESIDUAL DECLARADO:

    D1B_PATH_STATIC_ANALYSIS_RESIDUAL = dynamic-namespace-construction

    strcpy(ns, "diana"); strcat(ns, "_prov");

Y solo eso. La revision de cierre encontro tres formas ESTATICAS que el residual
declarado NO cubria -- superstring desplazada, macro superstring indexada y array
con relleno tras el cero -- porque el analisis comparaba el token entrecomillado
EXACTO. Se arreglo el analisis en vez de ensanchar la declaracion: ahora el
recurso se reconoce por CONTENIDO de cualquier literal, en un unico punto
(contiene_espacio). Ensanchar la frase habria sido mas barato y menos honesto:
esas tres no construian nada en ejecucion.

Ningun analisis estatico de texto puede verlo: el valor no existe hasta que
corre el programa. Cerrarlo exigiria analisis de flujo de datos o una barrera
en tiempo de ejecucion en el propio HAL, y construir eso dentro de D1b seria
otro nivel de tooling. Se declara en voz alta en vez de vender el analisis
estatico como garantia absoluta: la funcion de este guardian es que una
regresion honesta se ponga roja manana, no detener a quien ya escribe firmware
y construye el nombre a mano para esconderlo.

Propiedades:
  P1  El VALOR del espacio de autoridad solo aparece en unidades de diana_core.
  P2  La cabecera privada prov_nvs.h no se incluye fuera de diana_core.
  P3  Solo provisioning.c alcanza una escritura con ese recurso (punto fijo).
  P4  Un unico entrypoint desde fuera del nucleo, y por la puerta correcta.
  P5  El interceptor va ANTES del despacho de juego y corta el flujo.
"""
import re, os, sys, subprocess, tempfile, pathlib

FW = pathlib.Path(__file__).resolve().parents[1]
NUCLEO_DIR = FW / "components/diana_core"
PRIV = NUCLEO_DIR / "src/prov_nvs.h"
DESPACHO = FW / "main/app_commands.c"

EXCLUIDOS = ("build", "build-host", "test_host", "managed_components", "diagnostics")

def valor_espacio() -> str:
    m = re.search(r'#define\s+DIANA_PROV_NVS_NS\s+"([^"]+)"',
                  PRIV.read_text(encoding="utf8"))
    if not m:
        raise SystemExit("no encuentro DIANA_PROV_NVS_NS en %s" % PRIV)
    return m.group(1)

def unidades():
    """Unidades de traduccion reales del firmware. Se recorre TODO el arbol, no
    solo components/ y main/: una cabecera en boards/ era una de las evasiones."""
    for p in sorted(FW.rglob("*.c")):
        if any(x in p.parts for x in EXCLUIDOS):
            continue
        yield p

def cabeceras():
    for p in sorted(FW.rglob("*.h")):
        if any(x in p.parts for x in EXCLUIDOS):
            continue
        yield p

def incluidos():
    """TODO directorio del arbol que contenga cabeceras, mas el de stubs
    explicitos. Antes solo se miraban unos pocos directorios elegidos a mano, y
    una cabecera real del build que viviera fuera de esa lista acababa
    convertida en un stub vacio (evasion 11c). Aqui no se elige: se incluye
    cualquier sitio donde el proyecto tenga una cabecera."""
    dirs = {str(FW), str(FW / "tools/idf_stubs")}
    for h in FW.rglob("*.h"):
        if any(x in h.parts for x in EXCLUIDOS):
            continue
        dirs.add(str(h.parent))
        # tambien el directorio padre, para los includes con prefijo
        # ("freertos/queue.h", "diana/provisioning.h", ...)
        dirs.add(str(h.parent.parent))
    return sorted(dirs)

# Cabeceras EXTERNAS admitidas. Todo lo que falte y no case con esto es FALLO
# DURO: la lista es explicita a proposito, para que anadir una dependencia
# externa sea una decision visible y no un stub silencioso.
EXTERNAS_OK = (
    "esp_", "driver/", "freertos/", "nvs", "mqtt_client.h", "cJSON.h",
    "led_strip", "spi_flash_", "sdkconfig.h", "soc/", "hal/", "sys/",
    "lwip/", "unity", "protocol_examples",
)

def es_externa_admitida(h: str) -> bool:
    return any(h.startswith(x) or h.split("/")[-1].startswith(x) for x in EXTERNAS_OK)

def existe_en_repo(h: str):
    """Ruta real si la cabecera pertenece al proyecto. Se compara por sufijo de
    ruta y, si no, por nombre de fichero."""
    for c in FW.rglob("*.h"):
        if any(x in c.parts for x in EXCLUIDOS):
            continue
        # Si el include lleva prefijo de directorio ("freertos/queue.h"), se
        # exige que coincida la RUTA, no el nombre suelto: `diana/queue.h` no
        # es `freertos/queue.h`, y confundirlos daba diez falsos rojos.
        if "/" in h:
            if str(c).endswith("/" + h):
                return c
        elif c.name == h:
            return c
    return None

def preprocesar(p: pathlib.Path, stubs: pathlib.Path, incs):
    """Preprocesa una unidad. Devuelve (texto, error).

    Reglas, sin excepciones:
      - cabecera del PROYECTO que no resuelve  -> FALLO DURO (error), nunca stub.
      - cabecera EXTERNA de la lista explicita -> stub (del directorio
        tools/idf_stubs si existe uno curado; vacio si no).
      - cualquier otra cosa que falte          -> FALLO DURO.

    Antes se generaba un stub vacio para TODO lo que faltara, en silencio. Eso
    permitia esconder un bypass en una cabecera que el guardian no supiera
    localizar: le amputaba el contenido y daba la unidad por buena."""
    curados = FW / "tools/idf_stubs"
    cmd_base = ["gcc", "-E", "-P"]
    for d in incs:
        cmd_base += ["-I", d]
    cmd_base += ["-I", str(stubs)]
    for _ in range(400):
        r = subprocess.run(cmd_base + [str(p)], capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout, None
        falta = re.findall(r"([\w/\.\-\+]+\.h): No such file or directory", r.stderr)
        falta += re.findall(r"fatal error: ([\w/\.\-\+]+\.h)", r.stderr)
        if not falta:
            return None, "no preprocesa: %s" % r.stderr.strip().splitlines()[-1:]
        creado = False
        for h in sorted(set(falta)):
            destino = stubs / h
            if destino.exists():
                continue
            real = existe_en_repo(h)
            if real is not None:
                return None, ("la cabecera '%s' EXISTE en el proyecto (%s) pero no se "
                              "resolvio. NO se estuba: seria justo donde esconder un "
                              "bypass." % (h, real.relative_to(FW)))
            if not es_externa_admitida(h):
                return None, ("cabecera desconocida '%s': no esta en el proyecto ni en "
                              "la lista de externas admitidas. Anadela a EXTERNAS_OK "
                              "conscientemente." % h)
            destino.parent.mkdir(parents=True, exist_ok=True)
            curado = curados / h
            destino.write_text(curado.read_text() if curado.is_file() else "")
            creado = True
        if not creado:
            return None, "no progresa resolviendo cabeceras"
    return None, "demasiadas iteraciones resolviendo cabeceras"

def unir_literales(t: str) -> str:
    """El preprocesador NO concatena literales adyacentes: es la fase 6 del
    compilador. Aqui se hace, porque "diana" "_prov" es el mismo recurso."""
    ant = None
    while ant != t:
        ant = t
        t = re.sub(r'"((?:[^"\\]|\\.)*)"\s*"((?:[^"\\]|\\.)*)"', r'"\1\2"', t)
    return t

ESCAPES = {'n': '\n', 't': '\t', 'r': '\r', '0': '\0', '\\': '\\',
           '"': '"', "'": "'", 'a': '\a', 'b': '\b', 'f': '\f', 'v': '\v'}

def valor_literal(cuerpo: str) -> str:
    """Contenido efectivo de un literal C, deshaciendo escapes. Sin esto,
    "\\x64iana_prov" no se parecia a "diana_prov" y atravesaba el guardian
    (evasion 11a)."""
    out, i = [], 0
    while i < len(cuerpo):
        c = cuerpo[i]
        if c != '\\':
            out.append(c); i += 1; continue
        i += 1
        if i >= len(cuerpo): break
        e = cuerpo[i]
        if e == 'x':
            j = i + 1
            while j < len(cuerpo) and cuerpo[j] in "0123456789abcdefABCDEF":
                j += 1
            if j > i + 1:
                out.append(chr(int(cuerpo[i+1:j], 16))); i = j; continue
            out.append('x'); i += 1; continue
        if e in "01234567":
            j = i
            while j < len(cuerpo) and j < i + 3 and cuerpo[j] in "01234567":
                j += 1
            out.append(chr(int(cuerpo[i:j], 8))); i = j; continue
        out.append(ESCAPES.get(e, e)); i += 1
    return "".join(out)

def normalizar_valores(t: str, espacio: str) -> str:
    """Deja el texto en una forma donde el recurso sea reconocible con
    independencia de COMO se haya escrito. Dos normalizaciones, cada una nacida
    de una evasion real y medida:

      11a  "\\x64iana_prov"                        -> escapes deshechos
      11b  {'d','i','a','n','a','_','p','r','o','v'} -> inicializador por
           caracteres reconstruido, siempre que sea constante evaluable.

    NO cubre la construccion en ejecucion (strcpy+strcat): ese residual queda
    declarado, no disimulado."""
    def _lit(m):
        return '"%s"' % valor_literal(m.group(1))
    t = re.sub(r'"((?:[^"\\]|\\.)*)"', _lit, t)

    def _arr(m):
        """Reconstruye un inicializador constante de caracteres. Acepta las tres
        formas equivalentes, porque las tres producen el mismo recurso:
          {'d','i','a',...}          caracteres
          {100, 105, 97, ...}        codigos decimales
          {0x64, 0x69, ...}          codigos hexadecimales, con o sin (char)"""
        piezas = [x.strip() for x in m.group(1).split(",")]
        if not piezas or len(piezas) < 2:
            return m.group(0)
        out = []
        for z in piezas:
            z = re.sub(r"^\(\s*(?:unsigned\s+|signed\s+)?char\s*\)\s*", "", z)
            mc = re.fullmatch(r"'((?:[^'\\\\]|\\\\.)*)'", z)
            if mc:
                out.append(valor_literal(mc.group(1))); continue
            mn = re.fullmatch(r"(0[xX][0-9a-fA-F]+|\d+)", z)
            if mn:
                try:
                    out.append(chr(int(mn.group(1), 0)))
                except ValueError:
                    return m.group(0)
                continue
            return m.group(0)   # algo que no es constante: no se toca
        # Sin rstrip("\0") a secas: un relleno DESPUES del cero
        # ({'d',...,'v',0,'q'}) desactivaba la reconstruccion entera.
        s2 = "".join(out).replace("\0", "")
        return '= "%s"' % s2 if s2 else m.group(0)
    t = re.sub(r'=\s*\{([^{}]*)\}', _arr, t)
    return t

def argumentos(texto: str, pos: int):
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

DEF_FUNC = re.compile(r'(?:^|[};])\s*(?:static\s+|inline\s+|extern\s+)*'
                      r'[\w\*\s]+?\b(\w+)\s*\(([^;{)]*)\)\s*\{', re.M)

def funciones(t: str):
    """(nombre, parametros, cuerpo) de cada definicion de la unidad."""
    for m in DEF_FUNC.finditer(t):
        ini = t.index('{', m.end() - 1)
        prof, i = 0, ini
        while i < len(t):
            if t[i] == '{': prof += 1
            elif t[i] == '}':
                prof -= 1
                if prof == 0: break
            i += 1
        yield m.group(1), m.group(2), t[ini:i]

def llamadas(t: str):
    for m in re.finditer(r'\b(\w+)\s*\(', t):
        args, _ = argumentos(t, m.end() - 1)
        yield m.group(1), args

# Funciones que NO escriben aunque reciban el recurso. Lista explicita y corta:
# todo lo demas que reciba el espacio se considera capaz de escribir. Se invierte
# la carga a proposito -- antes se listaban los nombres de escritura y bastaba
# llamar al envoltorio `w` (un alias del puntero) para no estar en la lista.
_LECTURAS_NOMBRE = {
    "kv_get", "diana_prov_factory_read",
    "strcmp", "strncmp", "strlen", "memcmp", "snprintf", "printf", "strstr",
}

def lecturas_de(t: str):
    """Nombres que se admiten como LECTURA en ESTA unidad.

    No basta con el nombre: el nombre lo elige quien escribe el bypass. Bastaba
    definir `static int kv_get(...)` que por dentro llamase a kv_set para que la
    llamada quedara exenta Y la funcion quedase fuera del punto fijo. Doble
    fallo, y por un identificador.

    Regla: un nombre de la lista solo cuenta como lectura si NO esta DEFINIDO en
    la unidad. Si alguien define aqui algo llamado `kv_get` o `strcmp`, es una
    funcion suya y se analiza como cualquier otra."""
    definidas = {n for n, _, _ in funciones(t)}
    return _LECTURAS_NOMBRE - definidas

def contiene_espacio(texto: str, espacio: str) -> bool:
    """El recurso esta presente si ALGUN literal del texto lo CONTIENE.

    Unico punto donde se decide esto. Antes habia tres comparaciones sueltas
    contra el token entrecomillado exacto, y bastaba una superstring
    ("zzdiana_prov" + 2) o un relleno a la derecha ({...,0,'q'}) para que
    ninguna lo viera. Al centralizarlo, arreglar aqui arregla las tres."""
    return any(espacio in m.group(1)
               for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', texto))

def proveedores_de_espacio(t: str, espacio: str, conocidos):
    """Funciones de ESTA unidad que DEVUELVEN el recurso: directamente, o
    devolviendo el resultado de otro proveedor ya conocido (de cualquier
    unidad). Es la pieza que faltaba: el grafo se construia dentro de una
    unidad, asi que bastaba partir el bypass en dos ficheros -- una funcion en
    el nucleo que devuelve el literal, y la escritura en main, que asi nunca
    nombra nada."""
    lit = '"%s"' % espacio
    salida = set()
    for nombre, _, cuerpo in funciones(t):
        for m in re.finditer(r'\breturn\b([^;]*);', cuerpo):
            expr = m.group(1)
            if contiene_espacio(expr, espacio) or \
               any(re.search(r'\b%s\s*\(' % re.escape(k), expr) for k in conocidos):
                salida.add(nombre); break
    return salida

def sin_cuerpos(t: str) -> str:
    """El texto de la unidad SIN los cuerpos de funcion: lo que queda es
    ambito de fichero. Necesario para no confundir una variable global con
    cualquier asignacion local, que fue justo el falso positivo al primer
    intento (variables llamadas `n` o `p` envenenaban el analisis entero)."""
    fuera, pos = [], 0
    for m in re.finditer(r'\{', t):
        if m.start() < pos:
            continue
        prof, i = 0, m.start()
        while i < len(t):
            if t[i] == '{': prof += 1
            elif t[i] == '}':
                prof -= 1
                if prof == 0: break
            i += 1
        fuera.append(t[pos:m.start()])
        pos = i + 1
    fuera.append(t[pos:])
    return "\n".join(fuera)

def variables_con_espacio(t: str, espacio: str, proveedores):
    """Variables de AMBITO DE FICHERO inicializadas con el recurso.

    Se recogen aparte de las funciones porque cruzan la frontera de unidad por
    otra via: `const char *G = DIANA_PROV_NVS_NS;` en el nucleo y un `extern` en
    otra unidad que escribe sin nombrar nada. Sin esto, la propagacion entre
    unidades solo cubria funciones y quedaba ese hueco.

    Se exige que la declaracion sea de tipo cadena (char* o array de char) y que
    este FUERA de toda funcion: recoger cualquier asignacion daba un falso
    positivo que tenia por sospechosos a quince ficheros."""
    lit = '"%s"' % espacio
    cabeza = sin_cuerpos(t)
    salida = set()
    patron = (r'(?:static\s+|extern\s+|const\s+)*char\s*(?:\*\s*(?:const\s*)?)*'
              r'(\w+)\s*(?:\[[^\]]*\])?\s*=\s*([^;]+);')
    for m in re.finditer(patron, cabeza):
        var, val = m.group(1), m.group(2)
        if contiene_espacio(val, espacio) or \
           any(re.search(r'\b%s\b' % re.escape(pv), val) for pv in proveedores):
            salida.add(var)
    return salida

def analizar_unidad(t: str, espacio: str, proveedores, variables):
    """Devuelve (tiene_recurso, alcanza_escritura, entrypoints) para una unidad
    ya preprocesada y normalizada."""
    lit = '"%s"' % espacio
    defs = list(funciones(t))
    LECTURAS_OK = lecturas_de(t)

    # OJO: solo dentro de CUERPOS de funcion. Al preprocesar, las cabeceras
    # meten sus DECLARACIONES en todas las unidades, y una declaracion
    # `bool diana_prov_message(...)` se parece a una llamada.
    cuerpos = "\n".join(c for _, _, c in defs)

    # Precalculo, UNA vez por unidad. Antes esto se recomputaba por cada
    # argumento de cada llamada y el guardian tardaba 38 s; uno lento acaba
    # desactivado, que es la peor forma de perder una garantia.
    _re_prov = re.compile(r'\b(?:%s)\s*\(' % "|".join(re.escape(x) for x in proveedores)) \
               if proveedores else None
    _re_vars = re.compile(r'\b(?:%s)\b' % "|".join(re.escape(x) for x in variables)) \
               if variables else None

    locales = set()
    for m in re.finditer(r'\b(\w+)\s*(?:\[[^\]]*\])?\s*=\s*([^;]+);', t):
        val = m.group(2)
        if contiene_espacio(val, espacio) or (_re_prov and _re_prov.search(val)) or \
           (_re_vars and _re_vars.search(val)):
            locales.add(m.group(1))
    _re_loc = re.compile(r'\b(?:%s)\b' % "|".join(re.escape(x) for x in locales)) \
              if locales else None

    def es_recurso(arg: str) -> bool:
        """El argumento ES el recurso: el literal, una llamada a un proveedor,
        una variable global que lo lleva (posiblemente de OTRA unidad, via
        extern: aqui solo se ve su nombre y con eso basta), o una variable a la
        que se le asigno cualquiera de las tres."""
        if contiene_espacio(arg, espacio):
            return True
        if _re_prov and _re_prov.search(arg):
            return True
        if _re_vars and _re_vars.search(arg):
            return True
        return bool(_re_loc and _re_loc.search(arg))

    # Punto fijo LOCAL: funciones que, recibiendo el recurso por parametro, lo
    # pasan a algo capaz de escribir. Se propaga por parametro, no por nombre.
    escritoras = set()
    cambio = True
    while cambio:
        cambio = False
        for nombre, params, cuerpo in defs:
            if nombre in escritoras or nombre in LECTURAS_OK:
                continue
            npar = re.findall(r'\b(\w+)\s*(?:\[[^\]]*\])?\s*(?:,|$)', params)
            for llamada, args in llamadas(cuerpo):
                if llamada in LECTURAS_OK:
                    continue
                if any(es_recurso(a) for a in args) or \
                   any(any(re.search(r'\b%s\b' % re.escape(pn), a) for pn in npar)
                       for a in args):
                    escritoras.add(nombre); cambio = True; break

    # Escritura efectiva: el recurso llega a UNA llamada que no es lectura.
    # Cubre el alias del puntero (`diana_hal_kv_set_fn w = hal->kv_set; w(...)`),
    # porque no se mira COMO se llama la funcion sino que reciba el recurso.
    escribe = False
    for llamada, args in llamadas(cuerpos):
        if llamada in LECTURAS_OK:
            continue
        if any(es_recurso(a) for a in args):
            escribe = True; break

    tiene = contiene_espacio(t, espacio) or any(
        re.search(r'\b%s\s*\(' % re.escape(pv), cuerpos) for pv in proveedores) \
        or any(re.search(r'\b%s\b' % re.escape(v), cuerpos) for v in variables)

    entradas = set()
    for llamada, _ in llamadas(cuerpos):
        if llamada in ("diana_prov_message", "diana_prov_handle"):
            entradas.add(llamada)
    return tiene, escribe, entradas

def es_nucleo(p: pathlib.Path) -> bool:
    return NUCLEO_DIR in p.parents

def main() -> int:
    espacio = valor_espacio()
    fallos, no_analizadas = [], []
    incs = incluidos()

    nombradores, escritores, entradas_fuera, directos_fuera = [], [], [], []

    with tempfile.TemporaryDirectory() as tmp:
        stubs = pathlib.Path(tmp)

        # PASADA 1 - preprocesar todo una vez y calcular el conjunto GLOBAL de
        # funciones que devuelven el recurso, a punto fijo ENTRE unidades. Sin
        # esto, partir el bypass en dos ficheros lo hacia invisible.
        textos = {}
        for p in unidades():
            t, err = preprocesar(p, stubs, incs)
            if t is None:
                no_analizadas.append("%s: %s" % (p.relative_to(FW), err))
                continue
            textos[p] = normalizar_valores(unir_literales(t), espacio)

        proveedores, variables, cambio = set(), set(), True
        while cambio:
            cambio = False
            for t in textos.values():
                nuevos = proveedores_de_espacio(t, espacio, proveedores)
                if not nuevos.issubset(proveedores):
                    proveedores |= nuevos; cambio = True
                nvar = variables_con_espacio(t, espacio, proveedores)
                if not nvar.issubset(variables):
                    variables |= nvar; cambio = True

        # PASADA 2 - analisis con ese conjunto ya cerrado.
        for p, t in textos.items():
            nombra, escribe, entradas = analizar_unidad(t, espacio, proveedores, variables)
            rel = str(p.relative_to(FW))
            if nombra and not es_nucleo(p):
                nombradores.append(rel)
            if escribe:
                escritores.append(rel)
            if not es_nucleo(p):
                if "diana_prov_message" in entradas: entradas_fuera.append(rel)
                if "diana_prov_handle" in entradas: directos_fuera.append(rel)

    # Una unidad que no se puede analizar NO se da por buena: seria justo el
    # sitio donde esconder un bypass.
    if no_analizadas:
        fallos.append("unidades que no se pudieron preprocesar (no se dan por "
                      "buenas): %s" % sorted(no_analizadas))

    # P1
    if nombradores:
        fallos.append("nombran el espacio de la autoridad fuera de diana_core: %s. "
                      "El valor esta en la cabecera privada src/prov_nvs.h y la "
                      "unica via de lectura desde fuera es "
                      "diana_prov_factory_read()." % sorted(set(nombradores)))
    # P2
    filtran = [str(p.relative_to(FW)) for p in list(cabeceras()) + list(unidades())
               if not es_nucleo(p) and
               re.search(r'#\s*include\s*[<"][^">]*prov_nvs\.h',
                         p.read_text(encoding="utf8", errors="ignore"))]
    if filtran:
        fallos.append("incluyen la cabecera PRIVADA prov_nvs.h fuera de diana_core: %s"
                      % sorted(set(filtran)))
    # P3
    escritores = sorted(set(escritores))
    if escritores != ["components/diana_core/src/provisioning.c"]:
        fallos.append("alcanzan una escritura del espacio de la autoridad: %s. Debe "
                      "ser solo components/diana_core/src/provisioning.c."
                      % (escritores or "nadie"))
    # P4
    entradas_fuera = sorted(set(entradas_fuera))
    if entradas_fuera != ["main/app_provision.c"]:
        fallos.append("entran al plano desde fuera del nucleo: %s. Debe haber UN solo "
                      "punto de entrada (main/app_provision.c)."
                      % (entradas_fuera or "ningun sitio"))
    if directos_fuera:
        fallos.append("llaman a diana_prov_handle() DIRECTAMENTE desde fuera del "
                      "nucleo: %s. Eso salta el parser." % sorted(set(directos_fuera)))
    # P5
    d = DESPACHO.read_text(encoding="utf8")
    d = re.sub(r'/\*.*?\*/', ' ', d, flags=re.S)
    d = re.sub(r'//[^\n]*', ' ', d)
    m = re.search(r'void\s+diana_handle_message\s*\([^)]*\)\s*\{', d)
    if not m:
        fallos.append("no encuentro diana_handle_message")
    else:
        cuerpo = d[m.end():]
        icept = cuerpo.find("diana_prov_app_handle")
        parse = re.search(r'cJSON_Parse\w*\s*\(', cuerpo)
        if icept < 0:
            fallos.append("diana_handle_message NO llama a diana_prov_app_handle")
        elif parse and icept > parse.start():
            fallos.append("el interceptor de DEVICE_MANAGEMENT va DESPUES del parseo")
        elif not re.search(r'if\s*\(\s*diana_prov_app_handle\s*\([^)]*\)\s*\)\s*return\s*;', cuerpo):
            fallos.append("el interceptor no corta el flujo")

    if fallos:
        print("D1b camino unico: %d FALLOS" % len(fallos))
        for f in fallos: print("  FALLO %s" % f)
        return 1
    print("D1b camino unico: CURRENT_TREE = UNIQUE · guarda de regresion PASS "
          "(residual declarado: construccion dinamica del namespace)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
