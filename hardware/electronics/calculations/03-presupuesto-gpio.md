# Cálculo 03 — Presupuesto de GPIO del ESP32-S3

> ## ⚠ APLICACIÓN PARCIAL EN EL PROTOTIPO V1
>
> **Sí aplica y sigue siendo el motivo de la arquitectura:** la conclusión de que
> la topología literal del dosier §8.4 **no cuadra** en GPIO y de que la
> topología B (2 × 74HC165) sí. El prototipo V1 adopta la topología B.
>
> **NO UTILIZADO EN PROTOTIPO V1 (DISEÑO FUTURO):** las líneas `nCS_ADC` (IO14) y
> `VREF_TH_PWM` (IO21) de las tablas, y la topología C (CD74HC4067).
> En V1 esos pines quedan libres, más IO7 (`IRQ_ANY`), luego el margen de reserva
> es mayor que el calculado aquí.
>
> Pinout normativo: `firmware/esp32/boards/esp32s3_proto_do_w5500.h`.

---

> **DICTAMEN ANTICIPADO: la topología literal del dosier §8.4 NO CUADRA.**
> Faltan **4 GPIO** sin contar la reserva, y **9** contando la reserva máxima que
> el propio dosier pide. Esto materializa el riesgo «Escasez de GPIO → Rediseño»
> del dosier §34. Se propone una topología alternativa que **sí cuadra** y deja
> 4 pines de reserva, con el coste documentado en §5.

> **Estado: análisis sobre documentación del fabricante. No se ha programado ni
> medido ningún pin.** Las restricciones de pines deben reverificarse contra la
> hoja de datos de la revisión concreta de módulo que se compre.

Fuente normativa: dosier §8.4, §34 y §35 (decisión pendiente n.º 1: «modelo
exacto de ESP32-S3»).

---

## 1. Módulo considerado

**ESP32-S3-WROOM-1-N16R8** (16 MB flash quad SPI + 8 MB PSRAM **octal**).

### 1.1 Pines expuestos por el módulo

El WROOM-1 saca 36 GPIO: `IO0`–`IO21`, `IO35`–`IO48`. Los `IO26`–`IO34` no salen
del módulo: están dedicados a la flash SPI interna.

### 1.2 Pines expuestos pero NO utilizables

| Pines | Motivo | ¿Recuperables? |
|---|---|---|
| `IO35`, `IO36`, `IO37` | **PSRAM octal** de la variante `R8` | Sí, cambiando a variante `R2` (PSRAM quad) o `N16` sin PSRAM: **+3 GPIO** |

```
GPIO físicamente disponibles = 36 − 3 (PSRAM octal) = 33
```

### 1.3 Pines con función reservada

| Pines | Función | Coste de reutilizarlos |
|---|---|---|
| `IO0` | Strapping de arranque (BOOT) | Necesita pull-up y pulsador. No usar. |
| `IO3` | Strapping de selección de JTAG | Debe quedar en estado válido en el arranque. No usar. |
| `IO45` | Strapping `VDD_SPI` (**debe estar a nivel bajo** en el arranque con flash de 3,3 V) | No usar. |
| `IO46` | Strapping de impresión de mensajes de ROM | No usar. |
| `IO19`, `IO20` | USB-Serial-JTAG nativo (D−/D+) | Se pierde el USB nativo |
| `IO43`, `IO44` | UART0 (consola y programación) | Se pierde la consola serie |
| `IO39`–`IO42` | JTAG (MTCK/MTDO/MTDI/MTMS) | Se pierde la depuración por JTAG |

```
GPIO disponibles con criterio conservador
  = 33 − 4 (strapping) − 2 (USB) − 2 (UART0) = 25

Conjunto: IO1, IO2, IO4..IO18, IO21, IO38..IO42, IO47, IO48
```

Los `IO39`–`IO42` están dentro de esos 25 pero su uso cuesta el JTAG.

### 1.4 Restricciones de ADC

| Bloque | Pines | Uso |
|---|---|---|
| **ADC1** | `IO1`–`IO10` | Utilizable siempre. **Único recomendado.** |
| ADC2 | `IO11`–`IO20` | Inutilizable mientras la radio esté activa. Aunque este diseño usa Ethernet y no Wi-Fi, ESP-IDF desaconseja ADC2. **No se usa.** |

**El ESP32-S3 no tiene DAC** (a diferencia del ESP32 original). Toda tensión
analógica generada por el microcontrolador debe salir de un PWM filtrado.

---

## 2. Topología A — lectura literal del dosier §8.4. **NO CUADRA**

| Función (dosier §8.4) | GPIO pedidos | Detalle |
|---|---:|---|
| SPI W5500 | 6 | SCLK, MOSI, MISO, nCS, INTn, RSTn |
| Interrupciones de piezo | **9** | una por canal |
| Multiplexor analógico | 5 | S0–S3 + 1 entrada de ADC1 |
| Cadenas LED | 3 | RMT |
| Selector de función | 2 | codificación de 3 posiciones |
| Botón de identificación | 1 | |
| Medición de tensión | 1 | ADC1 |
| Estado y mantenimiento | 2 | 2 LED |
| **Subtotal funcional** | **29** | |
| Reserva pedida por el dosier | 3 – 5 | |
| **TOTAL** | **32 – 34** | |

```
DISPONIBLES  = 25
NECESARIOS   = 29 (sin reserva)  →  DÉFICIT = 4
NECESARIOS   = 34 (con reserva máxima)  →  DÉFICIT = 9
```

**No cuadra.** Ni siquiera sacrificando el USB nativo y la consola UART0
(que darían 4 pines más, hasta 29) quedaría reserva alguna, y se perdería la
capacidad de programar y depurar la placa cómodamente.

Los dos consumidores desproporcionados son **las 9 interrupciones de piezo** y
**los 5 pines del multiplexor**.

---

## 3. Topología B — RECOMENDADA. **CUADRA con 4 de reserva**

Dos cambios respecto a la topología A:

1. **Agregación de interrupciones (9 → 4).** Las 9 salidas de comparador
   (colector abierto) se combinan en un **OR cableado por diodos** hacia un único
   GPIO de interrupción `IRQ_ANY`, y la identidad del canal se lee por **dos
   74HC165 en cascada** (3 GPIO: LOAD, CLK, DATA). Ver hoja 04 y cálculo 02 §8.
   El nivel bajo resultante es 0,50 V frente a un V_IL máximo de 0,825 V:
   **margen 0,325 V**.
2. **ADC SPI externo en lugar de multiplexor (5 → 1).** El ADS7953 (16 canales)
   comparte el bus SPI del W5500 y sólo consume un chip select. Además lee las
   dos medidas de tensión de riel, liberando otro pin.

| Función | GPIO | Detalle |
|---|---:|---|
| Bus SPI compartido | 3 | SCLK, MOSI, MISO (W5500 + ADC) |
| Chip selects | 2 | nCS_W5500, nCS_ADC |
| Control del W5500 | 2 | INTn, RSTn |
| Piezo (agregado) | 4 | IRQ_ANY, SR_LOAD, SR_CLK, SR_DATA |
| Cadenas LED | 3 | RMT |
| Selector de función | 2 | SEL_A, SEL_B |
| Botón de identificación | 1 | BTN_ID |
| LED de estado | 2 | ST_LED_G, ST_LED_A |
| Medición de tensión (redundante con el ADC externo) | 1 | ADC1_CH0 |
| Umbral V_REF por PWM filtrado | 1 | ver cálculo 02 §6.3 |
| **TOTAL USADOS** | **21** | |
| **RESERVA** | **4** | |
| **DISPONIBLES** | **25** | ✔ **CUADRA** |

### 3.1 Asignación concreta propuesta

| GPIO | Señal | Notas |
|---:|---|---|
| IO1 | `VSENSE_12V` | ADC1_CH0 |
| IO2 | *reserva* | ADC1_CH1, sin restricciones |
| IO4 | `LED_D1_3V3` | fila superior, RMT |
| IO5 | `LED_D2_3V3` | fila central, RMT |
| IO6 | `LED_D3_3V3` | fila inferior, RMT |
| IO7 | `IRQ_ANY` | entrada, interrupción por flanco de bajada |
| IO8 | `W5500_RSTn` | salida, pull-up 10 k |
| IO9 | `W5500_INTn` | entrada, pull-up 10 k |
| IO10 | `nCS_W5500` | salida |
| IO11 | `SPI_MOSI` | |
| IO12 | `SPI_SCLK` | |
| IO13 | `SPI_MISO` | |
| IO14 | `nCS_ADC` | salida |
| IO15 | `SEL_A` | entrada, pull-up |
| IO16 | `SEL_B` | entrada, pull-up |
| IO17 | `BTN_ID` | entrada, pull-up |
| IO18 | `ST_LED_G` | salida |
| IO21 | `VREF_TH_PWM` | salida PWM → filtro RC |
| IO38 | `SR_DATA` | entrada (QH del 74HC165) |
| IO39 | `ST_LED_A` | salida. **Consume MTCK (JTAG)** |
| IO47 | `SR_LOAD` | salida |
| IO48 | `SR_CLK` | salida |
| IO40, IO41, IO42 | *reserva* | **Son JTAG (MTDO/MTDI/MTMS)** |

### 3.2 Advertencia sobre la calidad de la reserva

De los 4 pines de reserva, **sólo 1 (`IO2`) es de uso libre**; los otros 3 son
pines de JTAG. Si el proyecto decide que la depuración por JTAG es obligatoria,
**la reserva efectiva cae a 1 pin** y se incumple el mínimo de 3 del dosier §8.4.

**Variante B′ (si se exige JTAG):** mover `ST_LED_G` y `ST_LED_A` a `IO19`/`IO20`,
renunciando al USB-Serial-JTAG nativo y programando por el cabezal UART0.
Resultado: `IO18`, `IO2` libres y `IO39`–`IO42` íntegros para JTAG →
**reserva de 2 pines sin restricciones + JTAG completo**.

---

## 4. Topología C — multiplexor CD74HC4067 en lugar de ADC SPI

Si por coste o disponibilidad se prefiere el multiplexor (opción A de la hoja 05):

```
Topología B (21) − nCS_ADC (1) + MUX_S0..S3 (4) + MUX_AOUT en ADC1 (1) = 25
RESERVA = 0
```

**Cabe exactamente, con cero reserva.** Incumple el requisito de 3–5 pines de
reserva del dosier §8.4. Sólo es admisible si simultáneamente se libera algo más
(por ejemplo, un único LED de estado direccionable en lugar de dos LED discretos,
o la variante `R2` de PSRAM que devuelve `IO35`–`IO37`).

---

## 5. Coste de la topología B (honestidad sobre lo que se pierde)

| Se gana | Se pierde |
|---|---|
| El presupuesto de GPIO cierra | 2 circuitos integrados más (74HC165 ×2) y 9 diodos |
| Mejor linealidad de medida (ADC externo de 12 bit) | Dependencia de un componente menos común que el CD74HC4067 |
| Sin conflicto ADC2/RF | La lectura del canal ya no es instantánea: requiere una transacción SPI tras la interrupción |
| Un solo GPIO despierta ante cualquier impacto | Si **dos** canales se activan en el mismo instante, sólo hay una interrupción; el 74HC165 los devuelve **ambos** en la misma lectura, lo cual es correcto, pero se pierde el orden temporal entre ellos dentro de esa ventana |

La última fila importa: el dosier §9.6 agrupa eventos en una ventana de 1–3 ms y
compara amplitudes, no orden de llegada. **La pérdida de orden dentro de la
ventana de lectura (decenas de µs) no afecta al algoritmo especificado.** Debe
confirmarse con WP-04 (firmware) antes de congelar el diseño.

---

## 6. Resumen ejecutivo

| Pregunta | Respuesta |
|---|---|
| ¿Cuadra el presupuesto de GPIO tal como lo plantea el dosier §8.4? | **NO.** Déficit de 4 pines sin reserva, de 9 con reserva. |
| ¿Existe una topología que cuadre? | **SÍ**, la topología B: 21 usados, 4 de reserva sobre 25 disponibles. |
| ¿Es la reserva de calidad? | **Parcialmente**: 1 pin libre + 3 pines de JTAG. Ver variante B′. |
| ¿Qué decisión del dosier §35 desbloquea esto? | La n.º 1 (modelo exacto de ESP32-S3) y la n.º 11 (multiplexor o ADC externo). |

---

## 7. Lo que hay que verificar antes de creerse esto

1. Contrastar la tabla de pines contra la hoja de datos de la **revisión concreta**
   del ESP32-S3-WROOM-1 que se compre (las restricciones han cambiado entre
   revisiones de silicio).
2. Confirmar con el fabricante del módulo si la variante adquirida lleva PSRAM
   octal (`R8`) o quad (`R2`): decide si `IO35`–`IO37` están disponibles.
3. Comprobar en firmware que `IO47`/`IO48` no tienen restricción en el módulo
   concreto (en algunas revisiones están ligados a LED de placa de desarrollo).
4. Medir el nivel bajo real de `IRQ_ANY` con 1 y con 9 comparadores activos.
5. Verificar con WP-04 que el algoritmo de vibración cruzada tolera la
   agregación de interrupciones.
6. Verificar el tiempo desde el flanco de `IRQ_ANY` hasta tener los 9 bits
   leídos por SPI: debe ser muy inferior a la ventana de agrupación de 1–3 ms.
