#!/usr/bin/env python3
"""
LED_TEST_INDEPENDENCE · cada prueba de LED es de UNA diana y no toca a las demas.

LOS TRES DEFECTOS QUE ORIGINAN ESTA GUARDA, medidos en el banco con la placa
delante:

  · encender D2 APAGABA D1;
  · "apagar D1" apagaba en realidad la ultima diana encendida (D4);
  · habia un unico plazo, el de la ultima orden.

Causa unica: el estado de `led_test` era UN HUECO GLOBAL --- un `uint8_t`
led_test_target y un `uint64_t` led_test_until_us ---, asi que cada orden pisaba
la anterior y la rama de apagado borraba ese hueco sin mirar que diana se pedia.
Nada en el contrato dice que una prueba deba cancelar otra: cada `led_test`
lleva su `target_index` y su `duration_ms`.

La suite de host prueba el RENDER (mascara de 9 bits). Lo que no puede probar es
el ESTADO, porque vive en main/app.h, main/app_commands.c y main/app_tasks.c, y
`main/` no se compila en host. Eso es lo que se fija aqui.

Residual DECLARADO: analisis de texto acotado por fichero y por funcion, sin
AST. El comportamiento lo prueban test_led.c y el banco.

Contador PROPIO: LED_TEST_INDEPENDENCE_CHECKS.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
APP_H = FW / "main/app.h"
CMDS = FW / "main/app_commands.c"
TASKS = FW / "main/app_tasks.c"
LED_H = FW / "components/diana_core/include/diana/led.h"


def main() -> int:
    fallos: list[str] = []
    checks = 0

    def check(cond: bool, desc: str) -> None:
        nonlocal checks
        checks += 1
        print(("  ok    · " if cond else "  FALLO · ") + desc)
        if not cond:
            fallos.append(desc)

    print("== LED_TEST_INDEPENDENCE ==\n")

    app_h = APP_H.read_text()
    cmds = CMDS.read_text()
    tasks = TASKS.read_text()
    led_h = LED_H.read_text()

    print("[1] el estado es POR DIANA, no un hueco global")
    check(re.search(r"uint64_t\s+led_test_until_us\s*\[\s*DIANA_TARGET_COUNT\s*\]",
                    app_h) is not None,
          "app.h declara led_test_until_us[] con una entrada por diana")
    check("led_test_target" not in app_h + cmds + tasks,
          "no queda ningun `led_test_target` (el indice global del defecto)")

    print("\n[2] el apagado es DIRIGIDO")
    # rama de led_test dentro de execute_maintenance
    m = re.search(r"case DIANA_MNT_LED_TEST:(.*?)\n    case ", cmds, re.S)
    check(m is not None, "se localiza la rama de led_test")
    rama = m.group(1) if m else ""
    check(re.search(r"led_test_until_us\s*\[\s*idx\s*-\s*1\s*\]\s*=\s*0", rama)
          is not None,
          "duration_ms=0 pone a cero SOLO el vencimiento de la diana pedida")
    check(re.search(r"led_test_until_us\s*\[\s*idx\s*-\s*1\s*\]\s*=\s*now", rama)
          is not None,
          "encender fija el vencimiento de esa misma diana")
    # ninguna asignacion a un escalar suelto
    check(re.search(r"led_test_until_us\s*=\s*0", rama) is None,
          "no se borra ningun vencimiento global en la rama de apagado")

    print("\n[3] la caducidad se evalua DIANA A DIANA")
    check(re.search(r"for\s*\([^)]*DIANA_TARGET_COUNT[^)]*\)\s*\{[^}]*led_test_until_us",
                    tasks, re.S) is not None,
          "app_tasks recorre las nueve para caducarlas por separado")
    check("test_mask" in tasks and "DIANA_LED_TEST_BIT" not in tasks,
          "construye una mascara de bits para el render")
    check(re.search(r"led_test_until_us\s*\[\s*i\s*\]\s*=\s*0", tasks) is not None,
          "al vencer, pone a cero SOLO esa diana")

    print("\n[4] el render acepta varias dianas a la vez")
    check("uint16_t test_mask" in led_h,
          "diana_led_render_chain recibe una MASCARA, no un indice")
    check("DIANA_LED_TEST_BIT" in led_h,
          "existe el bit por diana, para que la mascara no se arme a mano")

    print("\nLED_TEST_INDEPENDENCE: %d comprobaciones, %d fallidas"
          % (checks, len(fallos)))
    if fallos:
        print("LED_TEST_INDEPENDENCE: FALLO")
        return 1
    print("LED_TEST_INDEPENDENCE = OK (residual declarado: texto acotado por "
          "funcion, sin AST; el comportamiento lo prueban test_led.c y el banco)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
