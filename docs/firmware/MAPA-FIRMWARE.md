# Mapa del firmware — qué rama usar y qué contiene cada una

**Si vienes de fuera y quieres tocar firmware, empieza por aquí.** El proyecto ha
tenido varias ramas que parecían todas «el firmware oficial»; este documento dice
cuál manda y por qué.

Actualizado: **2026-08-25**. Ver también `CANONICAL_BRANCHES.md` en la raíz.

## Respuesta corta

| quiero… | uso |
|---|---|
| **Trabajar en firmware ahora** | **`mp0/integration`** — es la línea a seguir |
| **Reproducir lo probado en banco** | `codex/hardware-prototipo-v1` |
| **Leer el estado físico del prototipo** | `docs/hardware/current/` |
| **Fusionar `feat/wp04-firmware`** | **NO. Ver abajo.** |

## Las ramas

### `mp0/integration` — línea de trabajo vigente

Contiene el firmware canónico **más** el trabajo de integración: contrato DO-only
reconciliado (ADR-0007), generador único de identidad MQTT, endurecimiento F-02
por listener, y el plano DEVICE_MANAGEMENT firmado (D1b) en curso.

Está rebasada sobre la base física, así que **no pierde nada de banco**: cero
ficheros borrados, y `net_w5500.c`, `sdkconfig.defaults`, `ota_esp.c`,
`app_main.c` e `idf_component.yml` son byte a byte los del prototipo.

### `codex/hardware-prototipo-v1` — firmware y hardware canónicos

Lo que se compiló, flasheó y midió sobre un ESP32-S3 real. Es la **fuente de
verdad física**. Todo lo que contradiga a esta rama sobre comportamiento medido
está equivocado, salvo que se demuestre una regresión.

### `feat/wp04-firmware` — NO FUSIONAR

`VALIDATED_FIRMWARE_SNAPSHOT` + `SUPERSEDED_AS_INTEGRATION_BASE`.

Su subárbol `firmware/` es **equivalente** al canónico —un fichero y dos líneas de
diferencia, sólo un enlace del README— así que su contenido conserva valor como
evidencia. Lo que está mal es la **base**: parte del 20 de julio, le faltan ~603
ficheros y ~98 000 líneas del tronco, y **no contiene `docs/hardware/` en
absoluto**.

Un `git merge feat/wp04-firmware` sobre una rama moderna revertiría cinco semanas
de trabajo. No se borra —es historia— pero no se fusiona.

## Qué está validado y qué no

**No confundir «el prototipo funciona» con «listo para producción».**

| | estado |
|---|---|
| `VALIDATED_PHYSICALLY` | ESP32-S3 flashea y arranca · cascada 74HC165 (`D1=0x0001`, `D2=0x0002`, `D3=0x0004`) · sensores **D1-D3** con divisor · selector de 2 posiciones · IDENTIFY · 9 aros WS2812B · W5500 con enlace y DHCP **en imagen mínima** |
| `VALIDATED_BY_TEST` | suite host completa · conformidad de contrato · build cruzado ESP-IDF v5.5 |
| `NOT_VALIDATED` | **D4-D9** (a GND, sin sensores ni divisores) · MQTT extremo a extremo · endurance · `StoreProhibited` · `VERSIONR=0x00` intermitente · KiCad · **D1b en runtime** |

### Hechos físicos que no se revierten

- **Polaridad `DIANA_DO_ACTIVE_HIGH`.** La lectura anterior decía «activo bajo»,
  pero se tomó sobre un 74HC165 averiado y **sin adaptación de nivel**: aquel
  «reposo alto» era el síntoma de la avería. Hay una prueba que ancla esto e
  invertirla produce 4 fallos.
- **Divisor `10 kΩ + 18 kΩ` E12** por canal `DO`. Causa raíz confirmada del
  sobrecalentamiento: `DO` entrega 5 V a lógica de 3,3 V y sin divisor la
  corriente por el diodo de protección sólo la limita el diodo.
  **Cada canal necesita el suyo**: faltan 6 parejas para D4-D9.
- **`DIANA_ETH_SPI_HZ` = 5 MHz**, RST/INT sin conectar, sondeo.
- **72 LED por fila** (3 aros × 24), no 24.

## Cómo compilar y probar

```bash
make -C firmware test          # suite host + validación de contrato
```

Para el build cruzado hace falta ESP-IDF **v5.5**. Si no lo tienes instalado, la
imagen oficial sirve y es reproducible:

```bash
docker run --rm -v "$PWD:/w" espressif/idf:v5.5 \
  bash -c 'source /opt/esp/idf/export.sh && cd /w/firmware/esp32 && idf.py fullclean && idf.py build'
```

**Un `exit 0` no es evidencia de compilación.** Comprueba que el log contiene la
versión de ESP-IDF y los artefactos: ya ha ocurrido dos veces en este proyecto
que un contenedor devolviera 0 sin compilar nada.

Las cifras de test sólo valen si son reproducibles desde un comando documentado.
Circula un «43/43» de contratos que **no se ha podido reproducir**; hasta
localizar su origen, no se usa como cifra de estado (`CONTRACT_GAP-TEST-COUNT`).

## Diagnóstico mínimo del W5500

`firmware/esp32/diagnostics/w5500_minimal/` es un proyecto IDF **independiente**:
no enlaza `diana_core` ni `diana_platform_esp`. Repite la secuencia de bring-up
**a propósito** — ése es su valor como diagnóstico reproducible cuando el firmware
completo falla. No está cableado a CI.

## Estado de D1b (plano DEVICE_MANAGEMENT firmado)

```
D1B_SOURCES_IN_CMAKE = YES
D1B_XTENSA_COMPILE   = PASS     los 6 fuentes producen objeto, 0 warnings
D1B_RUNTIME_LINKED   = NO       --gc-sections los elimina: nada los llama aún
DEVICE_MANAGEMENT_PATH = NO ES UNIQUE todavía
```

El binario no crece porque ningún símbolo de D1b sobrevive al enlazado.
**Es el estado esperado**, no un fallo: el cableado del runtime es trabajo
pendiente. No se meten referencias artificiales para inflar el ELF.

**Bloqueo abierto:** D1b necesita publicar en `provision/state`, un tópico que no
existe en el enum del firmware (hoy son 9) ni tiene esquema en `contracts/mqtt/`
(hoy son 13). Los `TopicKind` están congelados y ampliarlos exige ADR.
Ver `CONTRACT_GAP-PROVISION-TOPIC`.

## Pendiente de portar a esta línea

`fix/w5500-reset-hardware@f52d013` **cierra `FW/HW_GAP-W5500-VERSIONR-00`** y aún
no está aquí.

Causa raíz confirmada el 2026-08-28: **nadie conducía `RSTn`**. El firmware sólo
configuraba CS, así que GPIO8 quedaba como entrada en alta impedancia y `RSTn`
—activo a nivel bajo— colgaba de una línea flotante. El síntoma era
`w5500_reset: reset timeout`: MR se leía con el bit RST permanentemente a 1, es
decir el chip fuera del bus con MISO sin conducir. Sólo se recuperaba cortando la
alimentación a mano.

El arreglo conduce `RSTn` desde el primer instante y lo pulsa con la
temporización del datasheet (≥500 µs; usa 5 ms). **No delega en el `reset_hw` de
ESP-IDF**, que sólo mantiene 100 µs —por debajo del mínimo— y suelta el reset sin
margen para el bloqueo del PLL.

Evidencia: **10/10 arranques consecutivos** con `SPI=OK` y DHCP, con reset por
RTS. Diez de diez importa porque el fallo era intermitente.

Esto **supera** la decisión de `3c51847`, que dejaba `reset_gpio_num = -1` con
RST/INT sin conectar. Evidencia física nueva sobre evidencia física anterior.

Ojo al linaje: esa rama parte de `develop@21c09db` y **no contiene `3a1d180`**
—el LED por diana, el antirrebote de IDENTIFY y los buffers en heap—, así que el
port debe ser del delta de `net_w5500.c` y su documentación, no un merge.

## Antes de fabricar PCB

`HW_GAP-KICAD-LEVEL-SHIFT` está **abierto**. El KiCad actual describe la
arquitectura *analógica previa* y **no contiene el divisor**: cero apariciones de
10k/18k. El repositorio todavía no describe el aparato eléctrico que funciona.

«Funcionó en el prototipo» **no equivale a** «resuelto para hardware». Antes de
fabricar, KiCad, BOM y prototipo tienen que converger.
