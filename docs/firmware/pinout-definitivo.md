# Pinout definitivo del firmware — Topología B

> **Estado: PROPUESTA PARA REVISIÓN. Sin verificar sobre hardware.**
> Sustituye a `pinout-preliminar.md`, que queda **obsoleto**: aquel documento
> proponía 9 interrupciones directas y multiplexor CD74HC4067, usaba GPIO
> ocupados por la PSRAM octal del N16R8 (33, 35, 36, 37) y un pin de strapping
> (IO3) como entrada analógica. El cálculo
> [`03-presupuesto-gpio.md`](../../hardware/electronics/calculations/03-presupuesto-gpio.md)
> demostró que esa topología no cabe, y la hoja
> [`02-esp32-w5500.md`](../../hardware/electronics/schematics/02-esp32-w5500.md)
> §3 fijó la asignación de la **topología B**, que este documento adopta.

## 1. Decisiones que fija este documento

| # | Decisión | Motivo |
|---|---|---|
| P-01 | **Módulo de referencia: ESP32-S3-WROOM-1-N16R8** (caso peor). El firmware y el conexionado deben funcionar sin cambios también en el N8R2. | El usuario dispone de devkits N8R2 y N16R8. Diseñando para el peor caso (PSRAM octal: IO35–37 intocables), el mismo mapa vale en ambos. En el N8R2, IO35–37 quedan como reserva extra no asignada. |
| P-02 | **Depuración y grabación por USB-Serial-JTAG nativo** (IO19/20), con `idf.py flash monitor`. Sin JTAG externo. | No se usa VS Code ni sonda externa. IO19/20 quedan reservados al conector USB y **no se rutan a ninguna otra función**. Se adopta la topología B tal cual (no la variante B′). |
| P-03 | **Transporte de red seleccionable por Kconfig: WiFi (desarrollo) o W5500 Ethernet (producción).** | El W5500 aún no está disponible. WiFi y W5500 desembocan en la misma pila `esp_netif`: MQTT, OTA y descubrimiento no cambian. El dosier §8.3 exige Ethernet en producción; el WiFi se documenta como transporte provisional de desarrollo. |
| P-04 | **ADC de amplitudes: PENDIENTE de selección de componente.** El firmware lo abstrae tras `piezo_amplitude(canal)` y el pinout solo le reserva **un chip select (IO14)**. | Candidatos compatibles con el mismo pin: ADS7953 (decisión D-04 del hardware, solo SMD) o MCP3208 (DIP, fácil de conseguir; con 2 unidades se cubren 9 canales + tensiones). La opción mux CD74HC4067 (topología C) consumiría además los 3 pines de reserva IO40–42 + IO2: se documenta como último recurso. |
| P-05 | En **fase 1** (protoboard, 2 canales), las envolventes se leen con el **ADC1 interno** (IO1/IO2) sin comprar ADC externo. | 2 canales caben en ADC1. La interfaz `piezo_amplitude()` es la misma; al pasar al ADC externo solo cambia la implementación de la HAL. Ver [`fase1-protoboard.md`](fase1-protoboard.md). |

## 2. Mapa de pines definitivo (módulo completo, topología B)

Fuente normativa del conexionado: hoja 02 §3. Esta tabla añade la vista de
firmware (periférico ESP-IDF y configuración de arranque).

| GPIO | Señal | Dir. | Periférico ESP-IDF | Configuración |
|---:|---|---|---|---|
| IO1 | `VSENSE_12V` | in | ADC1_CH0 (oneshot) | divisor externo; sin pull |
| IO2 | *reserva* | — | — | TP19 |
| IO4 | `LED_D1_3V3` | out | RMT TX ch (fila superior, dianas 1–3) | — |
| IO5 | `LED_D2_3V3` | out | RMT TX ch (fila central, dianas 4–6) | — |
| IO6 | `LED_D3_3V3` | out | RMT TX ch (fila inferior, dianas 7–9) | — |
| IO7 | `IRQ_ANY` | in | GPIO ISR (IRAM) | flanco de **bajada**; pull-up externo (OR de colector abierto) |
| IO8 | `W5500_RSTn` | out | GPIO | pull-up externo 10 k; mantener ≥ 500 µs en bajo al resetear |
| IO9 | `W5500_INTn` | in | GPIO ISR | flanco de bajada; pull-up externo 10 k |
| IO10 | `nCS_W5500` | out | SPI2 CS0 | — |
| IO11 | `SPI_MOSI` | out | SPI2 | bus compartido W5500 + ADC |
| IO12 | `SPI_SCLK` | out | SPI2 | 20 MHz inicial **(V)** |
| IO13 | `SPI_MISO` | in | SPI2 | — |
| IO14 | `nCS_ADC` | out | SPI2 CS1 | ADC externo pendiente de selección (P-04) |
| IO15 | `SEL_A` | in | GPIO | pull-up interno |
| IO16 | `SEL_B` | in | GPIO | pull-up interno |
| IO17 | `BTN_ID` | in | GPIO | pull-up interno, activo bajo |
| IO18 | `ST_LED_G` | out | GPIO | LED verde de estado |
| IO21 | `VREF_TH_PWM` | out | LEDC PWM | → filtro RC 47 kΩ/1 µF → umbral común. **Fijar ANTES de habilitar IRQ_ANY** (D-15) |
| IO38 | `SR_DATA` | in | GPIO | QH del 74HC165 |
| IO39 | `ST_LED_A` | out | GPIO | LED ámbar de avería (consume MTCK, aceptado por P-02) |
| IO47 | `SR_LOAD` | out | GPIO | /PL del 74HC165 (activo bajo) |
| IO48 | `SR_CLK` | out | GPIO | CP del 74HC165 |
| IO40–42 | *reserva* | — | — | TP16–18 (eran JTAG; liberados por P-02) |
| IO19/20 | USB D−/D+ | — | USB-Serial-JTAG | **no rutar** (P-02) |
| IO43/44 | U0TXD/RXD | — | UART0 | cabezal J30, consola de respaldo |
| IO0 | BOOT | — | strapping | pulsador de descarga |
| IO3, IO45, IO46 | — | — | strapping | **no conectar** |
| IO35–37 | — | — | PSRAM octal (N16R8) | **no conectar** (libres solo en N8R2, no se asignan) |

Presupuesto: **21 usados / 25 disponibles / 4 de reserva** (IO2 + IO40–42).

## 3. Restricciones que el firmware debe imponer

1. **Orden de arranque crítico (D-15):** `VREF_TH` arranca a 0 V y los 9
   comparadores salen disparados. Secuencia obligada:
   configurar LEDC en IO21 → fijar umbral → esperar ≥ 5·τ (235 ms, τ = 47 ms)
   → limpiar el 74HC165 → habilitar la interrupción de IO7.
2. **ISR de `IRQ_ANY` en IRAM** (`ESP_INTR_FLAG_IRAM`): debe poder ejecutarse
   durante escrituras de flash (OTA).
3. **Latencia de identificación:** desde el flanco de IO7 hasta leer los 9 bits
   del 74HC165 debe ser ≪ 1 ms (ventana de agrupación del dosier §9.6 es
   1–3 ms). La lectura del registro es por bit-bang de 3 GPIO (~µs); **medir**.
4. **Vibración cruzada con IRQ agregada:** el algoritmo del §9.6 decide por
   **amplitud dentro de la ventana**, no por orden de llegada. La agregación
   pierde el orden dentro de decenas de µs, lo cual es compatible. Este
   documento **da por confirmada la compatibilidad a nivel de diseño**
   (obligación que dejó el cálculo 03 §7.5); la confirmación final es en banco.
5. **Solo ADC1.** ADC2 es inutilizable con la radio WiFi activa (P-03 la
   activa en desarrollo) y ESP-IDF lo desaconseja siempre.
6. **MAC del W5500 derivada del eFuse** del ESP32-S3 (D-14), con offset de
   interfaz de `esp_read_mac()`. El WiFi usa su MAC propia: **la identidad de
   módulo (dosier §12.3) no puede depender de la MAC de la interfaz activa**;
   debe derivarse siempre del MAC base de eFuse.

## 4. Diferencias con el header actual `esp32s3_w5500_protoA.h`

El header vigente en `firmware/esp32/boards/` implementa el pinout preliminar
obsoleto. Cambios necesarios (detalle en
[`plan-cambios-firmware.md`](plan-cambios-firmware.md)):

- Eliminadas las 9 entradas directas de piezo → `IRQ_ANY` + 3 señales de 74HC165.
- Eliminado el mux CD74HC4067 → CS de ADC SPI externo (componente pendiente).
- SPI del W5500: mismos IO10–13, pero INT pasa de IO14→IO9 y RST de IO21→IO8.
- LEDs de fila: IO39/40/41 → IO4/5/6 (los anteriores chocaban con JTAG/reserva).
- Selector: IO42/IO2 → IO15/IO16. Botón: IO1 → IO17.
- Sensado: desaparece IO3 (strapping) e IO9; queda solo `VSENSE_12V` en IO1
  (redundante con el ADC externo, que también mide tensiones).
- Nuevo: `VREF_TH_PWM` en IO21.

## 5. Verificación pendiente (hereda y acota la del cálculo 03 §7)

- [ ] Contrastar la tabla contra la hoja de datos de la revisión del módulo comprado.
- [ ] Confirmar en el devkit que IO38/IO48 no llevan LED RGB de placa que
      interfiera (en DevKitC-1 el WS2812 de placa va en IO38 o IO48 según
      revisión; su entrada DIN es de alta impedancia y no debería cargar la
      línea, pero **comprobar**).
- [ ] Medir nivel bajo real de `IRQ_ANY` con 1 y 2 comparadores (fase 1) y con 9 (módulo).
- [ ] Medir tiempo flanco-IRQ → 9 bits leídos.
- [ ] Validar 20 MHz de SPI con los dos esclavos en el bus.
