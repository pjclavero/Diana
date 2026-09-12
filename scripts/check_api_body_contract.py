#!/usr/bin/env python3
"""
API_BODY_CONTRACT · el panel no puede mandar campos que el backend rechaza.

EL DEFECTO QUE ORIGINA ESTA GUARDA. La ampliacion v1.1 retiro `state` del canal
`maintenance/command`: el LED de mantenimiento se prueba por DURACION. El
backend se actualizo --- su DTO solo admite `duration_ms` y `request_id` --- y
el frontend se quedo en la version vieja, mandando `{ state }` en las DOS capas
(`diagnosticsApi.ts` y `realAdapter.ts`). Como NestJS corre con
`forbidNonWhitelisted: true`, la respuesta era 400 y la orden no llegaba a
publicarse: el boton de la pantalla de prueba de LED no encendia nada.

Ninguna suite lo veia. Las pruebas del panel MOCKEAN `testLed`, asi que
verifican que se llama, no lo que viaja en el cuerpo; y las del backend
construyen el DTO a mano. Cada lado estaba verde sobre su propia mitad.

QUE COMPRUEBA. Para cada ruta vigilada: los campos que el frontend pone en el
body tienen que estar TODOS declarados en el DTO del backend. Un campo de mas
es un 400 garantizado en produccion.

Residual DECLARADO: analisis de texto sobre llamadas acotadas, sin AST ni
ejecucion. Cubre las rutas de esta lista, no todas las del panel.

Contador PROPIO: API_BODY_CONTRACT_CHECKS.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
CTRL = RAIZ / "server/backend/src/modules/modules/module-diagnostics.controller.ts"
FRONT = [
    RAIZ / "server/frontend/src/api/diagnosticsApi.ts",
    RAIZ / "server/frontend/src/api/realAdapter.ts",
]

# ruta vigilada -> (fragmento que identifica la llamada, nombre del DTO)
RUTAS = {
    "test-led": "LedTestDto",
    "commands/identify": "IdentifyDto",
}


def campos_dto(nombre: str) -> set[str] | None:
    """Campos declarados en un DTO del controlador."""
    txt = CTRL.read_text()
    m = re.search(r"class %s\s*\{(.*?)\n\}" % re.escape(nombre), txt, re.S)
    if not m:
        return None
    # `campo?: tipo;` / `campo: tipo;`
    return set(re.findall(r"^\s{2}(\w+)\??\s*:", m.group(1), re.M))


def cuerpos_frontend(fragmento: str) -> list[tuple[str, set[str]]]:
    """Campos que el frontend pone en el body de esa ruta."""
    fuera = []
    for f in FRONT:
        txt = f.read_text()
        for m in re.finditer(re.escape(fragmento), txt):
            # ventana desde la llamada hasta el final del objeto de opciones
            trozo = txt[m.start(): m.start() + 900]
            for b in re.finditer(r"JSON\.stringify\((.*?)\)\s*[,}]", trozo, re.S):
                expr = b.group(1)
                campos = set(re.findall(r"(\w+)\s*:", expr))
                # `{ state }` abreviado: la clave es el propio identificador
                campos |= set(re.findall(r"\{\s*(\w+)\s*\}", expr))
                fuera.append((f.name, campos))
            break
    return fuera


def main() -> int:
    fallos: list[str] = []
    checks = 0

    def check(cond: bool, desc: str) -> None:
        nonlocal checks
        checks += 1
        print(("  ok    · " if cond else "  FALLO · ") + desc)
        if not cond:
            fallos.append(desc)

    print("== API_BODY_CONTRACT ==\n")
    check(CTRL.exists(), "existe el controlador de diagnosticos")
    for f in FRONT:
        check(f.exists(), "existe %s" % f.name)

    for fragmento, dto in RUTAS.items():
        print("\n[%s] contra %s" % (fragmento, dto))
        admitidos = campos_dto(dto)
        if admitidos is None:
            print("  (el DTO %s no existe: ruta no vigilada)" % dto)
            continue
        print("    el backend admite: %s" % ", ".join(sorted(admitidos)))
        cuerpos = cuerpos_frontend(fragmento)
        check(bool(cuerpos), "se localiza el cuerpo que manda el frontend")
        for fichero, campos in cuerpos:
            sobra = campos - admitidos
            check(not sobra,
                  "%s manda solo campos admitidos%s"
                  % (fichero, "" if not sobra else
                     " --- SOBRA: %s (400 con forbidNonWhitelisted)" % ", ".join(sorted(sobra))))

    print("\n[control] el backend rechaza de verdad lo no declarado")
    main_ts = (RAIZ / "server/backend/src/main.ts").read_text()
    check("forbidNonWhitelisted: true" in main_ts,
          "forbidNonWhitelisted sigue activo (si no, esta guarda perderia sentido)")

    print("\nAPI_BODY_CONTRACT: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
    if fallos:
        print("API_BODY_CONTRACT: FALLO")
        return 1
    print("API_BODY_CONTRACT = OK (residual declarado: texto sobre las rutas de "
          "esta lista, sin AST ni ejecucion)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
