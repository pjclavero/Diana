#!/usr/bin/env python3
"""
COORDINATOR_WIRING · el rol de coordinador tiene que estar CABLEADO, no escrito.

POR QUE EXISTE. El nucleo de decision vive en diana_core y la suite de host lo
ejercita. Pero el cableado --- suscribirse a la entrada solo si el selector es
PRINCIPAL, parsear el sobre, llamar al nucleo y publicar lo que decida --- vive
en main/ y en el componente ESP, que NO se compilan en host. Ese es exactamente
el hueco por el que ya se colaron tres defectos en este proyecto: `provision` y
`config/desired` con handler y sin suscripcion, y `maintenance/command` con una
rama que solo registraba un aviso.

Un rol de coordinador "presente pero inalcanzable" seria peor que no tenerlo:
el backend elegiria un coordinador, el ACL le daria permisos, y no coordinaria.

QUE COMPRUEBA:
  · la suscripcion a system/{id}/command existe y es CONDICIONAL al rol;
  · un satelite no se suscribe ni conserva autoridad;
  · el parser del sobre llega al nucleo;
  · las dos publicaciones existen y usan los constructores del contrato;
  · el selector estable gobierna el rol en caliente, en los DOS sentidos.

Residual DECLARADO: texto acotado por funcion, sin AST. El comportamiento lo
prueban test_coordinator.c y el banco.

Contador PROPIO: COORDINATOR_WIRING_CHECKS.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
MQTT = FW / "components/diana_platform_esp/src/mqtt_client.c"
CMDS = FW / "main/app_commands.c"
TASKS = FW / "main/app_tasks.c"
MAIN = FW / "main/app_main.c"


def vivo(texto: str) -> str:
    """Sin comentarios ni ramas desactivadas: presencia no es alcanzabilidad."""
    texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)
    texto = re.sub(r"//[^\n]*", "", texto)
    # `if (false) <sentencia>;` deja el texto intacto y una guarda que busca
    # presencia lo da por bueno. Ya paso con el publicador de resultados de
    # mantenimiento (M28) y con la exclusion juego/mantenimiento (M31); aqui
    # volvio a pasar con la publicacion del comando (M39). Se retira.
    texto = re.sub(r"if\s*\(\s*(?:0|false)\s*\)\s*[^;{]*;", " ", texto)
    return texto


def bloque(texto: str, inicio: str) -> str:
    """Cuerpo de una funcion. Busca la DEFINICION, no la declaracion adelantada:
    coger el `;` de un prototipo devuelve un bloque vacio y la guarda falla por
    su propio localizador, no por el codigo."""
    i = -1
    for m in re.finditer(re.escape(inicio), texto):
        resto = texto[m.end(): m.end() + 200]
        if "{" in resto.split(";")[0]:
            i = m.start()
            break
    if i < 0:
        return ""
    j = texto.find("\n}\n", i)
    return texto[i: j if j > 0 else len(texto)]


def main() -> int:
    fallos: list[str] = []
    checks = 0

    def check(cond: bool, desc: str) -> None:
        nonlocal checks
        checks += 1
        print(("  ok    · " if cond else "  FALLO · ") + desc)
        if not cond:
            fallos.append(desc)

    print("== COORDINATOR_WIRING ==\n")

    mqtt = vivo(MQTT.read_text())
    cmds = vivo(CMDS.read_text())
    tasks = vivo(TASKS.read_text())
    main_c = vivo(MAIN.read_text())

    print("[1] la ENTRADA del coordinador se suscribe, y solo si es PRINCIPAL")
    sub = bloque(mqtt, "static int mqtt_do_subscribe")
    check("system/%s/command" in sub,
          "mqtt_do_subscribe emite la suscripcion a system/{id}/command")
    check("coord_active" in sub,
          "y lo hace CONDICIONADO al rol (coord_active)")
    # la condicion no puede estar neutralizada
    cond = re.search(r"if\s*\(([^)]*coord_active[^)]*)\)", sub)
    check(cond is not None and not re.search(r"\b(false|0)\s*&&", cond.group(1)),
          "la condicion del rol NO esta neutralizada")
    check("diana_platform_mqtt_set_coordinator" in mqtt,
          "existe el interruptor de rol en el transporte")
    setc = bloque(mqtt, "int diana_platform_mqtt_set_coordinator")
    check("esp_mqtt_client_unsubscribe" in setc,
          "al desactivar se DESUSCRIBE de verdad, no solo deja de atender")

    print("\n[2] el sobre se parsea y llega al NUCLEO")
    check("parse_system_command" in cmds, "existe el parser de system-command")
    hs = bloque(cmds, "static void handle_system_command")
    check("diana_coordinator_on_system_command" in hs,
          "el handler llama al nucleo de decision")
    check("a->selector == DIANA_SELECTOR_PRINCIPAL" in hs,
          "y le pasa la autoridad derivada del selector, no un true fijo")
    check("DIANA_ROUTE_SYSTEM_COMMAND" in cmds,
          "el despachador enruta system/{id}/command a ese handler")

    print("\n[3] las dos publicaciones existen")
    check("diana_publish_module_command" in tasks and
          "diana_publish_game_state" in tasks,
          "existen los publicadores de module/{id}/command y game/state")
    pmc = bloque(tasks, "void diana_publish_module_command")
    check("diana_topic_build" in pmc,
          "el comando usa el constructor de topicos del contrato")
    pgs = bloque(tasks, "void diana_publish_game_state")
    check("diana_system_topic_build" in pgs and "DIANA_SYS_TOPIC_GAME_STATE" in pgs,
          "game/state usa el constructor de topicos de SISTEMA")
    check(".retain = true" in pgs,
          "game/state se publica RETENIDO, como exige el contrato")
    check("emit_command" in pmc and "emit_state" in pgs,
          "cada publicador respeta la decision del plan")
    # Que el publicador EXISTA no basta: el handler tiene que LLAMARLO.
    check("diana_publish_module_command(a, &plan)" in hs,
          "el handler publica el comando que decidio el nucleo")
    check("diana_publish_game_state(a, &plan)" in hs,
          "y publica el estado de partida")

    print("\n[4] el selector gobierna el rol EN CALIENTE, en los dos sentidos")
    tarea = bloque(tasks, "void diana_task_inputs")
    check("diana_platform_mqtt_set_coordinator" in tarea,
          "el cambio de selector reconfigura el rol")
    check("diana_coordinator_reset" in tarea,
          "y al dejar de ser PRINCIPAL se olvida la partida en curso")
    check("DIANA_SELECTOR_PRINCIPAL" in tarea,
          "la condicion es PRINCIPAL, no 'cualquier cosa que no sea satelite'")
    check("diana_platform_mqtt_set_coordinator" in main_c,
          "y en el arranque se anota el rol del selector inicial")

    print("\n[5] el cambio de selector se PROPAGA (paso 2.5)")
    # El antirrebote y la deteccion de cambio viven en el nucleo y se prueban
    # por ejecucion (test_selector_track.c). Aqui solo se fija que la tarea use
    # ese nucleo y publique al cambiar: sin la publicacion, el backend no se
    # entera hasta el siguiente status espontaneo --- y `status` es retenido, no
    # periodico.
    check("diana_selector_track(" in tarea,
          "la tarea usa el seguimiento del nucleo, no un antirrebote propio")
    check("DIANA_SEL_EV_CAMBIO" in tarea,
          "y actua sobre el EVENTO de cambio, no sobre cada lectura")
    cambio = tarea.split("DIANA_SEL_EV_CAMBIO", 1)[1] if "DIANA_SEL_EV_CAMBIO" in tarea else ""
    check("diana_publish_status(a)" in cambio,
          "al cambiar el selector se publica module-status inmediatamente")
    check("DIANA_SEL_EV_INVALIDO" in tarea,
          "el transito se distingue del cambio y no mueve el rol")

    print("\nCOORDINATOR_WIRING: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
    if fallos:
        print("COORDINATOR_WIRING: FALLO")
        return 1
    print("COORDINATOR_WIRING = OK (residual declarado: texto acotado por "
          "funcion, sin AST; el comportamiento lo prueban test_coordinator.c "
          "y el banco)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
