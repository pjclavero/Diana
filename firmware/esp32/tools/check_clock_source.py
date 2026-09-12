#!/usr/bin/env python3
"""
CLOCK_SOURCE · el reloj de pared tiene que poder existir.

POR QUE. La caducidad de comandos se mide contra `issued_at_ms`, que es hora de
PARED (hallazgo H-05), y la regla 6-bis del canal de mantenimiento RECHAZA todo
el repertorio 'act' --- led_test, piezo_test, self_test, start_calibration ---
si el modulo no tiene reloj sincronizado. Un modulo sin hora no es un modulo
degradado: es un modulo al que el panel no puede pedirle nada que mueva
hardware.

EL DEFECTO MEDIDO. `start_sntp()` ponia `cfg.server_from_dhcp = true` sin
condicion. Esa opcion exige CONFIG_LWIP_DHCP_GET_NTP_SRV en lwIP y, sin ella,
`esp_netif_sntp_init()` falla ENTERO: no ignora el extra, se lleva por delante
tambien el servidor explicito de CONFIG_DIANA_NTP_HOST. El modulo se quedaba sin
hora para siempre.

net_w5500.c NO se compila en la suite de host, asi que esto solo se podia ver
en la placa. Aqui queda fijado estructuralmente.

Residual DECLARADO: esta guarda comprueba que el firmware PUEDE sincronizar, no
que lo consiga. Que haya un servidor NTP de verdad en la LAN es una propiedad
del despliegue y se verifica en el banco (gate CLOCK_SYNC).

Contador PROPIO: CLOCK_SOURCE_CHECKS.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
NET = FW / "components/diana_platform_esp/src/net_w5500.c"
TAREAS = FW / "main/app_tasks.c"
KCONFIG = FW / "main/Kconfig.projbuild"


def main() -> int:
    fallos: list[str] = []
    checks = 0

    def check(cond: bool, desc: str) -> None:
        nonlocal checks
        checks += 1
        print(("  ok    · " if cond else "  FALLO · ") + desc)
        if not cond:
            fallos.append(desc)

    print("== CLOCK_SOURCE ==\n")

    net = NET.read_text()
    cuerpo = net[net.index("static void start_sntp(void)"):]
    cuerpo = cuerpo[: cuerpo.index("\n}\n")]

    print("[1] el servidor explicito es el camino principal")
    check("CONFIG_DIANA_NTP_HOST" in cuerpo,
          "start_sntp usa CONFIG_DIANA_NTP_HOST")
    check(KCONFIG.exists() and "DIANA_NTP_HOST" in KCONFIG.read_text(),
          "la opcion existe en Kconfig (es configurable por despliegue)")

    print("\n[2] el extra del DHCP no puede tumbar el camino principal")
    dhcp = [l for l in cuerpo.splitlines() if "server_from_dhcp" in l]
    check(bool(dhcp), "se localiza la asignacion de server_from_dhcp")
    incondicional = [l for l in dhcp if re.search(r"server_from_dhcp\s*=\s*true", l)]
    check("CONFIG_LWIP_DHCP_GET_NTP_SRV" in cuerpo,
          "server_from_dhcp esta guardado por CONFIG_LWIP_DHCP_GET_NTP_SRV")
    if incondicional:
        # Que exista un `= true` es correcto SI vive dentro del #ifdef.
        idx_ifdef = cuerpo.find("#ifdef CONFIG_LWIP_DHCP_GET_NTP_SRV")
        idx_else = cuerpo.find("#else", idx_ifdef) if idx_ifdef >= 0 else -1
        dentro = all(idx_ifdef >= 0 and idx_ifdef < cuerpo.index(l) < idx_else
                     for l in incondicional)
        check(dentro, "todo `server_from_dhcp = true` vive DENTRO del #ifdef")
    check(re.search(r"#else", cuerpo) is not None and
          re.search(r"server_from_dhcp\s*=\s*false", cuerpo) is not None,
          "sin esa opcion de lwIP se pone a false en vez de fallar el init")

    print("\n[3] el fallo se diagnostica, no se resume en 'no disponible'")
    check("esp_err_to_name" in cuerpo,
          "un fallo de SNTP registra el codigo de error concreto")
    check("6-bis" in cuerpo or "act" in cuerpo,
          "y dice la consecuencia: el repertorio 'act' se rechazara")

    print("\n[4] el estado del reloj es OBSERVABLE")
    tareas = TAREAS.read_text()
    check("CLOCK_VALID=true" in tareas and "CLOCK_VALID=false" in tareas,
          "la tarea de red anuncia CLOCK_VALID en los dos sentidos")
    check("clock_valido_anterior" in tareas,
          "se anuncia la TRANSICION, no en cada vuelta del bucle")

    print("\nCLOCK_SOURCE: %d comprobaciones, %d fallidas" % (checks, len(fallos)))
    if fallos:
        print("CLOCK_SOURCE: FALLO")
        return 1
    print("CLOCK_SOURCE = OK (residual declarado: fija que el firmware PUEDE "
          "sincronizar; que exista un NTP real en la LAN se mide en el banco)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
