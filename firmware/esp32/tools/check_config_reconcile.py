#!/usr/bin/env python3
"""
CONFIG_RECONCILIATION · guarda ESTRUCTURAL de la cadena config/desired.

POR QUE HACE FALTA, Y POR QUE NO BASTA LA SUITE DE HOST.

`main/` y `components/diana_platform_esp/` NO se compilan en la suite en C.
test_config_reconcile.c demuestra que la DECISION es correcta (apply / noop /
reject, sin reloj, persistida en NVS). Lo que ninguna prueba en C puede
demostrar es lo que rompio la cadena de verdad en el modulo fisico:

  1. QUIEN EMITE LAS SUSCRIPCIONES Y CUANDO. El defecto medido era que
     app_main.c llamaba a diana_platform_mqtt_subscribe() en la linea siguiente
     a diana_platform_mqtt_start(), con el cliente aun SIN conectar.
     esp_mqtt_client_subscribe() sobre un cliente no conectado devuelve -1 y no
     encola nada, y ningun otro punto volvia a suscribirse: el modulo nunca
     estuvo suscrito a `config/desired` y el retenido v1 no le llego jamas.
     Este fichero fija que la emision cuelga de MQTT_EVENT_CONNECTED.

  2. QUE EL DESPACHADOR USA LA LOGICA PROBADA. El handler anterior leia
     `config_version` con cJSON, copiaba el numero y tiraba el resto del
     payload. La suite quedaba en verde igualmente, porque no ejecuta ese
     fichero. Aqui se fija que el handler llama a diana_config_parse,
     diana_config_decide, diana_config_apply y diana_config_save.

AFIRMACION HONESTA, con su residual: es analisis de TEXTO FUENTE acotado por
bloques de funcion (llaves equilibradas), no un AST ni analisis de flujo.

    CONFIG_RECONCILIATION_WIRED = TRUE sobre el arbol de trabajo actual

y NO "es imposible reintroducir el defecto". Lo que si garantiza es que la
REGRESION EVIDENTE --volver a suscribirse antes del CONNACK, o volver a
resolver la version a mano en el despachador-- sale ROJA en vez de pasar en
silencio, que es exactamente como se colo el defecto original.

Contador PROPIO: CONFIG_RECONCILIATION_CHECKS. No se suma a HOST_SUITE ni a
ningun otro: sumarlos mentiria sobre la cobertura.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
FW = HERE.parents[1]

MQTT_CLIENT = FW / "components" / "diana_platform_esp" / "src" / "mqtt_client.c"
APP_COMMANDS = FW / "main" / "app_commands.c"
APP_MAIN = FW / "main" / "app_main.c"
CORE_CML = FW / "components" / "diana_core" / "CMakeLists.txt"

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
    """Quita comentarios. Los de este arbol describen con detalle el defecto ya
    cerrado ('se suscribia antes del CONNACK'): buscar sobre el fuente crudo
    daria falsos positivos permanentes. Se analiza CODIGO, no prosa."""
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"//[^\n]*", " ", src)
    return src


def function_body(src: str, name: str) -> str | None:
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


def case_block(src: str, label: str) -> str | None:
    """Cuerpo de un `case X:` hasta su `break;`. Es lo que permite afirmar algo
    sobre la rama CONNECTED del handler y no sobre el handler entero."""
    m = re.search(rf"case\s+{re.escape(label)}\s*:", src)
    if not m:
        return None
    rest = src[m.end():]
    stop = rest.find("break;")
    return rest if stop < 0 else rest[: stop + 6]


def main() -> int:
    print("\n--- CONFIG_RECONCILIATION: la cadena config/desired -> NVS ---")

    mc = strip_comments(MQTT_CLIENT.read_text())
    ac = strip_comments(APP_COMMANDS.read_text())
    am = strip_comments(APP_MAIN.read_text())

    # ------------------------------------------- 1. cuando se suscribe --
    print("\n[1] las suscripciones se emiten DESPUES del CONNACK")

    connected = case_block(mc, "MQTT_EVENT_CONNECTED")
    check(connected is not None, "el handler tiene una rama MQTT_EVENT_CONNECTED")
    connected = connected or ""
    check("mqtt_do_subscribe" in connected,
          "P0: la rama del CONNACK EMITE las suscripciones "
          "(sin esto el modulo nunca recibe config/desired)")

    emisor = function_body(mc, "mqtt_do_subscribe")
    check(emisor is not None, "existe el emisor mqtt_do_subscribe")
    emisor = emisor or ""
    check("esp_mqtt_client_subscribe" in emisor,
          "el emisor es quien llama a esp_mqtt_client_subscribe")
    check('"config/desired"' in emisor,
          "config/desired esta entre los topicos suscritos")
    check(re.search(r"esp_mqtt_client_subscribe\s*\(\s*p->mqtt\s*,\s*topic\s*,\s*1\s*\)",
                    emisor) is not None,
          "config/desired se suscribe a QoS 1 (el retenido llega confirmado)")

    # La funcion publica NO puede volver a ser la que emite a ciegas: si alguien
    # le devuelve el esp_mqtt_client_subscribe directo, estamos otra vez donde
    # empezamos. Se exige que solo anote la intencion.
    publica = function_body(mc, "diana_platform_mqtt_subscribe")
    check(publica is not None, "existe diana_platform_mqtt_subscribe")
    publica = publica or ""
    check("esp_mqtt_client_subscribe" not in publica,
          "REGRESION: la funcion publica NO emite SUBSCRIBE por su cuenta "
          "(app_main la llama con el cliente todavia sin conectar)")
    check("sub_requested" in publica,
          "la funcion publica DECLARA la intencion de suscribirse")
    check(re.search(r"mqtt_connected\b", publica) is not None,
          "...y solo emite en caliente si YA hay conexion")

    # Las suscripciones no pueden depender de la sesion persistente del broker.
    check(mc.count("mqtt_do_subscribe(p)") >= 1,
          "la emision se repite en cada CONNACK, no una sola vez en el arranque")

    # ------------------------------------- 2. el despachador usa el core --
    print("\n[2] el despachador usa la logica PROBADA, no una suya")

    h = function_body(ac, "handle_config_desired")
    check(h is not None, "existe el handler handle_config_desired")
    h = h or ""

    for sym, why in (
        ("diana_config_parse", "parsea el payload con el parser probado en host"),
        ("diana_config_decide", "decide con la semantica del contrato"),
        ("diana_config_apply", "aplica con la funcion probada"),
        ("diana_config_save", "PERSISTE en NVS"),
        ("diana_publish_config_reported", "declara el resultado en config/reported"),
    ):
        check(sym in h, f"el handler {why} ({sym})")

    # El defecto original: resolver la version a mano con cJSON dentro del
    # handler. Si vuelve, sale rojo.
    check("cJSON" not in h,
          "REGRESION: el handler NO vuelve a parsear la config con cJSON "
          "(era el camino que descartaba todos los campos menos la version)")
    check(re.search(r"config_version\s*=", h) is None,
          "REGRESION: el handler NO escribe config_version a mano")

    # Las tres ramas del contrato, cada una explicita.
    for sym in ("DIANA_CFG_REJECT", "DIANA_CFG_NOOP"):
        check(len(re.findall(rf"\b{sym}\b", h)) == 1,
              f"la rama {sym} existe y es UNICA")

    # Persistir ANTES de declarar: si se publica primero y el guardado falla,
    # la base anota una version que el modulo pierde al reiniciar.
    i_save = h.find("diana_config_save")
    i_pub = h.rfind("diana_publish_config_reported")
    check(0 <= i_save < i_pub,
          "se PERSISTE antes de publicar el reported de la version aplicada")

    # El reloj no entra en la decision.
    for reloj in ("recv_us", "now_us", "time(", "calibrated_at"):
        check(reloj not in h,
              f"la decision no consulta el reloj ni sellos de tiempo ('{reloj}')")

    # El despachador sigue teniendo UNA sola rama para config/desired y delega.
    disp = function_body(ac, "diana_handle_message") or ""
    check(len(re.findall(r"kind\s*==\s*DIANA_ROUTE_MODULE_CONFIG_DESIRED", disp)) == 1,
          "config/desired tiene EXACTAMENTE una rama de despacho")
    check("handle_config_desired" in disp,
          "...y esa rama delega en el handler")

    # ------------------------------------------- 3. esta en el BINARIO --
    print("\n[3] el parser esta en el binario del dispositivo, no solo en host")
    # Ya paso con los seis fuentes de D1b: compilaban con el gcc de host y el
    # toolchain xtensa no los habia visto nunca.
    check('"src/config_parse.c"' in CORE_CML.read_text(),
          "config_parse.c esta registrado en el CMakeLists de diana_core")

    check("diana_platform_mqtt_subscribe" in am,
          "app_main declara la identidad de suscripcion al arrancar MQTT")

    # ----------------------------------------------------------- cierre --
    print(f"\nCONFIG_RECONCILIATION: {checks} comprobaciones estructurales, "
          f"{len(failures)} fallidas")
    if failures:
        for f in failures:
            print(f"  - {f}")
        print("CONFIG_RECONCILIATION_WIRED = FALSE")
        return 1
    print("CONFIG_RECONCILIATION_WIRED = TRUE sobre el arbol de trabajo "
          "(residual declarado: analisis de texto acotado por funcion, sin AST; "
          "la reconciliacion FISICA exige reiniciar el ESP32 y sigue PENDING)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
