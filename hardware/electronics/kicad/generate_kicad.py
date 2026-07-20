#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generador de la estructura jerarquica KiCad del modulo 3x3 del proyecto Diana.

AVISO IMPORTANTE
================
Este script se ha ejecutado en un entorno SIN KiCad instalado (no hay
`kicad-cli`, no hay modulo `pcbnew`). Por tanto los ficheros generados
NO han podido abrirse, ni comprobarse con ERC, ni exportarse a netlist
con la herramienta oficial. Ver kicad/README.md.

Lo que el script genera es la ESTRUCTURA jerarquica en formato
s-expression de KiCad 8 (version 20231120):

  - fichero de proyecto .kicad_pro
  - hoja raiz con 8 sub-hojas y sus pines jerarquicos
  - las 8 hojas hijas con sus etiquetas jerarquicas
  - la hoja 04 instancia 9 veces la hoja 03 (reutilizacion jerarquica real)
  - cada hoja incluye, como bloques de texto, el resumen del conexionado

NO genera instancias de simbolos (resistencias, CI, conectores). Motivo
declarado en README.md: sin KiCad no se puede validar el bloque
`lib_symbols`, y un `lib_symbols` mal formado deja el fichero
irrecuperable. El conexionado normativo vive en:

  hardware/electronics/schematics/*.md      (descripcion nodo a nodo)
  hardware/electronics/kicad/netlist/*.csv  (netlist transcribible)
"""

import os
import uuid

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT = "diana-module-3x3"
VERSION = "20231120"

# Semilla fija para que el generador sea reproducible.
_rng = uuid.UUID("d1a4a000-0000-4000-8000-000000000000")
_counter = [0]


def u():
    """UUID determinista (reproducible entre ejecuciones)."""
    _counter[0] += 1
    return str(uuid.uuid5(_rng, "diana-wp06-%d" % _counter[0]))


def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def title_block(title, rev="A0", date="2026-07-20"):
    return (
        '  (title_block\n'
        '    (title "%s")\n'
        '    (date "%s")\n'
        '    (rev "%s")\n'
        '    (company "Proyecto Diana - WP-06 Hardware Electronico")\n'
        '    (comment 1 "SIN VALIDAR: no se ha ejecutado ERC. Sin KiCad en el entorno.")\n'
        '    (comment 2 "Conexionado normativo en hardware/electronics/schematics/")\n'
        '  )\n' % (esc(title), date, rev)
    )


def text_block(content, x, y, size=1.27):
    return (
        '  (text "%s"\n'
        '    (exclude_from_sim no)\n'
        '    (at %.2f %.2f 0)\n'
        '    (effects (font (size %.2f %.2f)) (justify left top))\n'
        '    (uuid "%s")\n'
        '  )\n' % (esc(content), x, y, size, size, u())
    )


def hier_label(name, shape, x, y, rot):
    just = "right" if rot == 0 else "left"
    return (
        '  (hierarchical_label "%s"\n'
        '    (shape %s)\n'
        '    (at %.2f %.2f %d)\n'
        '    (effects (font (size 1.27 1.27)) (justify %s))\n'
        '    (uuid "%s")\n'
        '  )\n' % (esc(name), shape, x, y, rot, just, u())
    )


def sheet_block(name, filename, x, y, w, h, pins):
    """pins: lista de (nombre, forma, lado) donde lado in {'L','R'}."""
    out = []
    out.append('  (sheet\n')
    out.append('    (at %.2f %.2f)\n' % (x, y))
    out.append('    (size %.2f %.2f)\n' % (w, h))
    out.append('    (fields_autoplaced yes)\n')
    out.append('    (stroke (width 0.1524) (type solid))\n')
    out.append('    (fill (color 0 0 0 0.0000))\n')
    out.append('    (uuid "%s")\n' % u())
    out.append('    (property "Sheetname" "%s"\n' % esc(name))
    out.append('      (at %.2f %.2f 0)\n' % (x, y - 0.7))
    out.append('      (effects (font (size 1.27 1.27)) (justify left bottom))\n')
    out.append('    )\n')
    out.append('    (property "Sheetfile" "%s"\n' % esc(filename))
    out.append('      (at %.2f %.2f 0)\n' % (x, y + h + 1.4))
    out.append('      (effects (font (size 1.27 1.27)) (justify left top))\n')
    out.append('    )\n')

    nl = [p for p in pins if p[2] == 'L']
    nr = [p for p in pins if p[2] == 'R']
    for i, (pname, shape, side) in enumerate(nl):
        py = y + 2.54 * (i + 1)
        out.append('    (pin "%s" %s\n' % (esc(pname), shape))
        out.append('      (at %.2f %.2f 180)\n' % (x, py))
        out.append('      (effects (font (size 1.27 1.27)) (justify right))\n')
        out.append('      (uuid "%s")\n' % u())
        out.append('    )\n')
    for i, (pname, shape, side) in enumerate(nr):
        py = y + 2.54 * (i + 1)
        out.append('    (pin "%s" %s\n' % (esc(pname), shape))
        out.append('      (at %.2f %.2f 0)\n' % (x + w, py))
        out.append('      (effects (font (size 1.27 1.27)) (justify left))\n')
        out.append('      (uuid "%s")\n' % u())
        out.append('    )\n')
    out.append('  )\n')
    return "".join(out)


def write_sheet(filename, title, labels, notes, extra=""):
    """labels: lista de (nombre, forma, lado L/R)."""
    body = []
    body.append('(kicad_sch\n')
    body.append('  (version %s)\n' % VERSION)
    body.append('  (generator "diana_wp06_generator")\n')
    body.append('  (generator_version "8.0")\n')
    body.append('  (uuid "%s")\n' % u())
    body.append('  (paper "A3")\n')
    body.append(title_block(title))
    body.append('  (lib_symbols)\n')

    left = [l for l in labels if l[2] == 'L']
    right = [l for l in labels if l[2] == 'R']
    for i, (n, s, side) in enumerate(left):
        body.append(hier_label(n, s, 25.40, 25.40 + 5.08 * i, 180))
    for i, (n, s, side) in enumerate(right):
        body.append(hier_label(n, s, 381.00, 25.40 + 5.08 * i, 0))

    y = 25.40
    for note in notes:
        body.append(text_block(note, 76.20, y))
        y += 5.08 * (note.count("\n") + 2)

    body.append(extra)
    body.append(')\n')

    path = os.path.join(BASE, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write("".join(body))
    return path


# ---------------------------------------------------------------------------
# Definicion de las interfaces de cada hoja (pines jerarquicos)
# ---------------------------------------------------------------------------

SHEETS = {}

SHEETS["01-power"] = dict(
    title="01 - Alimentacion, protecciones y distribucion",
    pins=[
        ("V12_JACK", "input", "L"),
        ("+12V_F", "output", "R"),
        ("+5V_LED", "output", "R"),
        ("+5V_LOG", "output", "R"),
        ("+3V3", "output", "R"),
        ("+3V3A", "output", "R"),
        ("VSENSE_12V", "output", "R"),
        ("VSENSE_5V", "output", "R"),
        ("PWR_EN", "input", "L"),
    ],
    notes=[
        "HOJA 01 - ALIMENTACION\n"
        "Cadena: J1 (12V DC ext.) -> SW1 bipolar -> F1 fusible T3.15A -> Q1 PMOS antipolaridad ->\n"
        "D1 TVS SMBJ15A -> L1/C filtro -> U1 buck 12V->5V 6A -> bus +5V dividido en +5V_LED y +5V_LOG\n"
        "-> U2 buck 5V->3V3 1A -> +3V3 -> FB1 ferrita -> +3V3A (analogico).\n"
        "Medida: divisor 100k/10k sobre +12V_F -> VSENSE_12V; 22k/10k sobre +5V_LOG -> VSENSE_5V.\n"
        "Puntos de prueba: TP1 +12V_F, TP2 +5V_LED, TP3 +5V_LOG, TP4 +3V3, TP5 +3V3A, TP6 GND_PWR,\n"
        "TP7 GND_LOG, TP8 SW de U1 (solo con punta diferencial).\n"
        "AVISO: valores y encapsulados normativos en schematics/01-power.md. ERC NO EJECUTADO.",
    ],
)

SHEETS["02-esp32-w5500"] = dict(
    title="02 - ESP32-S3 + W5500 Ethernet",
    pins=[
        ("+3V3", "input", "L"),
        ("+5V_LOG", "input", "L"),
        ("VSENSE_12V", "input", "L"),
        ("SPI_SCLK", "output", "R"),
        ("SPI_MOSI", "output", "R"),
        ("SPI_MISO", "input", "R"),
        ("nCS_ADC", "output", "R"),
        ("IRQ_ANY", "input", "R"),
        ("SR_LOAD", "output", "R"),
        ("SR_CLK", "output", "R"),
        ("SR_DATA", "input", "R"),
        ("LED_D1_3V3", "output", "R"),
        ("LED_D2_3V3", "output", "R"),
        ("LED_D3_3V3", "output", "R"),
        ("SEL_A", "input", "R"),
        ("SEL_B", "input", "R"),
        ("BTN_ID", "input", "R"),
        ("ST_LED_G", "output", "R"),
        ("ST_LED_A", "output", "R"),
        ("ETH_TXP", "bidirectional", "R"),
        ("ETH_TXN", "bidirectional", "R"),
        ("ETH_RXP", "bidirectional", "R"),
        ("ETH_RXN", "bidirectional", "R"),
    ],
    notes=[
        "HOJA 02 - CONTROLADOR Y ETHERNET\n"
        "U10 = ESP32-S3-WROOM-1-N16R8. U11 = W5500 (LQFP48). Y1 = 25 MHz + 2x22 pF.\n"
        "SPI2: SCLK=IO12, MOSI=IO11, MISO=IO13, nCS_W5500=IO10, nCS_ADC=IO14,\n"
        "W5500_INTn=IO9 (pull-up 10k), W5500_RSTn=IO8 (pull-up 10k + RC 10k/100nF).\n"
        "Arranque: IO0 pull-up 10k + SW_BOOT + 100nF; EN pull-up 10k + 1uF + SW_RST.\n"
        "Desacoplo: 100nF por pin de alimentacion + 22uF por CI. Ferrita en 3V3 de W5500.\n"
        "PHY: 49R9 por par + centro comun con 10nF/2kV a chasis (terminacion Bob Smith).\n"
        "TVS array en las 4 lineas TX/RX (D20).\n"
        "PRESUPUESTO GPIO: ver calculations/03-presupuesto-gpio.md (NO cuadra en topologia directa).\n"
        "ERC NO EJECUTADO.",
    ],
)

PIEZO_PINS = [
    ("PZ_P", "input", "L"),
    ("VREF_TH", "input", "L"),
    ("+3V3A", "input", "L"),
    ("ENV_OUT", "output", "R"),
    ("CMP_OUT", "output", "R"),
]

SHEETS["03-piezo-channel"] = dict(
    title="03 - Canal piezoelectrico (hoja reutilizable, 9 instancias)",
    pins=PIEZO_PINS,
    notes=[
        "HOJA 03 - CANAL PIEZO (1 de 9). Esta hoja se instancia 9 veces desde 04-piezo-array-9ch.\n"
        "Cadena: PZ_P -> R1 1M a GND (descarga) -> R2a+R2b 2x33k serie (0805, 150V c/u) ->\n"
        "nodo CLMP -> D1 BAT54S (anodo D1a a CLMP / catodo a +3V3A ; catodo D1b a CLMP / anodo a GND)\n"
        "-> R3 1M a GND -> U_A buffer MCP6004 seguidor (entrada + = CLMP) ->\n"
        "D2 BAT54 rectificador -> nodo ENV -> C_ENV 47nF a GND || R_ENV 220k a GND -> ENV_OUT.\n"
        "Comparador: U_C LM339 (colector abierto). ENTRADA + = ENV via R_IN 10k. ENTRADA - = VREF_TH.\n"
        "Realimentacion positiva R_FB 1M de salida a entrada +. Pull-up R_PU 10k a +3V3.\n"
        "Salida CMP_OUT (activa a nivel bajo) -> entrada del 74HC165 + diodo Schottky al nodo IRQ_ANY.\n"
        "Puntos de prueba por canal: TP_PZ (crudo, tras R1), TP_CLMP (recortado), TP_ENV, TP_CMP.\n"
        "Constantes: tau_descarga = 1M*20nF = 20 ms ; tau_envolvente = 220k*47nF = 10,34 ms ;\n"
        "histeresis calculada = 33,0 mV sobre umbral 120,7 mV. Ver calculations/02-cadena-piezo.md.\n"
        "ERC NO EJECUTADO. Valores INICIALES: exigen validacion en banco.",
    ],
)

SHEETS["04-piezo-array-9ch"] = dict(
    title="04 - Array de 9 canales piezoelectricos",
    pins=[("PZ%d" % i, "input", "L") for i in range(1, 10)]
    + [("VREF_TH", "input", "L"), ("+3V3A", "input", "L"), ("+3V3", "input", "L")]
    + [("ENV%d" % i, "output", "R") for i in range(1, 10)]
    + [
        ("IRQ_ANY", "output", "R"),
        ("SR_LOAD", "input", "R"),
        ("SR_CLK", "input", "R"),
        ("SR_DATA", "output", "R"),
    ],
    notes=[
        "HOJA 04 - ARRAY 9 CANALES\n"
        "Contiene 9 instancias de la hoja 03-piezo-channel (CH1..CH9).\n"
        "Agregacion de eventos: las 9 salidas CMP_OUTn (colector abierto, activa baja) van a:\n"
        "  (a) 9 entradas de U40/U41 = 2x 74HC165 en cascada (16 bits, se usan 9),\n"
        "  (b) 9 diodos Schottky D40..D48 (catodo en CMP_OUTn, anodo en IRQ_ANY) que forman\n"
        "      un OR cableado hacia un unico GPIO de interrupcion. Pull-up R40 4k7 a +3V3.\n"
        "Nivel bajo garantizado en IRQ_ANY = VOL(LM339) + Vf(BAT54) = 0,20 + 0,30 = 0,50 V,\n"
        "por debajo de VIL(ESP32-S3) = 0,25*3,3 = 0,825 V. Margen 0,325 V.\n"
        "Los diodos aislan cada salida entre si, de modo que el 74HC165 conserva la identidad\n"
        "del canal mientras el OR cableado despierta al ESP32 con un solo GPIO.\n"
        "AHORRO: 9 GPIO -> 4 GPIO (IRQ_ANY + SR_LOAD + SR_CLK + SR_DATA).\n"
        "ERC NO EJECUTADO.",
    ],
)

SHEETS["05-analog-mux-or-adc"] = dict(
    title="05 - Multiplexor analogico (opcion A) o ADC SPI externo (opcion B, recomendada)",
    pins=[("ENV%d" % i, "input", "L") for i in range(1, 10)]
    + [
        ("VSENSE_12V", "input", "L"),
        ("VSENSE_5V", "input", "L"),
        ("+3V3", "input", "L"),
        ("+3V3A", "input", "L"),
        ("SPI_SCLK", "input", "R"),
        ("SPI_MOSI", "input", "R"),
        ("SPI_MISO", "output", "R"),
        ("nCS_ADC", "input", "R"),
        ("MUX_S0", "input", "R"),
        ("MUX_S1", "input", "R"),
        ("MUX_S2", "input", "R"),
        ("MUX_S3", "input", "R"),
        ("MUX_AOUT", "output", "R"),
    ],
    notes=[
        "HOJA 05 - LECTURA DE AMPLITUDES. Dos opciones montables sobre el mismo pie de PCB\n"
        "(solo una se puebla; la otra se deja como DNP).\n"
        "\n"
        "OPCION B (RECOMENDADA) - ADC SPI externo:\n"
        "  U50 = ADS7953SBDBT (16 canales, 12 bit, SPI) o alternativa 2x MCP3208-BI/SL.\n"
        "  Canales: CH0..CH8 = ENV1..ENV9 ; CH9 = VSENSE_12V ; CH10 = VSENSE_5V ;\n"
        "  CH11 = referencia de 1,000 V (autocomprobacion) ; CH12..CH15 reserva.\n"
        "  Coste en GPIO: 1 (nCS_ADC), comparte el bus SPI del W5500.\n"
        "  Ventajas: sin conflicto ADC2/RF, linealidad muy superior al ADC del ESP32-S3.\n"
        "\n"
        "OPCION A (ALTERNATIVA) - multiplexor:\n"
        "  U51 = CD74HC4067M (16:1). S0..S3 = MUX_S0..3, /EN a GND, COM -> MUX_AOUT -> ADC1 del ESP32.\n"
        "  Coste en GPIO: 5 (4 seleccion + 1 ADC). Requiere calibracion eFuse del ADC.\n"
        "  Ron tipico 70 ohm: con R_ENV 220k el error de division es 0,03 %, despreciable.\n"
        "\n"
        "En ambas opciones: R serie 1k + C 1nF por entrada (filtro anti-alias y proteccion),\n"
        "clamp BAV99 a rieles en cada entrada, plano analogico separado unido en un solo punto.\n"
        "ERC NO EJECUTADO.",
    ],
)

SHEETS["06-led-level-shifting"] = dict(
    title="06 - Conversion de nivel y potencia de las 3 cadenas LED",
    pins=[
        ("LED_D1_3V3", "input", "L"),
        ("LED_D2_3V3", "input", "L"),
        ("LED_D3_3V3", "input", "L"),
        ("+5V_LED", "input", "L"),
        ("+5V_LOG", "input", "L"),
        ("LED_D1_5V", "output", "R"),
        ("LED_D2_5V", "output", "R"),
        ("LED_D3_5V", "output", "R"),
        ("+5V_ROW1", "output", "R"),
        ("+5V_ROW2", "output", "R"),
        ("+5V_ROW3", "output", "R"),
    ],
    notes=[
        "HOJA 06 - LED\n"
        "U60 = 74AHCT125PW (cuadruple buffer triestado, VCC=5V, VIH=2,0 V -> acepta 3,3 V).\n"
        "Canal 1..3 usados, canal 4 de reserva con /OE a GND y entrada a GND.\n"
        "Cada salida: R60..R62 = 470 ohm serie, colocada a menos de 10 mm del buffer.\n"
        "Bulk del bus LED: C60+C61 = 2x 1000uF/10V low-ESR (total 2000 uF, ESR combinada <= 15 mohm)\n"
        "+ C62..C64 = 470uF/10V en cada punto de inyeccion de fila + 100nF ceramicos distribuidos.\n"
        "Inyeccion de 5V en AMBOS extremos de cada fila de 24 LED.\n"
        "Proteccion: fusible rearmable PTC 3A por fila (F60..F62) y diodo de rueda libre inverso.\n"
        "Puntos de prueba: TP60 +5V_LED, TP61..63 dato de cada cadena, TP64..66 5V en extremo lejano.\n"
        "Presupuesto: 72 LED x 60 mA = 4,32 A. Ver calculations/01-presupuesto-potencia-led.md.\n"
        "ERC NO EJECUTADO.",
    ],
)

SHEETS["07-user-inputs"] = dict(
    title="07 - Entradas de usuario, selector y LED de estado",
    pins=[
        ("+3V3", "input", "L"),
        ("SEL_A", "output", "R"),
        ("SEL_B", "output", "R"),
        ("BTN_ID", "output", "R"),
        ("ST_LED_G", "input", "R"),
        ("ST_LED_A", "input", "R"),
    ],
    notes=[
        "HOJA 07 - ENTRADAS DE USUARIO\n"
        "SW70 = selector rotativo 1 polo 3 posiciones (SATELITE / AUTO / PRINCIPAL).\n"
        "Codificacion con pull-up: SEL_A y SEL_B a +3V3 por 10k, cada posicion cierra a GND:\n"
        "  PRINCIPAL = (A=0, B=1) ; AUTO = (A=1, B=1) ; SATELITE = (A=1, B=0) ; (A=0,B=0) = fallo.\n"
        "  El estado (0,0) es imposible con el selector sano: se usa para detectar cable roto.\n"
        "Antirrebote hardware: R 10k + C 100nF -> tau = 1,0 ms ; antirrebote software 20 ms.\n"
        "SW71 = pulsador de identificacion, mismo esquema RC, ademas via serie 100R.\n"
        "D70 LED verde (estado) y D71 LED ambar (mantenimiento), R 330 ohm cada uno,\n"
        "corriente 3,3-2,0)/330 = 3,9 mA (verde) y (3,3-2,0)/330 = 3,9 mA (ambar).\n"
        "Proteccion ESD: TVS array en las 3 lineas que salen a la tapa (D72).\n"
        "ERC NO EJECUTADO.",
    ],
)

SHEETS["08-connectors"] = dict(
    title="08 - Conectores, distribucion por filas y masas",
    pins=[
        ("V12_JACK", "output", "R"),
        ("+5V_ROW1", "input", "L"),
        ("+5V_ROW2", "input", "L"),
        ("+5V_ROW3", "input", "L"),
        ("LED_D1_5V", "input", "L"),
        ("LED_D2_5V", "input", "L"),
        ("LED_D3_5V", "input", "L"),
    ]
    + [("PZ%d" % i, "output", "R") for i in range(1, 10)]
    + [
        ("ETH_TXP", "bidirectional", "L"),
        ("ETH_TXN", "bidirectional", "L"),
        ("ETH_RXP", "bidirectional", "L"),
        ("ETH_RXN", "bidirectional", "L"),
    ],
    notes=[
        "HOJA 08 - CONECTORES\n"
        "J1  entrada 12V: conector bloqueable 2 vias, paso 5,08 mm, >=8 A (Phoenix MSTB o XT30).\n"
        "J2  RJ45 con magnetismos integrados (HR911105A o J0011D01BNL).\n"
        "J10..J12 filas LED: 4 vias JST VH paso 3,96 mm, >=7 A/via.\n"
        "    Pin 1 = +5V_ROW (rojo), pin 2 = +5V_ROW (rojo, doblado por corriente),\n"
        "    pin 3 = DATA (blanco), pin 4 = GND_PWR (negro). Polarizado, con enclavamiento.\n"
        "J20..J22 filas de piezos: 8 vias JST XH paso 2,50 mm, senal.\n"
        "    Pines impares = PZn, pines pares = GND_ANA, apantallado por par.\n"
        "J30 cabecera de programacion UART 6 vias 2,54 (GND, 3V3, TX, RX, IO0, EN).\n"
        "J31 cabecera de tapa 6 vias (SEL_A, SEL_B, BTN_ID, ST_LED_G, ST_LED_A, GND).\n"
        "SEPARACION: los conectores de potencia (J1, J10..J12) en un borde de la PCB,\n"
        "los de senal (J20..J22, J30, J31) en el borde opuesto. Separacion minima 15 mm.\n"
        "MASAS: GND_PWR (retorno LED, cobre >= 2 mm) y GND_LOG/GND_ANA en plano continuo;\n"
        "union en un unico punto en el pin de masa del convertidor U1 (estrella).\n"
        "ERC NO EJECUTADO.",
    ],
)

ORDER = [
    "01-power",
    "02-esp32-w5500",
    "03-piezo-channel",
    "04-piezo-array-9ch",
    "05-analog-mux-or-adc",
    "06-led-level-shifting",
    "07-user-inputs",
    "08-connectors",
]


def main():
    # --- hojas hijas ---
    for name in ORDER:
        d = SHEETS[name]
        labels = [(p[0], p[1], p[2]) for p in d["pins"]]
        extra = ""
        if name == "04-piezo-array-9ch":
            # 9 instancias reales de la hoja 03
            blocks = []
            for i in range(9):
                col = i % 3
                row = i // 3
                x = 40.0 + col * 100.0
                y = 60.0 + row * 60.0
                pins = [
                    ("PZ_P", "input", "L"),
                    ("VREF_TH", "input", "L"),
                    ("+3V3A", "input", "L"),
                    ("ENV_OUT", "output", "R"),
                    ("CMP_OUT", "output", "R"),
                ]
                blocks.append(
                    sheet_block(
                        "CH%d" % (i + 1),
                        "03-piezo-channel.kicad_sch",
                        x,
                        y,
                        60.0,
                        25.0,
                        pins,
                    )
                )
            extra = "".join(blocks)
        write_sheet(name + ".kicad_sch", d["title"], labels, d["notes"], extra)

    # --- hoja raiz ---
    body = []
    body.append('(kicad_sch\n')
    body.append('  (version %s)\n' % VERSION)
    body.append('  (generator "diana_wp06_generator")\n')
    body.append('  (generator_version "8.0")\n')
    body.append('  (uuid "%s")\n' % u())
    body.append('  (paper "A2")\n')
    body.append(title_block("Modulo de diana 3x3 - hoja raiz"))
    body.append('  (lib_symbols)\n')
    body.append(
        text_block(
            "PROYECTO DIANA - MODULO 3x3 - WP-06\n"
            "ESTADO: DISENO DOCUMENTADO, VALIDACION PENDIENTE.\n"
            "NO se ha ejecutado ERC ni DRC: el entorno de generacion no dispone de KiCad.\n"
            "Estos ficheros NO autorizan la fabricacion de ninguna PCB.\n"
            "Conexionado normativo: hardware/electronics/schematics/*.md\n"
            "Netlist transcribible: hardware/electronics/kicad/netlist/netlist.csv",
            20.0,
            15.0,
            2.0,
        )
    )
    layout = [
        ("01-power", 30.0, 60.0),
        ("02-esp32-w5500", 190.0, 60.0),
        ("03-piezo-channel", 350.0, 60.0),
        ("04-piezo-array-9ch", 510.0, 60.0),
        ("05-analog-mux-or-adc", 30.0, 230.0),
        ("06-led-level-shifting", 190.0, 230.0),
        ("07-user-inputs", 350.0, 230.0),
        ("08-connectors", 510.0, 230.0),
    ]
    for name, x, y in layout:
        d = SHEETS[name]
        pins = [(p[0], p[1], p[2]) for p in d["pins"]]
        h = max(20.0, 2.54 * (max(len([p for p in pins if p[2] == 'L']),
                                  len([p for p in pins if p[2] == 'R'])) + 1))
        body.append(sheet_block(name, name + ".kicad_sch", x, y, 110.0, h, pins))
    body.append('  (sheet_instances\n    (path "/" (page "1"))\n  )\n')
    body.append(')\n')
    with open(os.path.join(BASE, PROJECT + ".kicad_sch"), "w", encoding="utf-8") as f:
        f.write("".join(body))

    print("Generadas 9 hojas + proyecto en %s" % BASE)
    print("AVISO: ficheros NO verificados con KiCad (no disponible en el entorno).")


if __name__ == "__main__":
    main()
