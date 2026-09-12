#!/usr/bin/env python3
"""
TOPIC_SUBSCRIPTIONS · un handler sin suscripcion es codigo inalcanzable.

EL DEFECTO QUE ORIGINA ESTA GUARDA, tres veces en este proyecto. El despachador
tenia una rama para `module/{id}/maintenance/command` --- con su comentario, su
enrutado exacto y su TopicKind --- y NADIE se suscribia al topico. El codigo
estaba escrito, compilado, enlazado y era INALCANZABLE: ninguna orden del panel
llego jamas al modulo. Antes le habia pasado a `provision` (D1b "cableado pero
no alcanzable por transporte") y a `config/desired` (suscripcion emitida antes
del CONNACK, con lo que el retenido no llegaba).

Ninguna prueba de host puede cazarlo: mqtt_client.c no se compila ahi, y en la
suite el despachador se invoca a mano, asi que sus ramas se ejercitan aunque el
firmware real no reciba nunca ese topico.

QUE COMPRUEBA. Para cada TopicKind que el despachador ATIENDE de verdad --- una
rama que llama a un handler, no una que solo registra ---, exige que el topico
correspondiente este en la tabla de suscripciones de mqtt_client.c. La
correspondencia kind -> sufijo se lee de la tabla contractual de topic_route.c,
no de una lista repetida aqui: si el contrato cambia, esta guarda lo sigue.

Tambien informa de la direccion contraria --- suscrito sin handler ---, que no
es un fallo: `system/+/game/state` esta suscrito a proposito y su consumo no
esta implementado. Se dice, no se aprueba en silencio.

Residual DECLARADO: analisis de texto sobre fuentes acotadas, sin AST.

Contador PROPIO: TOPIC_SUBSCRIPTIONS_CHECKS.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
RUTAS = FW / "components/diana_core/src/topic_route.c"
CLIENTE = FW / "components/diana_platform_esp/src/mqtt_client.c"
DESPACHADOR = FW / "main/app_commands.c"

# Topicos que el modulo PUBLICA: suscribirse a lo que uno emite solo ensancha
# la superficie. Si alguno tuviera handler, seria un error de diseno, no una
# suscripcion que falta.
SOLO_SALIDA = {
    "DIANA_ROUTE_MODULE_PRESENCE", "DIANA_ROUTE_MODULE_STATUS",
    "DIANA_ROUTE_MODULE_TELEMETRY", "DIANA_ROUTE_MODULE_HIT",
    "DIANA_ROUTE_MODULE_DIAGNOSTIC", "DIANA_ROUTE_MODULE_CONFIG_REPORTED",
    "DIANA_ROUTE_MODULE_PROVISION_STATE",
}


def tabla_rutas() -> dict[str, tuple[str, str]]:
    """kind -> (scope, sufijo), leido de la tabla contractual."""
    txt = RUTAS.read_text()
    cuerpo = txt[txt.index("static const route_entry TABLE[]"):]
    cuerpo = cuerpo[: cuerpo.index("};")]
    fuera = {}
    for sc, tail, kind in re.findall(
            r'\{\s*(SC_\w+)\s*,\s*"([^"]+)"\s*,\s*(DIANA_ROUTE_\w+)', cuerpo):
        fuera[kind] = (sc, tail)
    return fuera


def suscripciones() -> tuple[set[str], list[str]]:
    """Sufijos de modulo suscritos, y topicos absolutos suscritos aparte."""
    txt = CLIENTE.read_text()
    m = re.search(r"suffixes\s*\[\s*\]\s*=\s*\{(.*?)\}", txt, re.S)
    sufijos = set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()
    absolutos = re.findall(r'esp_mqtt_client_subscribe\(\s*p->mqtt\s*,\s*"([^"]+)"',
                           txt)
    # Suscripciones CONSTRUIDAS: el topico se arma con snprintf y luego se pasa
    # por variable. La del coordinador es asi porque lleva el system_id. Se
    # recogen las cadenas de formato que se suscriben, para no dar por ausente
    # una suscripcion que existe --- y sin aflojar la regla: si nadie se
    # suscribe, tampoco aparecera aqui.
    if re.search(r"esp_mqtt_client_subscribe\(\s*p->mqtt\s*,\s*topic\b", txt):
        absolutos += [f.replace("%s", "+")
                      for f in re.findall(r'snprintf\(topic[^;]*?"([^"]*%s[^"]*)"', txt, re.S)]
    return sufijos, absolutos


def atendidos() -> dict[str, bool]:
    """kind -> True si su rama LLAMA a un handler (no si solo registra)."""
    txt = DESPACHADOR.read_text()
    fuera: dict[str, bool] = {}
    for m in re.finditer(r"kind\s*==\s*(DIANA_ROUTE_\w+)\s*\)\s*\{(.*?)\n    \}",
                         txt, re.S):
        kind, cuerpo = m.group(1), m.group(2)
        # "Atender" no es tener una rama: es EJECUTAR algo. Una rama que solo
        # registra un aviso --- como la que tenia maintenance/command --- deja
        # el topico sin atender por mucho que exista el `if`. La primera
        # version de esta guarda buscaba solo `handle_*` y dio por no atendido
        # module/{id}/command, que se despacha con `execute(...)`.
        llama = re.search(
            r"\b(handle_\w+|execute\w*|diana_\w+_handle|diana_command_validate)\s*\(",
            cuerpo) is not None
        fuera[kind] = fuera.get(kind, False) or llama
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

    print("== TOPIC_SUBSCRIPTIONS ==\n")

    rutas = tabla_rutas()
    check(len(rutas) >= 15, "se lee la tabla contractual de topic_route.c (%d rutas)" % len(rutas))
    sufijos, absolutos = suscripciones()
    check(bool(sufijos), "se lee la tabla de suscripciones de mqtt_client.c")
    ramas = atendidos()
    check(bool(ramas), "se leen las ramas del despachador")

    print("\n[1] todo handler tiene su suscripcion")
    con_handler = sorted(k for k, v in ramas.items() if v)
    check(bool(con_handler), "el despachador atiende al menos un topico")
    for kind in con_handler:
        if kind not in rutas:
            check(False, "%s no esta en la tabla contractual" % kind)
            continue
        sc, tail = rutas[kind]
        if kind in SOLO_SALIDA:
            check(False, "%s tiene handler pero es un topico que el modulo PUBLICA" % kind)
            continue
        if sc == "SC_MODULE":
            check(tail in sufijos,
                  "%s ('%s') esta suscrito" % (kind, tail))
        else:
            hay = any(tail in a for a in absolutos)
            check(hay, "%s ('system/.../%s') esta suscrito" % (kind, tail))

    print("\n[2] el caso concreto que estaba roto")
    check("maintenance/command" in sufijos,
          "module/{id}/maintenance/command --- el canal del backend --- esta suscrito")
    check(ramas.get("DIANA_ROUTE_MODULE_MAINTENANCE_COMMAND", False),
          "y el despachador lo ATIENDE con un handler, no con un aviso")

    print("\n[3] suscrito sin handler (informativo, no es fallo)")
    sin_handler = []
    for kind, (sc, tail) in rutas.items():
        suscrito = tail in sufijos if sc == "SC_MODULE" else any(tail in a for a in absolutos)
        if suscrito and not ramas.get(kind, False):
            sin_handler.append("%s ('%s')" % (kind, tail))
    for s in sorted(sin_handler):
        print("  aviso · %s: suscrito y sin handler" % s)
    if not sin_handler:
        print("  (ninguno)")

    print("\nTOPIC_SUBSCRIPTIONS: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
    if fallos:
        print("TOPIC_SUBSCRIPTIONS: FALLO")
        return 1
    print("TOPIC_SUBSCRIPTIONS = OK (residual declarado: analisis de texto sobre "
          "fuentes acotadas, sin AST)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
