#!/usr/bin/env python3
"""
AUTHORITY_EXCLUSION · mantenimiento no puede pisar la senalizacion del juego.

LO QUE ENCONTRO LA REVISION INDEPENDIENTE. `identify` estaba clasificado como
'read' --- "no actua sobre el hardware" segun el contrato --- y en realidad
ilumina las NUEVE dianas con el barrido cian, sobreescribiendo los estados de
juego. El backend, respetando esa clasificacion, lo aceptaba con la partida
corriendo. Es duplicacion de autoridad: el canal de mantenimiento podia borrar
la senalizacion del coordinador con una orden declarada inocua.

P1.5 lo reclasifica a 'act', sin excepcion: sujeto a 6-bis como cualquier otra
actuacion fisica. Se acepta la consecuencia (sin reloj no se puede hacer
parpadear un modulo para localizarlo) antes que abrir una categoria intermedia.

P1.6 anade la exclusion: con autoridad de juego activa, toda orden de
mantenimiento que modifique salidas fisicas se DENIEGA. El backend lo impide
antes de publicar, pero el modulo es la ultima autoridad --- esconder el boton
en el panel no es una defensa, y una orden puede llegar por otra via.

Las lecturas puras siguen funcionando durante la partida.

Residual DECLARADO: texto acotado por funcion, sin AST. main/ no se compila en
la suite de host.

Contador PROPIO: AUTHORITY_EXCLUSION_CHECKS.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
RAIZ = FW.parents[1]
CMDS = FW / "main/app_commands.c"
CORE = FW / "components/diana_core/src/command.c"
ESQUEMA = RAIZ / "contracts/mqtt/module-maintenance-command.schema.json"
BACKEND = RAIZ / "server/backend/src/modules/modules/module-diagnostics.service.ts"
SIM = RAIZ / "simulators/src/domain/moduleSimulator.ts"


def main() -> int:
    fallos: list[str] = []
    checks = 0

    def check(cond: bool, desc: str) -> None:
        nonlocal checks
        checks += 1
        print(("  ok    · " if cond else "  FALLO · ") + desc)
        if not cond:
            fallos.append(desc)

    print("== AUTHORITY_EXCLUSION ==\n")

    core = CORE.read_text()
    cmds = CMDS.read_text()

    print("[1] identify es ACT en las CUATRO capas")
    # nucleo: identify cae en el grupo de act
    m = re.search(r"diana_maintenance_category_of.*?\n\}", core, re.S)
    cuerpo = m.group(0) if m else ""
    lectura = cuerpo.split("return DIANA_MNT_CAT_READ")[0] if "CAT_READ" in cuerpo else ""
    check("DIANA_MNT_IDENTIFY" not in lectura,
          "firmware: identify NO esta entre las lecturas")
    check("DIANA_MNT_IDENTIFY" in cuerpo, "firmware: identify esta clasificado")

    desc = json.loads(ESQUEMA.read_text())["properties"]["command_type"]["description"]
    check("led_test, identify" in desc or "identify, piezo_test" in desc,
          "contrato: identify figura entre las 'act'")
    check("request_telemetry, query_version, query_status" in desc,
          "contrato: identify ya NO figura entre las 'read'")

    back = BACKEND.read_text()
    m = re.search(r"ACTING_COMMAND_TYPES[^=]*=\s*new Set\(\[(.*?)\]\)", back, re.S)
    acting = m.group(1) if m else ""
    check("'identify'" in acting, "backend: identify esta en ACTING_COMMAND_TYPES")

    sim = SIM.read_text()
    check(re.search(r"identify:\s*'act'", sim) is not None,
          "simulador: identify es 'act' (si no, aceptaria lo que el modulo rechaza)")

    print("\n[2] el modulo IMPONE la exclusion, no solo el backend")
    # La condicion tiene que estar VIVA. Comprobar que la llamada aparece en el
    # fichero es comprobar presencia, no alcanzabilidad: `if (false && ...)`
    # deja el texto intacto. Ya paso una vez con el publicador de resultados
    # (M28) y volvio a pasar aqui (M31); esta vez se mira la condicion entera.
    cond = re.search(r"if\s*\(([^)]*diana_maintenance_touches_output[^)]*\)[^{]*)\{",
                     cmds, re.S)
    texto_cond = cond.group(1) if cond else ""
    check(bool(texto_cond), "se localiza la condicion de exclusion")
    check(not re.search(r"\b(false|0)\s*&&", texto_cond),
          "la condicion NO esta neutralizada con `false &&` / `0 &&`")
    check("diana_maintenance_touches_output" in core,
          "existe la frontera de 'modifica salida fisica'")
    check("diana_maintenance_touches_output" in cmds and
          "diana_module_fsm_game_in_progress" in cmds,
          "app_commands cruza esa frontera con la autoridad de juego")
    check("DIANA_REJECT_GAME_IN_PROGRESS" in cmds,
          "la denegacion usa el motivo del vocabulario cerrado")
    # la comprobacion tiene que ir ANTES de ejecutar nada
    i_excl = cmds.find("diana_maintenance_touches_output")
    i_exec = cmds.find("execute_maintenance(a, type,")
    check(i_excl > 0 and i_exec > 0 and i_excl < i_exec,
          "la exclusion se evalua ANTES de ejecutar la orden")

    print("\n[3] lo que NO se bloquea, y por que")
    tocan = re.search(r"diana_maintenance_touches_output.*?\n\}", core, re.S)
    cuerpo_t = tocan.group(0) if tocan else ""
    check("DIANA_MNT_ABORT_CALIBRATION" in cuerpo_t and
          "return false" in cuerpo_t.split("DIANA_MNT_ABORT_CALIBRATION")[1][:200],
          "abort_calibration NO se bloquea: es 'safety' y se acepta siempre")
    check("DIANA_MNT_SELF_TEST" in cuerpo_t,
          "self_test esta nombrado explicitamente, no cae en el default")

    print("\nAUTHORITY_EXCLUSION: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
    if fallos:
        print("AUTHORITY_EXCLUSION: FALLO")
        return 1
    print("AUTHORITY_EXCLUSION = OK (residual declarado: texto acotado por "
          "funcion, sin AST; el E2E lo demuestra el banco)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
