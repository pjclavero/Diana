# Plan de cambios del firmware — adopción de la topología B y fase 1

> **Estado: APLICADO (2026-07-27).** Los pasos 1–3 del §4 están hechos y el
> firmware **compila con ESP-IDF v5.5.2** en las dos configuraciones. Nada se ha
> grabado ni ejecutado sobre hardware. Deriva de
> [`pinout-definitivo.md`](pinout-definitivo.md) (decisiones P-01…P-05) y de
> [`fase1-protoboard.md`](fase1-protoboard.md).

## Lo que se encontró al compilar por primera vez

Este firmware **nunca se había construido**: todos sus ficheros lo advertían en
la cabecera. La primera compilación real destapó seis cosas que ninguna revisión
de código había visto:

| # | Fallo | Corrección |
|---|---|---|
| B-01 | `led_strip` ya no viene dentro de ESP-IDF; se distribuye por el gestor de componentes | `idf_component.yml` exigiendo `espressif/led_strip ^3.0.0` |
| B-02 | `esp_task_wdt` no es un componente propio en 5.x: vive en `esp_system` | corregido el `REQUIRES` de `main` |
| B-03 | El directorio `boards/` no estaba en ninguna ruta de inclusión | añadido a `INCLUDE_DIRS` de `main` y de la plataforma |
| B-04 | `SPI_FLASH_SEC_SIZE` sin incluir `spi_flash_mmap.h` | include añadido en `store_queue.c` |
| B-05 | `CONFIG_SECURE_SIGNED_APPS_*` exige una clave que no existe: **el build fallaba siempre** | movido a `sdkconfig.defaults.prod`, fuera del camino por defecto |
| B-06 | `CONFIG_SPIRAM_MODE_OCT` sólo vale para el N16R8; con el N8R2 el arranque se cuelga | PSRAM **desactivada**: no hace falta y así un mismo binario vale para ambas placas |

B-05 y B-06 son los que más habrían dolido en banco: el primero impide compilar
y el segundo produce una placa que no arranca sin decir por qué.

## 0. Lo que NO cambia

La separación por capas existente aguanta el cambio entero, que era su propósito:

- **`diana_core`** (máquinas de estado, cola, idempotencia, contrato MQTT,
  OTA lógico): **cero cambios**. La HAL ya expone
  `piezo_amplitude(canal)` como interfaz sustituible (hal.h §piezo) y el core
  no sabe si detrás hay un mux, un ADC SPI o el ADC interno.
- **Los 11 esquemas de contrato MQTT** y los tests de host: sin cambios.
- El modelo de eventos del impacto (ventana de agrupación, decisión por
  amplitud §9.6): compatible con la IRQ agregada — la agregación pierde el
  orden dentro de decenas de µs y el algoritmo no usa el orden.

## 1. Cambios en `firmware/esp32/boards/`

| Cambio | Detalle |
|---|---|
| Nuevo header `esp32s3_topoB_fase1.h` | Mapa de [`fase1-protoboard.md`](fase1-protoboard.md) §3: IRQ_ANY (IO7), 74HC165 (IO38/47/48), AO1/AO2 en ADC1 interno (IO1/IO2), selector/botón/LEDs (IO15–18, IO39). Polaridad de DO de los módulos comerciales configurable por Kconfig (`DIANA_PIEZO_ACTIVE_LOW`, por defecto activo). |
| Nuevo header `esp32s3_w5500_topoB.h` | Mapa completo del [`pinout-definitivo.md`](pinout-definitivo.md) §2 (módulo 3×3 con W5500 + ADC externo). |
| `esp32s3_w5500_protoA.h` **se retira** | Obsoleto: pines inválidos en N16R8 (33/35/36/37), strapping IO3, topología que no cabe. Se elimina en lugar de conservarlo, para que nadie compile contra él por accidente. |
| Selección por Kconfig | `DIANA_BOARD` como `choice` en `Kconfig.projbuild`. |

## 2. Cambios en `diana_platform_esp` (drivers)

### 2.1 `io_piezo.c` — reescritura (el cambio grande)

Modelo actual: 9 GPIO de interrupción directa + mux CD74HC4067 + ADC interno.
Modelo nuevo:

1. **Una ISR (IRAM)** en `IRQ_ANY`, flanco de bajada.
2. La ISR **no lee el 74HC165**: marca un bit y despierta la tarea de captura
   (task notification), que hace LOAD→CLK×8/16→DATA por bit-bang. Bits
   **activos a nivel bajo** (0 = disparado). Medir el tiempo flanco→bits
   (presupuesto: ≪ 1 ms; esperado: decenas de µs).
3. Por cada bit activo, leer amplitud vía `piezo_amplitude(canal)`.
4. **Rearme:** mientras la envolvente siga sobre el umbral, `IRQ_ANY` sigue
   bajo (nivel, no flanco). La tarea re-sondea el 74HC165 hasta que todos los
   canales vuelvan a reposo antes de rearmar la interrupción de flanco, con el
   bloqueo de 30–100 ms del §9.6 por canal.
5. **Secuencia de arranque obligatoria (D-15):** LEDC en IO21 → fijar umbral
   → esperar ≥ 5·τ (235 ms) → lectura de descarte del 74HC165 → habilitar IRQ.
   Hasta entonces, la interrupción NO se instala. *(Solo aplica cuando el
   umbral lo genera el PWM, es decir, en la PCB; en fase 1 el umbral es el
   potenciómetro de cada módulo y basta la lectura de descarte.)*

### 2.2 `sensors` / amplitudes — dos implementaciones tras la misma interfaz

| Implementación | Fase | Detalle |
|---|---|---|
| `piezo_adc_internal` | fase 1 | ADC1 oneshot, ENV1=CH0, ENV2=CH1. Con curva de calibración de eFuse si existe; si no, se acepta el error para banco (el umbral fino ya no depende del ADC interno: lo pone el comparador). |
| `piezo_adc_spi` | módulo | Esqueleto con el CS en IO14 y el protocolo **parametrizado** (P-04 pendiente: ADS7953 o MCP3208 — tramas distintas, misma interfaz). Se implementa al elegir componente. |

`VSENSE_12V/5V`: en fase 1 no existen (devkit alimentado por USB) → la
telemetría de tensión reporta `no disponible`, no un valor inventado.

### 2.3 Red — transporte seleccionable (P-03)

- Nuevo `net_wifi.c`: modo estación, credenciales por Kconfig
  (`DIANA_WIFI_SSID/PASS`), reconexión con retroceso exponencial. Desemboca en
  el mismo `esp_netif` que el W5500: MQTT/OTA/NTP no cambian.
- `net_w5500.c`: se conserva; solo cambian los pines (INT IO14→IO9,
  RST IO21→IO8) al pasar al header topoB.
- `choice` de Kconfig `DIANA_NET_TRANSPORT`: `WIFI` (por defecto en fase 1) /
  `ETH_W5500`. El WiFi queda documentado como **transporte de desarrollo**;
  producción es Ethernet (dosier §8.3).
- **Identidad de módulo:** derivar SIEMPRE del MAC base de eFuse
  (`esp_efuse_mac_get_default()`), nunca de la MAC de la interfaz activa —
  si no, el mismo módulo cambiaría de identidad al pasar de WiFi a Ethernet
  (rompería NVS, ACL del broker y el registro del backend).

### 2.4 `io_leds.c` / `io_inputs.c` — solo renumeración

- Filas WS2812: IO39/40/41 → IO4/5/6 (RMT idéntico).
- Selector IO15/16, botón IO17, LEDs de estado IO18/IO39. La lógica del estado
  (0,0) = avería → SATÉLITE (D-12) ya está en el core y no cambia.

## 3. Hallazgos que este plan devuelve a otros WP

| # | Destinatario | Hallazgo |
|---|---|---|
| H-PIN-01 | **WP-06** | El cálculo 02 §6 (Schmitt **no inversor**, envolvente en in+) produce salida activa-ALTA, incompatible con la hoja 04, D-03 y TP40, que exigen activo-BAJO para el OR de diodos. Adoptada la configuración **inversora** en fase 1 (ver `fase1-protoboard.md` §3); el cálculo 02 §6 debe corregirse y recalcular los umbrales (subida ≈151 mV con V_REF=119,5 mV; se compensa por PWM). |
| H-PIN-02 | **WP-06** | Confirmación que pedía el cálculo 03 §7.5: el algoritmo del §9.6 decide por amplitud dentro de la ventana de 1–3 ms; la pérdida de orden dentro de la lectura del 74HC165 (decenas de µs) **es compatible**. Confirmado a nivel de diseño; queda la medida en banco (B5). |
| H-PIN-03 | Coordinación | X-04 (GPIO 3 de strapping para sensar 12 V) queda **cerrado** por este pinout: IO3 ya no se usa. |

## 4. Orden de ejecución

1. ✅ Headers de placa + Kconfig (§1).
2. ✅ `net_wifi.c` con transporte seleccionable.
3. ✅ Reescritura de `io_piezo.c` (IRQ agregada + 74HC165 + ADC interno).
4. ⏳ **Siguiente:** grabar en el devkit y hacer el hito B1 (arranque en seco:
   consola, NVS, WiFi, MQTT, selector, botón y LEDs). No necesita los módulos
   piezo: se puede hacer en cuanto haya una placa conectada por USB.
5. ⏳ Hitos B2–B4 cuando lleguen los módulos piezo.
6. ⏳ Medidas B5–B6 y realimentación a WP-06 (H-PIN-01, niveles, tiempos,
   caracterización del impacto).
7. ⏳ Cuando haya W5500 físico: cambiar el transporte en `menuconfig`.
8. ⏳ Cuando se elija el ADC (P-04): implementar `piezo_adc_spi`.

## 5. Lo que queda pendiente de verificar en el propio código

- **La lógica de rearme de `io_piezo.c` no se ha ejercitado.** El sondeo tras la
  interrupción (para no perder impactos mientras `IRQ_ANY` sigue activo) está
  escrito pero sólo se puede validar con señales reales.
- **La polaridad del comparador es una suposición** hasta medir el módulo
  comercial (M-02). Si está al revés, `DIANA_PIEZO_ACTIVE_LOW` lo corrige sin
  tocar código, pero también hay que invertir los diodos del OR.
- **`piezo_amplitude` del módulo definitivo devuelve error a propósito**: el ADC
  SPI no puede implementarse hasta elegir el componente (P-04). No se finge una
  lectura.
- Los tests en host de `diana_core` **no se han podido ejecutar en esta máquina**
  (no hay `gcc` de host instalado). No se ha tocado `diana_core`, así que no
  deberían verse afectados; los ejecuta el flujo de integración continua.
