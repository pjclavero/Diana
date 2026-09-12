#!/usr/bin/env python3
"""
MAINTENANCE_RETURN_PATH · una orden de mantenimiento tiene que poder demostrar
que hizo, o por que no lo hizo.

EL DEFECTO QUE ORIGINA ESTA GUARDA, encontrado por la revision independiente.
El canal de mantenimiento publicaba sus rechazos con el publicador GENERICO
`diana_publish_diagnostic()`, que construye el diagnostico con
`diana_diagnostic_init()` y deja `has_request_id = false`. El serializador exige
correlacion para kind=command_rejected --- con razon: un rechazo incorrelable no
sirve --- y devuelve 0. Y el publicador hacia `if (n) publish(...)`, asi que el
rechazo se tiraba SIN DEJAR RASTRO.

Resultado: `led_test` sin `target_index`, con indice fuera de rango, `piezo_test`
no implementado, la orden caducada por 6-bis, el duplicado y el mensaje retenido
se rechazaban en el modulo y NADIE se enteraba. El panel se quedaba esperando
una respuesta que no existia. La guarda del serializador era correcta y el
emisor la incumplia.

Ademas el modulo tampoco publicaba el resultado de una orden ACEPTADA: solo
`status` con `last_command`, que el backend NO consume (comprobado: cero
apariciones de `last_command` en server/backend/src).

QUE COMPRUEBA:
  · que NADIE publique command_rejected por la via generica (se perderia);
  · que los caminos de rechazo del canal correlen por request_id;
  · que el camino de exito publique un resultado correlado;
  · que un diagnostico no serializado se REGISTRE en vez de desaparecer.

Residual DECLARADO: analisis de texto acotado por funcion, sin AST. main/ no se
compila en la suite de host, que es justamente por lo que esto hizo falta.

Contador PROPIO: MAINTENANCE_RETURN_PATH_CHECKS.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
CMDS = FW / "main/app_commands.c"
TASKS = FW / "main/app_tasks.c"


def sin_desactivar(texto: str) -> str:
    """Quita comentarios y cuerpos desactivados con `if (0)` / `if (false)`.

    Buscar la cadena a pelo comprueba PRESENCIA, no alcanzabilidad: un
    `if (0) diana_publish_maintenance_result(...)` deja el texto intacto y la
    guarda pasaba. Lo cazo la calibracion (M28), no el diseno original.
    """
    texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)
    texto = re.sub(r"//[^\n]*", "", texto)
    # `if (0)` y `if (false)` desactivan lo que sigue: se retira la sentencia.
    texto = re.sub(r"if\s*\(\s*(?:0|false)\s*\)\s*[^;{]*(?:\([^;]*\))?\s*;",
                   " ", texto, flags=re.S)
    return texto


def bloque(texto: str, inicio: str) -> str:
    i = texto.find(inicio)
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

    print("== MAINTENANCE_RETURN_PATH ==\n")

    cmds = sin_desactivar(CMDS.read_text())
    tasks = sin_desactivar(TASKS.read_text())

    print("[1] command_rejected NUNCA por la via generica")
    # `diana_publish_diagnostic(a, DIANA_DIAG_COMMAND_REJECTED, ...)` se descarta
    malos = re.findall(
        r"diana_publish_diagnostic\s*\([^;]*DIANA_DIAG_COMMAND_REJECTED", cmds + tasks, re.S)
    check(not malos,
          "ningun command_rejected se publica con diana_publish_diagnostic "
          "(%d encontrados)" % len(malos))
    check("diana_publish_command_rejected" in cmds,
          "el canal usa el publicador CORRELADO")

    print("\n[2] todos los caminos de rechazo del canal correlan")
    ejec = bloque(cmds, "static void execute_maintenance")
    hand = bloque(cmds, "static void handle_maintenance")
    check(bool(ejec) and bool(hand), "se localizan execute_maintenance y handle_maintenance")
    check(ejec.count("diana_publish_command_rejected") >= 3,
          "execute_maintenance correla sus rechazos de params (>=3)")
    check(hand.count("diana_publish_command_rejected") >= 3,
          "handle_maintenance correla retenido, reloj y guardian (>=3)")
    check("request_id" in ejec,
          "execute_maintenance recibe el request_id con que correlar")

    print("\n[3] la orden ACEPTADA publica su resultado")
    check("diana_publish_maintenance_result" in ejec,
          "execute_maintenance publica el resultado correlado")
    res = bloque(tasks, "void diana_publish_maintenance_result")
    check(bool(res), "existe el publicador de resultado")
    check("diana_is_uuid" in res,
          "el resultado exige un request_id valido: no se publica incorrelable")
    check("has_request_id = true" in res,
          "y lo marca en el diagnostico")

    print("\n[4] un diagnostico que no serializa se DICE")
    # el silencio fue lo que oculto el defecto
    silenciosos = re.findall(
        r"if \(n\) publish\(a, a->topic_diagnostic[^;]*;\s*\n\s*free",
        TASKS.read_text())
    check(not silenciosos,
          "ningun `if (n) publish(...)` de diagnostico se queda sin rama else "
          "(%d encontrados)" % len(silenciosos))
    check(TASKS.read_text().count("NO serializado") >= 2,
          "los descartes de serializacion se registran como error")

    print("\nMAINTENANCE_RETURN_PATH: %d comprobaciones, %d fallidas"
          % (checks, len(fallos)))
    if fallos:
        print("MAINTENANCE_RETURN_PATH: FALLO")
        return 1
    print("MAINTENANCE_RETURN_PATH = OK (residual declarado: texto acotado por "
          "funcion, sin AST; el E2E lo demuestra el banco)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
