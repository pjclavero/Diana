#!/usr/bin/env python3
"""Fija el arreglo de RSTn del W5500 sobre el propio fuente.

`net_w5500.c` NO se compila en la suite de host, asi que ninguna prueba en C
puede cubrir esto. Y el fallo que arregla era INTERMITENTE: `VERSIONR=0x00` y
`w5500_reset: reset timeout`, con el chip retenido en reset porque nadie conducia
RSTn y GPIO8 quedaba como entrada en alta impedancia. Solo se recuperaba cortando
la alimentacion a mano.

Causa raiz confirmada en banco el 2026-08-28, con 10/10 arranques consecutivos.

OJO: `phy_cfg.reset_gpio_num = -1` NO es el estado defectuoso, es PARTE del
arreglo. El `reset_hw` de ESP-IDF reasertaria el pin solo 100 us --por debajo del
minimo de 500 us del datasheet-- justo antes de `mac->init` y sin margen para el
bloqueo del PLL. El firmware lo pulsa el mismo, con temporizacion correcta, y por
eso le dice al PHY que no lo toque.
"""
import re, sys, pathlib

RUTA = pathlib.Path(__file__).resolve().parents[1] / "components/diana_platform_esp/src/net_w5500.c"

def sin_comentarios(t: str) -> str:
    """El codigo EFECTIVO, no lo que digan los comentarios. Un comentario que
    menciona GPIO_MODE_OUTPUT no configura ningun pin."""
    t = re.sub(r'/\*.*?\*/', ' ', t, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', t)

def main() -> int:
    if not RUTA.exists():
        print("FALLO: no existe %s" % RUTA); return 1
    codigo = sin_comentarios(RUTA.read_text(encoding="utf8", errors="ignore"))
    fallos = []

    # 1. RSTn se CONDUCE: gpio_config con el pin de reset y modo salida.
    # Hay VARIOS gpio_config_t en el fichero (CS y RST): hay que recorrerlos
    # todos, no quedarse con el primero.
    bloques = re.findall(r'gpio_config_t\s+\w+\s*=\s*\{(.*?)\}\s*;', codigo, re.S)
    conduce = any("DIANA_PIN_ETH_RST" in b and "GPIO_MODE_OUTPUT" in b for b in bloques)
    if not conduce:
        fallos.append("RSTn no se configura como SALIDA. Ese es exactamente el "
                      "defecto: GPIO8 como entrada deja RSTn flotante y el W5500 "
                      "puede arrancar retenido en reset.")

    # 2. Se pulsa: bajada, espera y subida. Sin la espera el pulso no cumple los
    #    500 us minimos del datasheet.
    # Hay DOS subidas de RSTn: una antes del pulso (deja el pin en reposo alto)
    # y la del final del pulso. Hay que emparejar la bajada con la subida
    # POSTERIOR a ella; buscar la primera subida del fichero examina un intervalo
    # equivocado y deja pasar un pulso sin espera. Se detecto porque la mutacion
    # que borra la espera NO se ponia roja.
    baja = re.search(r'gpio_set_level\s*\(\s*DIANA_PIN_ETH_RST\s*,\s*0\s*\)', codigo)
    sube = re.search(r'gpio_set_level\s*\(\s*DIANA_PIN_ETH_RST\s*,\s*1\s*\)',
                     codigo[baja.end():]) if baja else None
    if not baja or not sube:
        fallos.append("no hay pulso de reset explicito sobre RSTn: hace falta una "
                      "bajada a 0 y una subida a 1 POSTERIOR")
    else:
        entre = codigo[baja.end(): baja.end() + sube.start()]
        if not re.search(r'vTaskDelay|esp_rom_delay_us|usleep', entre):
            fallos.append("el pulso de RSTn no espera entre bajada y subida: sin "
                          "espera no se cumple el minimo de 500 us del datasheet")

    # 3. El PHY NO debe reasertar RSTn por su cuenta.
    if not re.search(r'reset_gpio_num\s*=\s*-\s*1', codigo):
        fallos.append("phy_cfg.reset_gpio_num deberia seguir en -1: el reset_hw de "
                      "ESP-IDF mantiene solo 100 us, por debajo del minimo, y no "
                      "espera al bloqueo del PLL. El firmware ya lo pulsa el mismo.")

    if fallos:
        print("W5500 RSTn: %d FALLOS" % len(fallos))
        for f in fallos: print("  FALLO %s" % f)
        return 1
    print("W5500 RSTn: conducido, pulsado con espera y sin reasercion del PHY  ok")
    return 0

if __name__ == "__main__":
    sys.exit(main())
