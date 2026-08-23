# Pinout preliminar y presupuesto de GPIO

> STATUS: OBSOLETO / FUTURO. No usar para cablear el prototipo fisico actual.
> La fuente vigente es [`docs/hardware/current/pinout.md`](../hardware/current/pinout.md).

> **OBSOLETO PARA EL PROTOTIPO FISICO ACTUAL.** Para el montaje DO-only real,
> usar `docs/firmware/pinout-definitivo.md`. Este documento queda como referencia
> historica de una propuesta analogica/preliminar.

> **NINGÚN PIN DE ESTE DOCUMENTO SE HA VERIFICADO SOBRE HARDWARE.**
> Es una propuesta que cumple el presupuesto del dosier §8.4 y las restricciones
> publicadas del ESP32-S3. Debe contrastarse con la placa concreta y pasar la
> revisión obligatoria del dosier §28.8 antes de fabricar nada.

Fuente: `firmware/esp32/boards/esp32s3_w5500_protoA.h`.

## 1. Presupuesto de GPIO

El dosier §8.4 estima lo siguiente. La columna "asignado" es lo que realmente
ocupa esta propuesta:

| Función | Estimado | Asignado |
|---|---:|---:|
| SPI W5500 | 4–5 | 6 (incluye RESET) |
| Interrupciones de piezo | 9 | 9 |
| Multiplexor analógico | 4 + 1 ADC | 4 + 1 ADC |
| Cadenas LED | 3 | 3 |
| Selector de función | 2 | 2 |
| Botón de identificación | 1 | 1 |
| Medición de tensión | 1 ADC | 2 ADC |
| Estado y mantenimiento | 1–2 | 2 |
| **Total** | | **30 pines** |

El ESP32-S3 tiene 45 GPIO, de los cuales quedan fuera:

- **GPIO 26–32**: flash SPI y PSRAM octal. Intocables en una placa con PSRAM.
- **GPIO 19–20**: USB-JTAG. Se dejan libres a propósito para poder depurar.
- **GPIO 0, 3, 45, 46**: pines de strapping.

Quedan del orden de 6–8 pines de reserva, dentro de lo que pide el dosier.

## 2. Asignación propuesta

### Ethernet W5500 (SPI2)

| Señal | GPIO | Nota |
|---|---:|---|
| MISO | 13 | |
| MOSI | 11 | |
| SCLK | 12 | |
| CS | 10 | |
| INT | 14 | interrupción de recepción |
| RESET | 21 | reset del PHY, necesario para reconexión fiable |

Reloj SPI inicial: **20 MHz**. El W5500 admite hasta 80 MHz, pero con cableado
de prototipo esa cifra es optimista. **A validar en banco** subiendo hasta
encontrar el límite con margen.

### Comparadores de impacto (9 GPIO, orden = índice de diana 1..9)

| Diana | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| GPIO | 4 | 5 | 6 | 7 | 15 | 16 | 17 | 18 | 33 |

Configurados como entrada con pull-down y interrupción por flanco de subida. La
ISR está en IRAM para poder ejecutarse con la caché de flash deshabilitada
(por ejemplo, durante una escritura OTA).

### Multiplexor analógico CD74HC4067

| Señal | GPIO | Nota |
|---|---:|---|
| S0 | 35 | |
| S1 | 36 | |
| S2 | 37 | |
| S3 | 38 | |
| SIG | 8 | ADC1_CH7 |

Tiempo de asentamiento tras conmutar: **5 µs, provisional**. Depende de la
capacidad de la envolvente y de la impedancia de la fuente; **hay que medirlo
con osciloscopio**. Si resulta insuficiente, las amplitudes leídas serán
sistemáticamente bajas y todos los umbrales quedarán mal.

La interfaz del HAL (`piezo_amplitude(canal)`) es la misma si se sustituye el
multiplexor por un ADC externo SPI: `diana_core` no cambia.

### Cadenas LED (dosier 10.2)

| Cadena | GPIO | Dianas | LED |
|---:|---:|---|---:|
| 0 | 39 | 1–3 (fila superior) | 24 |
| 1 | 40 | 4–6 (fila central) | 24 |
| 2 | 41 | 7–9 (fila inferior) | 24 |

Necesitan conversión de nivel 3,3 V → 5 V (`74AHCT125`) y resistencia serie de
330–470 Ω, según el dosier §10.3. Eso es hardware, no firmware.

### Selector de 3 posiciones

| Señal | GPIO |
|---|---:|
| A | 42 |
| B | 2 |

Interruptor con común a masa y pull-up interno:

| Posición | A | B |
|---|--:|--:|
| SATÉLITE | 0 | 1 |
| AUTO (central) | 1 | 1 |
| PRINCIPAL | 1 | 0 |
| *imposible* | 0 | 0 |

La combinación `A=0, B=0` no puede darse con un selector sano. El firmware la
trata como avería: degrada a **SATÉLITE** (el rol que no toma autoridad de
partida, es decir, el fallo menos peligroso) y emite un diagnóstico.

### Botón, tensiones y estado

| Función | GPIO | Nota |
|---|---:|---|
| Botón identificar | 1 | activo a nivel bajo, pull-up interno |
| Sensor 5 V | 9 | ADC1_CH8, divisor resistivo |
| Sensor 12 V | 3 | ADC1_CH2, divisor resistivo — **strapping, revisar** |
| LED estado | 47 | |
| LED avería | 48 | |

**GPIO 3 es pin de strapping (JTAG source select).** Usarlo como entrada
analógica con un divisor conectado permanentemente puede alterar el arranque
según los valores de las resistencias. Es el punto más frágil de esta propuesta
y debe reasignarse o justificarse en la revisión de hardware.

## 3. Riesgos conocidos del pinout

1. **GPIO 3 (sensor 12 V) es strapping.** Revisar antes de rutar.
2. **GPIO 33** puede estar ocupado según el encapsulado y la variante de PSRAM.
   Confirmar contra la placa concreta.
3. **GPIO 45 y 46** no se usan, correcto, pero conviene comprobar que no quedan
   flotantes en el conector.
4. Los divisores de tensión están definidos por macros
   (`DIANA_VDIV_*`) con valores **inventados**: dependen de las resistencias
   que se monten. Sin ajustarlos, la telemetría de tensión miente.
5. El ADC del ESP32-S3 se lee sin curva de calibración de eFuse. Vale para
   telemetría; **no vale** para decidir un umbral piezoeléctrico.
