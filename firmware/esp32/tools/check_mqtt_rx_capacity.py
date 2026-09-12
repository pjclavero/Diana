#!/usr/bin/env python3
"""
MQTT_RX_CAPACITY · el receptor del firmware tiene que caber el mensaje MAS
GRANDE que el contrato permite enviarle.

POR QUE EXISTE ESTO. El buffer de recepcion era `char payload[2048]`, un numero
redondo elegido a ojo. El `config/desired` REAL de un modulo 3x3 con sus nueve
dianas calibradas ocupa ~2239 bytes, asi que el firmware lo descartaba --- bien
descartado, sin truncar, pero descartado --- y la configuracion NUNCA podia
aplicarse. No era un caso limite: es el mensaje normal de un modulo completo.
Lo encontro la placa, no la suite.

QUE HACE. Construye el `config/desired` MAXIMO que el esquema admite, lo mide,
y compara contra la capacidad declarada en el firmware. Si el firmware se queda
por debajo, sale ROJO con las dos cifras. El tamano deja de ser una opinion.

EL RESIDUAL, DECLARADO. El esquema NO acota de verdad dos cosas:

  · `neighbour_ratio` es `number` en [0,1]; JSON no limita cuantos decimales
    puede traer un double (0.30000000000000004 son 19 caracteres);
  · `calibrated_at` y `applied_at` son `date-time` sin `maxLength`; el formato
    RFC3339 acota en la practica, pero el esquema no lo dice;
  · `config_version` es `integer, minimum: 0` SIN maximo; en JSON un entero no
    tiene ancho, asi que tampoco hay peor caso finito.

Para esos tres no existe worst-case finito derivable del contrato. En vez de
fingir que el esquema los acota, se fija un LIMITE DE PRODUCTO explicito (abajo)
y se declara aqui el hueco. Si alguien emite algo mas largo, el firmware lo
rechazara limpiamente por capacidad --- que es el comportamiento correcto --- y
esta guarda seguira siendo cierta sobre lo que el producto declara emitir.

Contador PROPIO: MQTT_RX_CAPACITY_CHECKS. No se suma a HOST_SUITE ni a las
demas guardas estructurales.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
RAIZ = FW.parents[1]
CABECERA = FW / "components/diana_platform_esp/include/diana/platform_esp.h"
ESQUEMA = RAIZ / "contracts/mqtt/module-config.schema.json"

# --- limites de PRODUCTO para lo que el esquema no acota ---------------------
# Un double serializado por el backend de Node nunca pasa de 24 caracteres.
RATIO_MAX = "0.30000000000000004"      # 19 car., el peor caso realista
VERSION_MAX = 2**31 - 1                # config_version: limite de producto
# RFC3339 con milisegundos y zona: "2026-09-11T18:40:00.000+00:00" = 29.
FECHA_MAX = "2026-09-11T18:40:00.000+00:00"
IDENT_MAX = "m" + "9" * 62            # 63 car., el maximo del patron identifier
NOMBRE_MAX = "N" * 64                 # friendly_name maxLength 64

MARGEN = 512  # holgura declarada, no un numero escondido


def payload_maximo() -> str:
    """El config/desired mas grande que el contrato permite."""
    calibracion = [
        {
            "target_index": i,
            "threshold": 65535,
            "hysteresis": 65535,
            "noise_floor": 65535,
            "blanking_us": 500000,
            "group_window_us": 50000,
            "neighbour_ratio": RATIO_MAX,   # se sustituye sin comillas abajo
            "enabled": True,
            "calibrated_at": FECHA_MAX,
        }
        for i in range(1, 10)
    ]
    p = {
        "schema_version": 1,
        "module_id": IDENT_MAX,
        "config_version": VERSION_MAX,
        "system_id": IDENT_MAX,
        "coordinator_module_id": IDENT_MAX,
        "position": {"x": -1, "y": -1},
        "rotation": 270,
        "friendly_name": NOMBRE_MAX,
        "led_brightness_max": 255,
        "telemetry_interval_ms": 60000,
        "network": {
            "mode": "static",
            "ip": "255.255.255.255",
            "netmask": "255.255.255.255",
            "gateway": "255.255.255.255",
        },
        "calibration": calibracion,
        "applied_at": FECHA_MAX,
    }
    # El ratio va como NUMERO, no como cadena: se serializa y se quitan las
    # comillas, que es como lo emite el backend.
    return json.dumps(p, separators=(",", ":")).replace(
        '"%s"' % RATIO_MAX, RATIO_MAX
    )


def validador():
    """Validador REAL del contrato, con el common.schema.json resuelto.

    Medir un payload que el esquema rechazaria no probaria nada sobre la
    capacidad necesaria: el peor caso tiene que ser un mensaje que el producto
    pueda emitir de verdad.
    """
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource

    esquema = json.loads(ESQUEMA.read_text())
    comun = json.loads((RAIZ / "contracts/schemas/common.schema.json").read_text())
    reg = Registry().with_resource(
        "../schemas/common.schema.json", Resource.from_contents(comun)
    )
    return Draft202012Validator(esquema, registry=reg)


def capacidad_declarada() -> int | None:
    m = re.search(r"#define\s+DIANA_MQTT_RX_PAYLOAD_MAX\s+(\d+)", CABECERA.read_text())
    return int(m.group(1)) if m else None


def main() -> int:
    fallos: list[str] = []
    checks = 0

    def check(cond: bool, desc: str) -> None:
        nonlocal checks
        checks += 1
        print(("  ok    · " if cond else "  FALLO · ") + desc)
        if not cond:
            fallos.append(desc)

    print("== MQTT_RX_CAPACITY ==\n")

    peor = payload_maximo()
    tam = len(peor.encode("utf-8"))
    print("[1] el mensaje mas grande que el contrato permite")
    print("    config/desired maximo = %d bytes" % tam)

    # El peor caso tiene que ser JSON valido y respetar el contrato.
    d = json.loads(peor)
    check(len(d["calibration"]) == 9, "el peor caso lleva las NUEVE dianas (minItems=maxItems=9)")
    check(isinstance(d["calibration"][0]["neighbour_ratio"], float),
          "neighbour_ratio se serializa como numero, no como cadena")

    v = validador()
    errores = sorted(v.iter_errors(d), key=lambda e: list(e.path))
    check(not errores,
          "el peor caso VALIDA contra module-config.schema.json"
          + ("" if not errores else " --- " + errores[0].message))

    esquema = json.loads(ESQUEMA.read_text())
    check(esquema.get("additionalProperties") is False,
          "el esquema cierra additionalProperties: no caben campos extra")
    cal = esquema["properties"]["calibration"]
    check(cal.get("maxItems") == 9,
          "calibration esta acotada a 9 por el esquema, no por costumbre")

    print("\n[2] la capacidad que declara el firmware")
    cap = capacidad_declarada()
    check(cap is not None,
          "platform_esp.h declara DIANA_MQTT_RX_PAYLOAD_MAX")
    if cap is None:
        print("\nMQTT_RX_CAPACITY: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
        return 1

    print("    DIANA_MQTT_RX_PAYLOAD_MAX = %d bytes" % cap)
    check(cap > tam,
          "la capacidad del firmware SUPERA el peor caso del contrato "
          "(%d > %d)" % (cap, tam))
    check(cap >= tam + MARGEN,
          "y con el margen declarado de %d bytes (%d >= %d)" % (MARGEN, cap, tam + MARGEN))

    # El caso REAL que fallo en el banco, para que quede fijado por su nombre.
    print("\n[3] el caso que fallo en la placa")
    real = json.dumps({
        "schema_version": 1, "module_id": "module-01", "config_version": 1,
        "system_id": "banco-01", "coordinator_module_id": None,
        "position": None, "rotation": 0, "friendly_name": "Modulo fisico 1 (3x3)",
        "led_brightness_max": 120, "telemetry_interval_ms": 1000,
        "network": {"mode": "dhcp", "ip": None, "netmask": None, "gateway": None},
        "calibration": [
            {"target_index": i, "threshold": 1200, "hysteresis": 80,
             "noise_floor": 40, "blanking_us": 5000, "group_window_us": 2000,
             "neighbour_ratio": 0.35, "enabled": True,
             "calibrated_at": "2026-09-11T18:40:00.000Z"} for i in range(1, 10)
        ],
    })
    errores_real = list(v.iter_errors(json.loads(real)))
    check(not errores_real,
          "el caso real de module-01 tambien VALIDA contra el contrato"
          + ("" if not errores_real else " --- " + errores_real[0].message))
    print("    config/desired de module-01 = %d bytes" % len(real))
    check(cap > len(real),
          "cabe el config/desired REAL de module-01 (el que se descartaba)")
    check(2048 < len(real),
          "CONTROL: con la capacidad ANTERIOR (2048) NO cabia --- "
          "esta guarda habria estado roja")

    print("\nMQTT_RX_CAPACITY: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
    if fallos:
        print("MQTT_RX_CAPACITY: FALLO")
        return 1
    print("MQTT_RX_CAPACITY = OK (residual declarado: neighbour_ratio, las "
          "fechas y config_version se acotan por limite de PRODUCTO, no por "
          "el esquema)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
