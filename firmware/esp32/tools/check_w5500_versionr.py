#!/usr/bin/env python3
"""Guarda estructural del diagnostico de VERSIONR del W5500.

Por que existe
--------------
El firmware imprimia `W5500 SPI=OK` a partir de `diana_platform_eth_available()`,
que solo dice que el driver se instalo. No demostraba que el SPI hablase con el
chip, y se venia leyendo como si lo demostrase.

Ademas, el driver por defecto de ESP-IDF sondea VERSIONR en bucle dentro de
`w5500_verify_id()` hasta obtener 0x04 --- su propio comentario reconoce que
algunos W5500 devuelven 0 justo tras el reset --- y solo registra el valor si
agota el timeout. Es decir: la incidencia historica `VERSIONR=0x00` puede estar
ocurriendo en cada arranque sin dejar rastro.

Estas propiedades son ESTRUCTURALES: `net_w5500.c` no se compila en la suite de
host (necesita ESP-IDF), asi que ninguna prueba en C puede cubrirlas. Se
comprueban sobre el fuente.

Calibracion
-----------
Un gate verde no es evidencia hasta demostrar que sabe ponerse rojo por la razon
exacta que pretende detectar. `--self-test` aplica una mutacion por comprobacion
sobre copias en memoria y exige que CADA una la mate.
"""
import re
import sys
from pathlib import Path

FW = Path(__file__).resolve().parent.parent
NET = FW / "components" / "diana_platform_esp" / "src" / "net_w5500.c"
HDR = FW / "components" / "diana_platform_esp" / "include" / "diana" / "platform_esp.h"
MAIN = FW / "main" / "app_main.c"
TASKS = FW / "main" / "app_tasks.c"


def body_of(text, signature):
    """Devuelve el cuerpo de la funcion cuya firma empieza en `signature`."""
    i = text.find(signature)
    if i < 0:
        return ""
    j = text.find("{", i)
    if j < 0:
        return ""
    depth, k = 0, j
    while k < len(text):
        if text[k] == "{":
            depth += 1
        elif text[k] == "}":
            depth -= 1
            if depth == 0:
                return text[j:k + 1]
        k += 1
    return text[j:]


def strip_comments(s):
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    return re.sub(r"//[^\n]*", " ", s)


def checks(net, hdr, main, tasks):
    """Devuelve [(ok, etiqueta, detalle)]. Sin efectos secundarios."""
    out = []
    net_code = strip_comments(net)
    main_code = strip_comments(main)
    init_body = body_of(net, "static void *diana_w5500_spi_init")
    init_code = strip_comments(init_body)

    # 1. UN SOLO dispositivo SPI. Dos competirian por el mismo W5500.
    n_add = len(re.findall(r"\bspi_bus_add_device\s*\(", net_code))
    out.append((n_add == 1,
                "existe exactamente UN spi_bus_add_device",
                f"encontrados {n_add}"))

    # 2. Los CUATRO callbacks cableados. Si falta uno, ESP-IDF cae al driver
    #    por defecto EN SILENCIO y se pierde la primera lectura sin aviso.
    for cb, fn in (("init", "diana_w5500_spi_init"),
                   ("deinit", "diana_w5500_spi_deinit"),
                   ("read", "diana_w5500_spi_read"),
                   ("write", "diana_w5500_spi_write")):
        pat = r"custom_spi_driver\." + cb + r"\s*=\s*" + fn + r"\b"
        out.append((re.search(pat, net_code) is not None,
                    f"custom_spi_driver.{cb} apunta a {fn}", ""))

    # 3. La PRIMERA lectura ocurre dentro de init (antes de w5500_verify_id).
    out.append(("w5500_read_versionr" in init_code,
                "la primera lectura de VERSIONR se toma en init", ""))

    # 4. Esa primera lectura NO esta envuelta en un bucle de reintento.
    loop = re.search(r"\b(for|while|do)\b[^;]{0,400}?w5500_read_versionr",
                     init_code, flags=re.S)
    out.append((loop is None,
                "la primera lectura NO esta dentro de un bucle de reintento",
                "hay un bucle alrededor" if loop else ""))

    # 5. first_* no se reescribe fuera de init: es la unica prueba de un 0x00
    #    que una lectura posterior recupere a 0x04.
    outside = strip_comments(net.replace(init_body, ""))
    bad = re.findall(r"->first_(value|class)\s*=", outside)
    out.append((not bad,
                "first_value/first_class solo se escriben en init",
                f"{len(bad)} escrituras fuera de init"))

    # 6. Clasificacion completa: los cuatro casos existen.
    for cls in ("DIANA_W5500_VERSION_OK", "DIANA_W5500_VERSION_INVALID",
                "DIANA_W5500_VERSION_UNEXPECTED", "DIANA_W5500_VERSION_READ_ERROR"):
        out.append((cls in hdr and cls in net_code,
                    f"{cls} declarado y usado", ""))

    # 7. 0x00 se clasifica como INVALID, no se normaliza a otra cosa.
    cl = strip_comments(body_of(net, "static diana_w5500_version_class classify_versionr"))
    out.append((re.search(r"0x00\s*\)\s*return\s+DIANA_W5500_VERSION_INVALID", cl) is not None,
                "0x00 se clasifica como VERSION_INVALID", ""))
    out.append((re.search(r"DIANA_W5500_CHIP_VERSION\s*\)\s*return\s+DIANA_W5500_VERSION_OK", cl) is not None,
                "0x04 se clasifica como VERSION_OK", ""))

    # 8. Framing identico al driver de ESP-IDF v5.5.
    out.append((re.search(r"command_bits\s*=\s*16", init_code) is not None,
                "command_bits = 16 (fase de direccion W5500)", ""))
    out.append((re.search(r"address_bits\s*=\s*8", init_code) is not None,
                "address_bits = 8 (fase de control W5500)", ""))
    out.append(("spi_device_polling_transmit" in net_code,
                "se usa spi_device_polling_transmit, como el original", ""))
    out.append((re.search(r"DIANA_W5500_ADDR_OFFSET\s+16", net) is not None,
                "ADDR_OFFSET = 16", ""))
    out.append((re.search(r"DIANA_W5500_RWB_OFFSET\s+2", net) is not None,
                "RWB_OFFSET = 2", ""))
    out.append((re.search(r"0x0039", net) is not None,
                "se direcciona el registro 0x0039 (VERSIONR)", ""))

    # 9. Locking: toda transaccion va bajo el mutex.
    for fn in ("diana_w5500_spi_read", "diana_w5500_spi_write"):
        b = strip_comments(body_of(net, "static esp_err_t " + fn))
        ok = "w5500_spi_lock" in b and "w5500_spi_unlock" in b
        out.append((ok, f"{fn} toma y suelta el mutex", ""))

    # 10. Ciclo de vida: deinit libera dispositivo y mutex.
    d = strip_comments(body_of(net, "static esp_err_t diana_w5500_spi_deinit"))
    out.append(("spi_bus_remove_device" in d and "vSemaphoreDelete" in d,
                "deinit libera dispositivo SPI y mutex", ""))

    # 11. El log ambiguo no vuelve. `W5500 SPI=` mezclaba disponibilidad del
    #     driver con comunicacion SPI real.
    out.append(('"  W5500 SPI=%s"' not in main_code,
                "no reaparece el log ambiguo 'W5500 SPI='", ""))

    # 12. Los cuatro observables se imprimen por separado.
    for obs in ("W5500 driver=", "W5500 first VERSIONR=", "W5500 current VERSIONR=",
                "W5500 LINK=", "W5500 IP="):
        out.append((obs in main_code, f"se imprime el observable '{obs}'", ""))

    # 13. La lectura periodica NO se ata a la telemetria (1 s por defecto).
    tasks_code = strip_comments(tasks)
    out.append(("DIANA_VERSIONR_PERIOD_US" in tasks_code,
                "la lectura periodica tiene cadencia propia", ""))
    per = re.search(r"DIANA_VERSIONR_PERIOD_US\s*\(([^)]*)\)", tasks)
    slow = False
    if per:
        try:
            slow = eval(per.group(1).replace("ULL", "")) >= 10 * 1000 * 1000
        except Exception:
            slow = False
    out.append((slow, "esa cadencia es >= 10 s (no es sondeo agresivo)",
                per.group(1).strip() if per else "no encontrada"))

    # 14. Reconnect: una lectura, no un bucle.
    rb = strip_comments(body_of(net, "int diana_pf_net_reconnect"))
    out.append(("diana_platform_eth_versionr" in rb,
                "el reconnect lee VERSIONR una vez", ""))
    out.append((re.search(r"\b(for|while)\b[^;]{0,200}?diana_platform_eth_versionr",
                          rb, flags=re.S) is None,
                "el reconnect NO reintenta en bucle", ""))
    return out


def run(net, hdr, main, tasks, verbose=True):
    res = checks(net, hdr, main, tasks)
    bad = 0
    for ok, label, detail in res:
        if not ok:
            bad += 1
        if verbose:
            mark = "ok  " if ok else "FALLO"
            extra = f"   [{detail}]" if detail and not ok else ""
            print(f"  {mark}  {label}{extra}")
    return res, bad


def self_test(net, hdr, main, tasks):
    """Cada mutacion debe MATAR al menos una comprobacion."""
    base, bad = run(net, hdr, main, tasks, verbose=False)
    if bad:
        print("CALIBRACION ABORTADA: el arbol sin mutar ya esta rojo")
        return 1

    muts = [
        ("segundo dispositivo SPI",
         lambda n, h, m, t: (n.replace("spi->lock = xSemaphoreCreateMutex();",
                                       "spi_bus_add_device(0, &spi_devcfg, &spi->hdl);\n    spi->lock = xSemaphoreCreateMutex();", 1), h, m, t)),
        ("callback read sin cablear",
         lambda n, h, m, t: (n.replace("w5500_cfg.custom_spi_driver.read   = diana_w5500_spi_read;", "", 1), h, m, t)),
        ("primera lectura envuelta en un bucle de reintento",
         lambda n, h, m, t: (n.replace("    uint8_t v = 0;\n    if (w5500_read_versionr(spi, &v) == ESP_OK) {",
                                       "    uint8_t v = 0;\n    while (w5500_read_versionr(spi, &v) == ESP_OK && v != 0x04) { }\n    if (w5500_read_versionr(spi, &v) == ESP_OK) {", 1), h, m, t)),
        ("first_value reescrito fuera de init",
         lambda n, h, m, t: (n.replace("    spi->last_value = v;\n    spi->last_class = cls;",
                                       "    spi->first_value = v;\n    spi->last_value = v;\n    spi->last_class = cls;", 1), h, m, t)),
        ("0x00 dejando de ser INVALID",
         lambda n, h, m, t: (n.replace("if (v == 0x00)                     return DIANA_W5500_VERSION_INVALID;",
                                       "if (v == 0x00)                     return DIANA_W5500_VERSION_UNEXPECTED;", 1), h, m, t)),
        ("framing alterado (command_bits)",
         lambda n, h, m, t: (n.replace("spi_devcfg.command_bits = 16;", "spi_devcfg.command_bits = 8;", 1), h, m, t)),
        ("transaccion sin mutex",
         lambda n, h, m, t: (n.replace("    if (w5500_spi_lock(spi)) {\n        if (spi_device_polling_transmit(spi->hdl, &trans) != ESP_OK) {\n            ESP_LOGE(TAG, \"transaccion SPI de lectura fallida\");",
                                       "    if (true) {\n        if (spi_device_polling_transmit(spi->hdl, &trans) != ESP_OK) {\n            ESP_LOGE(TAG, \"transaccion SPI de lectura fallida\");", 1), h, m, t)),
        ("vuelve el log ambiguo 'W5500 SPI='",
         lambda n, h, m, t: (n, h, m.replace('ESP_LOGI(TAG, "  W5500 driver=%s",', 'ESP_LOGI(TAG, "  W5500 SPI=%s",', 1), t)),
        ("cadencia periodica agresiva (1 s)",
         lambda n, h, m, t: (n, h, m, t.replace("#define DIANA_VERSIONR_PERIOD_US (30ULL * 1000ULL * 1000ULL)",
                                                "#define DIANA_VERSIONR_PERIOD_US (1ULL * 1000ULL * 1000ULL)", 1))),
    ]

    fallos = 0
    for nombre, mut in muts:
        n2, h2, m2, t2 = mut(net, hdr, main, tasks)
        if (n2, h2, m2, t2) == (net, hdr, main, tasks):
            print(f"  FALLO  la mutacion '{nombre}' no altero el fuente")
            fallos += 1
            continue
        _, bad2 = run(n2, h2, m2, t2, verbose=False)
        if bad2 > 0:
            print(f"  ok     '{nombre}' -> la guarda se pone ROJA ({bad2} fallos)")
        else:
            print(f"  FALLO  '{nombre}' -> la guarda NO la detecta")
            fallos += 1

    print()
    if fallos:
        print(f"CALIBRACION: {fallos} mutaciones sobrevivieron. La guarda NO es fiable.")
        return 1
    print(f"CALIBRACION: {len(muts)}/{len(muts)} mutaciones detectadas. "
          f"La guarda sabe ponerse roja.")
    return 0


def main():
    net = NET.read_text(encoding="utf-8")
    hdr = HDR.read_text(encoding="utf-8")
    main_c = MAIN.read_text(encoding="utf-8")
    tasks = TASKS.read_text(encoding="utf-8")

    if "--self-test" in sys.argv:
        return self_test(net, hdr, main_c, tasks)

    res, bad = run(net, hdr, main_c, tasks)
    print(f"W5500 VERSIONR: {len(res)} comprobaciones estructurales, {bad} fallidas")
    if bad:
        return 1
    print("W5500_VERSIONR_OBSERVABLE = TRUE sobre el arbol de trabajo "
          "(residual declarado: que el camino custom se SELECCIONE en runtime "
          "solo lo demuestra la traza de arranque, no el fuente)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
