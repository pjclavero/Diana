#!/usr/bin/env python3
"""
MQTT_REASSEMBLY · el reensamblado tiene que estar CABLEADO en el firmware real.

La logica de reensamblado vive en `diana_core/src/mqtt_reasm.c` y la suite de
host la ejercita fragmento a fragmento (test_mqtt_reasm.c). Pero el fichero
donde estaba el defecto --- `diana_platform_esp/src/mqtt_client.c` --- NO se
compila en host: se puede dejar la logica escrita, probada y verde, y que el
manejador de eventos siga copiando `data_len` a pelo. Eso ya paso antes en este
proyecto con las suscripciones. Esta guarda cierra ese hueco.

Comprueba, sobre el manejador de MQTT_EVENT_DATA acotado por funcion:
  · que llama al reensamblador con las TRES cifras del evento;
  · que NO copia `ev->data` directamente al payload (el defecto original);
  · que un mensaje incompleto o erroneo no llega a la cola;
  · que el estado sobrevive entre eventos (vive en la estructura, no en pila);
  · que una desconexion lo limpia;
  · y que `mqtt_reasm.c` esta en el CMakeLists de diana_core, porque un fuente
    que solo compila con el gcc de host no esta en el binario del ESP32.

Residual DECLARADO: es analisis de TEXTO acotado por funcion, no AST. Fija que
el cableado esta escrito; que se comporte lo prueba la suite de host, y que
funcione sobre la placa, el banco fisico.

Contador PROPIO: MQTT_REASSEMBLY_CHECKS.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
CLIENTE = FW / "components/diana_platform_esp/src/mqtt_client.c"
INTERNO = FW / "components/diana_platform_esp/src/platform_internal.h"
NUCLEO = FW / "components/diana_core/src/mqtt_reasm.c"
CMAKE = FW / "components/diana_core/CMakeLists.txt"


def bloque(texto: str, inicio: str, fin: str) -> str:
    """Acota entre dos marcas: buscar en todo el fichero daria falsos verdes."""
    i = texto.find(inicio)
    if i < 0:
        return ""
    j = texto.find(fin, i + len(inicio))
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

    print("== MQTT_REASSEMBLY ==\n")

    for f in (CLIENTE, INTERNO, NUCLEO, CMAKE):
        check(f.exists(), "existe %s" % f.name)
    if fallos:
        print("\nMQTT_REASSEMBLY: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
        return 1

    cli = CLIENTE.read_text()
    data = bloque(cli, "case MQTT_EVENT_DATA:", "case MQTT_EVENT_ERROR:")
    check(bool(data), "se localiza el manejador de MQTT_EVENT_DATA")

    print("\n[1] el manejador usa el reensamblador, no data_len a pelo")
    check("diana_mqtt_reasm_feed(" in data,
          "MQTT_EVENT_DATA llama a diana_mqtt_reasm_feed()")
    for campo in ("total_data_len", "current_data_offset", "data_len"):
        check(("ev->" + campo) in data,
              "el manejador usa ev->%s" % campo)
    # El defecto original, literal: copiar el fragmento como si fuera el mensaje.
    check(not re.search(r"memcpy\s*\(\s*(rx(->|\.))?payload\s*,\s*ev->data\b", data),
          "NO hay memcpy(payload, ev->data, ...): el fragmento no se toma por el mensaje")
    check(not re.search(r"payload_len\s*=\s*\(?\s*size_t\s*\)?\s*ev->data_len", data),
          "payload_len NO se toma de ev->data_len")

    print("\n[2] nada parcial ni erroneo llega a la cola")
    check("DIANA_REASM_ERROR" in data and "DIANA_REASM_INCOMPLETO" in data,
          "el manejador distingue ERROR e INCOMPLETO")
    envios = [m.start() for m in re.finditer(r"xQueueSend\s*\(", data)]
    check(len(envios) == 1,
          "hay EXACTAMENTE un xQueueSend en el manejador (entrega unica)")
    if envios:
        antes = data[: envios[0]]
        check("DIANA_REASM_INCOMPLETO" in antes and "DIANA_REASM_ERROR" in antes,
              "los cortes por INCOMPLETO y por ERROR van ANTES del unico envio")
        check(re.search(r"DIANA_REASM_INCOMPLETO\s*\)?\s*\)?\s*\n?\s*break", antes)
              is not None,
              "el camino INCOMPLETO corta con break: no entrega un parcial")
    check("rx_descartados" in data,
          "los descartes se CUENTAN (diagnostico observable, no solo un log)")
    check("ESP_LOGE" in data, "el descarte deja un diagnostico de error")

    print("\n[3] el estado sobrevive entre eventos y muere con la sesion")
    inter = INTERNO.read_text()
    check("diana_mqtt_reasm" in inter and "rx_parcial" in inter,
          "el estado de reensamblado vive en struct diana_platform, no en pila")
    check("p->rx_reasm" in data and "p->rx_parcial" in data,
          "el manejador opera sobre ese estado persistente")
    desc = bloque(cli, "case MQTT_EVENT_DISCONNECTED:", "case MQTT_EVENT_SUBSCRIBED:")
    check("diana_mqtt_reasm_reset" in desc,
          "MQTT_EVENT_DISCONNECTED limpia el mensaje a medias")

    print("\n[4] el reensamblador esta en el binario del ESP32")
    # Se descartan los COMENTARIOS antes de buscar: dejar la linea comentada
    # mantiene la cadena en el fichero y daria un verde falso --- lo dio, en la
    # primera pasada de calibracion (M17).
    cmake_vivo = "\n".join(
        l.split("#", 1)[0] for l in CMAKE.read_text().splitlines()
    )
    check('"src/mqtt_reasm.c"' in cmake_vivo,
          "mqtt_reasm.c figura en el CMakeLists de diana_core "
          "(la suite de host lo compila por wildcard; el ESP32 no)")

    nuc = NUCLEO.read_text()
    check("esp_" not in nuc and "freertos" not in nuc.lower(),
          "mqtt_reasm.c sigue siendo logica PURA: sin ESP-IDF ni FreeRTOS")

    print("\nMQTT_REASSEMBLY: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
    if fallos:
        print("MQTT_REASSEMBLY: FALLO")
        return 1
    print("MQTT_REASSEMBLY_WIRED = TRUE sobre el arbol de trabajo (residual "
          "declarado: analisis de texto acotado por funcion, sin AST; el "
          "comportamiento lo prueba test_mqtt_reasm.c y la placa, el banco)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
