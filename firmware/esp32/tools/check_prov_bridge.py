#!/usr/bin/env python3
"""
PROVISION_BRIDGE · guarda ESTRUCTURAL del puente DEVICE_MANAGEMENT (MP0-F.0).

POR QUE HACE FALTA. `main/` y `components/diana_platform_esp/` NO se compilan
en la suite de host: ninguna prueba en C puede ejecutar el despachador de
app_commands.c ni la suscripcion de mqtt_client.c. La suite si demuestra que
diana_topic_route() decide bien (test_prov_bridge.c, matriz 6x6); lo que no
puede demostrar es que el codigo la USE, ni que el firmware se suscriba de
verdad al topico. Eso es lo que fija este guardian.

QUE SE PUEDE AFIRMAR CON ESTO, Y QUE NO. Es analisis de TEXTO FUENTE acotado
por bloques de funcion (llaves equilibradas), no un AST ni analisis de flujo.
Afirmacion honesta:

    PROVISION_BRIDGE_WIRED = TRUE sobre el arbol de trabajo actual

y NO "es imposible reintroducir el defecto". Un `strstr` escondido tras una
macro o un envoltorio en otra unidad se le escapa. Lo que si garantiza es que
la REGRESION EVIDENTE --volver a emparejar el topico por subcadena, o retirar
la suscripcion-- sale ROJA en vez de pasar en silencio, que es exactamente
como se colo el defecto original.

Contador PROPIO: PROVISION_BRIDGE_CHECKS. NO se suma a HOST_SUITE ni a
STRUCTURAL_TLS_CHECKS: son cosas distintas y sumarlas miente sobre la
cobertura.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
FW = HERE.parents[1]

MQTT_CLIENT = FW / "components" / "diana_platform_esp" / "src" / "mqtt_client.c"
APP_COMMANDS = FW / "main" / "app_commands.c"
APP_PROVISION = FW / "main" / "app_provision.c"
APP_MAIN = FW / "main" / "app_main.c"

checks = 0
failures: list[str] = []


def check(cond: bool, desc: str) -> None:
    global checks
    checks += 1
    if cond:
        print(f"  ok   {desc}")
    else:
        failures.append(desc)
        print(f"  FALLO {desc}")


def strip_comments(src: str) -> str:
    """Quita comentarios y literales de cadena NO se tocan.

    Los comentarios de este arbol hablan largo y tendido de `strstr` y de los
    huecos ya cerrados: buscarlo sobre el fuente crudo daria falsos positivos
    permanentes. Se analiza CODIGO, no prosa.
    """
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"//[^\n]*", " ", src)
    return src


def function_body(src: str, name: str) -> str | None:
    """Devuelve el cuerpo de `name` acotando por llaves equilibradas.

    Acotar por funcion es lo que separa 'el fichero menciona X' de 'el
    despachador hace X'. Un `strstr` legitimo en otra funcion del mismo
    fichero (app_tasks.c usa uno sobre un motivo de coordinacion) no puede
    contaminar el veredicto sobre el despachador.
    """
    m = re.search(rf"\b{re.escape(name)}\s*\([^;{{]*\)\s*{{", src)
    if not m:
        return None
    i = src.index("{", m.start())
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i : j + 1]
    return None


def main() -> int:
    print("\n--- PROVISION_BRIDGE: puente del plano DEVICE_MANAGEMENT ---")

    # ---------------------------------------------------------- suscripcion --
    print("\n[1] suscripcion a la ORDEN (CONTRACT_GAP-PROVISION-COMMAND-TOPIC)")
    mc = strip_comments(MQTT_CLIENT.read_text())
    body = function_body(mc, "diana_platform_mqtt_subscribe")
    check(body is not None, "existe diana_platform_mqtt_subscribe")
    body = body or ""

    # La tabla de sufijos, tal cual la recorre el bucle de suscripcion.
    m = re.search(r"suffixes\s*\[\s*\]\s*=\s*{(.*?)}", body, re.S)
    check(m is not None, "la suscripcion usa una tabla de sufijos")
    suffixes = re.findall(r'"([^"]*)"', m.group(1)) if m else []
    check("provision" in suffixes,
          "se suscribe a 'provision' (la orden ya es alcanzable por transporte)")
    check("provision/state" not in suffixes,
          "NO se suscribe a 'provision/state' (lo publica el propio modulo)")
    check("command" in suffixes and "config/desired" in suffixes
          and "ota" in suffixes,
          "las suscripciones previas siguen ahi")
    # QoS 1: es el tercer argumento literal de esp_mqtt_client_subscribe dentro
    # del bucle que recorre la tabla.
    check(re.search(r"esp_mqtt_client_subscribe\s*\(\s*p->mqtt\s*,\s*topic\s*,\s*1\s*\)",
                    body) is not None,
          "las suscripciones de la tabla van a QoS 1")

    # El enrutador tiene que estar en el BINARIO, no solo en el arbol. Ya paso
    # una vez con los seis fuentes de D1b: compilaban con el gcc de host y el
    # toolchain xtensa no los habia visto nunca. La lista de SRCS es explicita.
    cml = (FW / "components" / "diana_core" / "CMakeLists.txt").read_text()
    check('"src/topic_route.c"' in cml,
          "topic_route.c esta registrado en el CMakeLists de diana_core")

    # ------------------------------------------------------------- despacho --
    print("\n[2] despacho EXACTO (P0: nada de emparejar por subcadena)")
    ac = strip_comments(APP_COMMANDS.read_text())
    disp = function_body(ac, "diana_handle_message")
    check(disp is not None, "existe el despachador diana_handle_message")
    disp = disp or ""

    check("strstr" not in disp,
          "el despachador NO usa strstr (era la causa de la colision)")
    check("rx->topic" not in disp.replace("diana_topic_route(rx->topic", ""),
          "el despachador no manipula el topico crudo fuera del enrutador")
    check(disp.count("diana_topic_route(") == 1,
          "clasifica el topico UNA sola vez: un unico dispatcher")

    # Cada destino del enunciado aparece EXACTAMENTE una vez como condicion.
    esperados = {
        "DIANA_ROUTE_MODULE_COMMAND": "game command",
        "DIANA_ROUTE_MODULE_MAINTENANCE_COMMAND": "maintenance command",
        "DIANA_ROUTE_MODULE_PROVISION_COMMAND": "provision command",
        "DIANA_ROUTE_MODULE_CONFIG_DESIRED": "config desired",
        "DIANA_ROUTE_MODULE_OTA": "ota",
        "DIANA_ROUTE_GAME_STATE": "game state",
    }
    for sym, label in esperados.items():
        n = len(re.findall(rf"kind\s*==\s*{sym}\b", disp))
        check(n == 1, f"'{label}' tiene EXACTAMENTE una rama de despacho")

    check(re.search(r"kind\s*==\s*DIANA_ROUTE_UNKNOWN", disp) is not None,
          "un topico fuera del contrato tiene su propia rama y no cae en otra")

    # La orden de provisioning se atiende ANTES de tratar nada como juego.
    i_prov = disp.find("DIANA_ROUTE_MODULE_PROVISION_COMMAND")
    i_game = disp.find("DIANA_ROUTE_MODULE_COMMAND")
    i_parse = disp.find("cJSON_ParseWithLength")
    check(0 <= i_prov < i_game,
          "DEVICE_MANAGEMENT se atiende antes que el canal de juego")
    check(0 <= i_prov < i_parse,
          "...y antes de parsear el payload como mensaje de juego")

    # ---------------------------------------------------------- publicacion --
    print("\n[3] publicacion del ESTADO (CONTRACT_GAP-PROVISION-STATE-TOPIC)")
    ap = strip_comments(APP_PROVISION.read_text())
    pub = function_body(ap, "diana_publish_provision_state")
    check(pub is not None, "existe el publicador del estado de autoridad")
    pub = pub or ""

    check("diana_prov_state_json" in pub,
          "el payload lo serializa diana_prov_state_json (un solo serializador)")
    check("diana_json_" not in pub,
          "el publicador NO escribe un segundo serializador propio")
    check("topic_provision_state" in pub,
          "publica en el topico de estado del modulo")
    check(re.search(r"\.qos\s*=\s*diana_topic_qos\(\s*DIANA_TOPIC_PROVISION_STATE\s*\)",
                    pub) is not None,
          "el QoS sale de la tabla del contrato, no de un literal")
    check(re.search(r"\.retain\s*=\s*diana_topic_retain\(\s*DIANA_TOPIC_PROVISION_STATE\s*\)",
                    pub) is not None,
          "el retain sale de la tabla del contrato, no de un literal")
    check(re.search(r"if\s*\(\s*!\s*out->publish\s*\)\s*return", pub) is not None,
          "publish=false no publica nada: no se inventa una fotografia")

    # Ya no queda el descarte deliberado de out.publish.
    check("(void)out.publish" not in ap,
          "out.publish ya NO se descarta: el estado se emite")

    handler = function_body(ap, "diana_prov_app_handle") or ""
    check("diana_publish_provision_state" in handler,
          "atender una orden publica su estado resultante")
    check("strstr" not in handler and "strcmp(rx->topic" not in handler,
          "el handler ya no empareja el topico por su cuenta")
    check("diana_topic_route(" in handler,
          "el handler confirma la ruta con el enrutador exacto")
    check("rx->retained" in handler,
          "el flag retain del TRANSPORTE llega intacto al motor de D1b")

    # El topico se construye con la tabla, no a mano.
    am = strip_comments(APP_MAIN.read_text())
    check(re.search(r"diana_topic_build\([^;]*DIANA_TOPIC_PROVISION_STATE", am,
                    re.S) is not None,
          "el topico de estado se construye con diana_topic_build")
    check("targets/v1" not in ap,
          "app_provision.c no cablea ningun topico a mano")

    # --------------------------------------------------- NO_SECRET_IN_STATE --
    print("\n[4] NO_SECRET_IN_STATE en el camino de publicacion")
    for prohibido in ("root_key", "operational_key", "mqtt_password", "password"):
        # PROV_NVS_ROOT_KEY es la CLAVE NVS de lectura de fabrica, no el valor
        # publicado; se excluye de la busqueda por su nombre de macro.
        cuerpo_pub = pub + handler
        check(prohibido not in cuerpo_pub,
              f"el camino de publicacion no nombra '{prohibido}'")

    print(f"\nPROVISION_BRIDGE: {checks} comprobaciones estructurales, "
          f"{len(failures)} fallidas")
    if failures:
        print("PROVISION_BRIDGE: FALLO")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PROVISION_BRIDGE_WIRED = TRUE sobre el arbol de trabajo "
          "(residual declarado: analisis de texto acotado por funcion, sin AST)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
