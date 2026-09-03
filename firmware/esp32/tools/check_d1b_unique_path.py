#!/usr/bin/env python3
"""DEVICE_MANAGEMENT_COMMAND_PATH, fijado sobre el codigo en DOS CAPAS.

Historia, porque explica el diseno. Este guardian ha sido evadido dos veces:

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

LIMITE RESIDUAL, DECLARADO (no descubierto por un revisor: medido aqui).

Ninguna de las dos capas es una garantia semantica completa: no hay AST ni
analisis de flujo de datos. Se probaron adversarialmente las variantes
conocidas y este es el resultado exacto:

  wrapper -> wrapper -> kv_set (dos saltos)        ROJO
  funcion que DEVUELVE el namespace                ROJO
  static const char ns[] = "diana_prov"            ROJO
  namespace CONSTRUIDO EN EJECUCION (strcpy+strcat) SOBREVIVE

El ultimo no lo puede ver ningun analisis de texto, por bueno que sea: el valor
no existe hasta que corre el programa. Cerrarlo exigiria analisis de flujo de
datos o una barrera en tiempo de ejecucion en el propio HAL. Queda declarado
como

    D1B_PATH_STATIC_ANALYSIS_RESIDUAL = dynamic-namespace-construction

y se documenta a proposito: la funcion de este guardian es que una regresion
honesta o un anadido descuidado se pongan rojos manana, no detener a alguien
que ya esta escribiendo firmware y construye el nombre a mano para esconderlo.

Por eso la propiedad se declara UNIQUE solo cuando AMBAS capas pasan, y con
este limite dicho en voz alta.

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
    dirs = [FW / "components" / d / "include" for d in os.listdir(FW / "components")
            if (FW / "components" / d / "include").is_dir()]
    dirs += [FW / "main", FW / "boards", FW / "components"]
    dirs += [d for d in (FW / "components").glob("*/src")]
    return [str(d) for d in dirs if d.is_dir()]

def preprocesar(p: pathlib.Path, stubs: pathlib.Path, incs):
    """`gcc -E` tolerante: las cabeceras de ESP-IDF no estan en esta maquina, y
    no hacen falta para esta comprobacion. Se generan stubs vacios para lo que
    falte, iterando hasta que la unidad se preprocesa. Si aun asi no sale, se
    devuelve None y el llamante lo declara NO ANALIZADA en vez de callarselo."""
    cmd_base = ["gcc", "-E", "-P", "-nostdinc", "-I", str(stubs)]
    for d in incs:
        cmd_base += ["-I", d]
    for _ in range(400):
        r = subprocess.run(cmd_base + [str(p)], capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout
        falta = re.findall(r'([\w/\.\-\+]+\.h): No such file or directory', r.stderr)
        falta += re.findall(r"fatal error: ([\w/\.\-\+]+\.h)", r.stderr)
        if not falta:
            return None
        creado = False
        for h in set(falta):
            destino = stubs / h
            if destino.exists():
                continue
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_text("")
            creado = True
        if not creado:
            return None
    return None

def unir_literales(t: str) -> str:
    """El preprocesador NO concatena literales adyacentes: es la fase 6 del
    compilador. Aqui se hace, porque "diana" "_prov" es el mismo recurso."""
    ant = None
    while ant != t:
        ant = t
        t = re.sub(r'"((?:[^"\\]|\\.)*)"\s*"((?:[^"\\]|\\.)*)"', r'"\1\2"', t)
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

def analizar_unidad(t: str, espacio: str):
    """Devuelve (nombra, alcanza_escritura, entrypoints) para una unidad ya
    preprocesada y con literales unidos."""
    lit = '"%s"' % espacio
    nombra = lit in t

    # Punto fijo: funciones que, recibiendo el recurso, terminan escribiendo.
    persistentes = {"kv_set"}
    defs = list(funciones(t))
    cambio = True
    while cambio:
        cambio = False
        for nombre, params, cuerpo in defs:
            if nombre in persistentes:
                continue
            nombres_param = re.findall(r'\b(\w+)\s*(?:\[[^\]]*\])?\s*(?:,|$)', params)
            for llamada, args in llamadas(cuerpo):
                if llamada not in persistentes:
                    continue
                # el recurso llega literal, o llega por un parametro propio
                if any(lit in a for a in args) or \
                   any(any(re.search(r'\b%s\b' % re.escape(pn), a) for pn in nombres_param)
                       for a in args):
                    persistentes.add(nombre); cambio = True; break

    # OJO: solo dentro de CUERPOS de funcion. Al preprocesar, las cabeceras
    # meten sus DECLARACIONES en todas las unidades, y una declaracion
    # `bool diana_prov_message(...)` se parece a una llamada. Confundirlas daba
    # cuatro falsos positivos.
    cuerpos = "\n".join(c for _, _, c in defs)

    escribe = False
    for llamada, args in llamadas(cuerpos):
        if llamada in persistentes and any(lit in a for a in args):
            escribe = True; break
    # y tambien: llamada a algo persistente cuyo argumento es una variable a la
    # que se asigno el literal en la misma unidad
    if not escribe:
        for m in re.finditer(r'\b(\w+)\s*(?:\[\s*\])?\s*=\s*%s' % re.escape(lit), t):
            var = m.group(1)
            for llamada, args in llamadas(cuerpos):
                if llamada in persistentes and any(re.search(r'\b%s\b' % var, a) for a in args):
                    escribe = True; break
            if escribe: break

    entradas = set()
    for llamada, _ in llamadas(cuerpos):
        if llamada in ("diana_prov_message", "diana_prov_handle"):
            entradas.add(llamada)
    return nombra, escribe, entradas

def es_nucleo(p: pathlib.Path) -> bool:
    return NUCLEO_DIR in p.parents

def main() -> int:
    espacio = valor_espacio()
    fallos, no_analizadas = [], []
    incs = incluidos()

    nombradores, escritores, entradas_fuera, directos_fuera = [], [], [], []

    with tempfile.TemporaryDirectory() as tmp:
        stubs = pathlib.Path(tmp)
        for p in unidades():
            t = preprocesar(p, stubs, incs)
            if t is None:
                no_analizadas.append(str(p.relative_to(FW)))
                continue
            t = unir_literales(t)
            nombra, escribe, entradas = analizar_unidad(t, espacio)
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
    print("D1b camino unico: preprocesado + grafo de llamadas  ok")
    return 0

if __name__ == "__main__":
    sys.exit(main())
