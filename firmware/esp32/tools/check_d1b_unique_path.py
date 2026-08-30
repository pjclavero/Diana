#!/usr/bin/env python3
"""DEVICE_MANAGEMENT_COMMAND_PATH = UNIQUE, fijado sobre el codigo.

Afirmar que "no hay otro camino" es facil de escribir y facil de romper sin
enterarse: basta que alguien añada un kv_set al espacio de la autoridad, o llame
a diana_prov_message desde otro sitio, o mueva el interceptor detras del despacho
de juego. Nada de eso rompe ninguna prueba de comportamiento.

Se comprueban TRES propiedades estructurales:

  1. Solo provisioning.c PERSISTE el estado de autoridad.
  2. El plano tiene UN solo punto de entrada desde el runtime.
  3. El interceptor se ejecuta ANTES del despacho de juego.

Ignora comentarios: un comentario que menciona kv_set no escribe nada.
"""
import re, sys, pathlib

FW = pathlib.Path(__file__).resolve().parents[1]
NUCLEO = FW / "components/diana_core/src/provisioning.c"
RUNTIME = FW / "main/app_provision.c"
DESPACHO = FW / "main/app_commands.c"

def fuentes():
    """Solo arboles de FUENTE. `build/` contiene ficheros generados y enlaces
    rotos de componentes de ESP-IDF, y `diagnostics/` es un proyecto aparte."""
    for base in ("components", "main"):
        for p in (FW / base).rglob("*.c"):
            if "build" in p.parts or "test_host" in p.parts:
                continue
            yield p

def codigo(p: pathlib.Path) -> str:
    t = p.read_text(encoding="utf8", errors="ignore")
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', t)

def main() -> int:
    fallos = []

    # 1. Persistencia de la autoridad: solo el nucleo.
    escritores = []
    for p in fuentes():
        c = codigo(p)
        for m in re.finditer(r'kv_set\s*\(([^;]*)\)', c, re.S):
            if "DIANA_PROV_NVS_NS" in m.group(1):
                escritores.append(p.name)
    escritores = sorted(set(escritores))
    if escritores != ["provisioning.c"]:
        fallos.append("escriben el espacio NVS de la autoridad: %s. Debe ser solo "
                      "provisioning.c, y solo por diana_prov_save()." % (escritores or "nadie"))

    # 2. Un unico punto de entrada DESDE FUERA DEL NUCLEO, y por la puerta
    #    correcta. Los ficheros de components/diana_core/src son la
    #    IMPLEMENTACION de la cadena: prov_parse.c define diana_prov_message() y
    #    encadena a diana_prov_handle(). Eso no es un bypass.
    #    Lo que si lo seria: que el runtime llamase a diana_prov_handle()
    #    directamente, saltandose el parser.
    fuera = []
    directos = []
    for p in fuentes():
        if "diana_core" in p.parts:
            continue
        c = codigo(p)
        if re.search(r'\bdiana_prov_message\s*\(', c):
            fuera.append(p.name)
        if re.search(r'\bdiana_prov_handle\s*\(', c):
            directos.append(p.name)
    fuera = sorted(set(fuera))
    if fuera != ["app_provision.c"]:
        fallos.append("entran al plano desde fuera del nucleo: %s. Debe haber UN "
                      "solo punto de entrada (app_provision.c)." % (fuera or "ningun sitio"))
    if directos:
        fallos.append("llaman a diana_prov_handle() DIRECTAMENTE desde fuera del "
                      "nucleo: %s. Eso salta el parser; hay que entrar por "
                      "diana_prov_message()." % sorted(set(directos)))

    # 3. El interceptor, antes del despacho de juego.
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

    if fallos:
        print("D1b camino unico: %d FALLOS" % len(fallos))
        for f in fallos: print("  FALLO %s" % f)
        return 1
    print("D1b camino unico: persistencia, entrada e interceptor  ok")
    return 0

if __name__ == "__main__":
    sys.exit(main())
