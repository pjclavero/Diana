# Hoja 06 — Conversión de nivel y potencia de las 3 cadenas LED

> **SIN VALIDAR.** ERC no ejecutado. Dosier §10.2, §10.3, §10.4 y §28.5.
> Dimensionado en [`../calculations/01-presupuesto-potencia-led.md`](../calculations/01-presupuesto-potencia-led.md).

## 1. Por qué hace falta conversión de nivel (no es opcional)

```
V_IH del LED direccionable = 0,7 × V_DD = 0,7 × 5,0 V = 3,50 V
V_OH del ESP32-S3          = ≈ 3,20 V  (con V_DD = 3,3 V)

3,20 V < 3,50 V   ⇒  INCUMPLE
```

Conectar el ESP32-S3 directamente a la cadena funciona «a veces», con margen
negativo, y falla con la temperatura o con un lote distinto de LED. **El
74AHCT125 es obligatorio**: su V_IH es de **2,0 V** con V_CC de 5 V (esa es la
razón de ser de la familia HCT), y su V_OH es de **≈ 4,4 V**, con margen sobrado
sobre los 3,50 V requeridos.

## 2. Componentes

| Ref. | Valor / tipo | Encapsulado | Función |
|---|---|---|---|
| **U60** | **74AHCT125PW** — cuádruple buffer triestado, V_CC = 5 V | TSSOP-14 | Conversión de nivel 3,3 → 5 V |
| R60, R61, R62 | **470 Ω** 1 % | 0603 | Serie de datos (dosier §10.3: 330–470 Ω). Colocar a **< 10 mm** de U60 |
| R63 | 10 kΩ | 0603 | Pull-down de la entrada del canal 4 (no usado) |
| C60, C61 | 2 × **1 000 µF / 10 V low-ESR** (ESR ≤ 30 mΩ c/u) | THT ⌀10 mm | Bulk del bus LED (físicamente en la hoja 01, listados aquí por función) |
| C62, C63, C64 | 3 × **470 µF / 10 V low-ESR** | THT ⌀8 mm | Bulk local en cada punto de inyección de fila |
| C65 | 100 nF | 0603 | Desacoplo de U60 |
| C66 | 10 µF X7R | 0805 | Bulk local de U60 |
| F60, F61, F62 | 3 × PTC rearmable **I_hold 2,0 A / I_trip 4,0 A / 6 V** | 1812 | Un cortocircuito en una fila no tira el módulo entero |
| D60, D61, D62 | 3 × Schottky 3 A / 40 V (ej. SS34) | SMA | Diodo inverso de protección por fila ante conexión invertida del mazo |
| TP60–TP66 | Pines de prueba | THT | ver §5 |

## 3. Conexionado

### 3.1 Camino de datos

| Nodo | Conexiones |
|---|---|
| `LED_D1_3V3` | ESP32-S3 IO4 → U60.1A (pin 2) |
| `LED_D2_3V3` | ESP32-S3 IO5 → U60.2A (pin 5) |
| `LED_D3_3V3` | ESP32-S3 IO6 → U60.3A (pin 9) |
| — | U60.4A (pin 12) → R63 → `GND_PWR` (canal sobrante, entrada no flotante) |
| — | U60.1OE, 2OE, 3OE, 4OE (pines 1, 4, 10, 13) → `GND_PWR` (**salidas siempre habilitadas**) |
| `LED_D1_5V` | U60.1Y (pin 3) → R60 → J10.3 |
| `LED_D2_5V` | U60.2Y (pin 6) → R61 → J11.3 |
| `LED_D3_5V` | U60.3Y (pin 8) → R62 → J12.3 |
| `+5V_LOG` | U60.V_CC (pin 14) ; C65 ; C66 |
| `GND_PWR` | U60.GND (pin 7) ; C65.2 ; C66.2 |

**U60 se alimenta de `+5V_LOG`, no de `+5V_LED`.** Motivo: si el riel de LED cae
durante un transitorio de 4,32 A, el nivel de salida del buffer caería con él y
los datos se corromperían justo cuando más se necesitan. Alimentándolo del riel
de lógica, la señal de datos se mantiene estable. **(V)** — verificar que la
diferencia entre ambos rieles nunca supera 0,3 V, ya que el V_IH del primer LED
se referencia a **su** V_DD (el de `+5V_LED`).

### 3.2 Camino de potencia

| Nodo | Conexiones |
|---|---|
| `+5V_LED` | C60.+, C61.+ (hoja 01) → polígono de ≥ 2,0 mm |
| `+5V_ROW1` | `+5V_LED` → F60 → C62.+ → **J10.1 y J10.2** (dos vías en paralelo) |
| `+5V_ROW2` | `+5V_LED` → F61 → C63.+ → **J11.1 y J11.2** |
| `+5V_ROW3` | `+5V_LED` → F62 → C64.+ → **J12.1 y J12.2** |
| `GND_PWR` | C62.−, C63.−, C64.− ; J10.4, J11.4, J12.4 |
| — | D60 en antiparalelo entre J10.1 y J10.4 (cátodo a `+5V_ROW1`), ídem D61/J11 y D62/J12 |

**Doble vía por conector para el positivo:** cada fila consume 1,44 A. Una vía
JST VH está calificada para ~7 A, así que una bastaría, pero doblar el positivo
reduce a la mitad la resistencia de contacto y, sobre todo, **detecta un contacto
degradado** antes de que se caliente. Ver hoja 08.

### 3.3 Inyección de 5 V por ambos extremos

El dosier §10.4 exige «inyección de 5 V en cada fila». Aquí se va más allá:
**cada fila se alimenta por sus dos extremos**.

```
Sin inyección doble: el extremo lejano de 24 LED recibe la corriente completa
                     a través de toda la tira.
Con inyección doble: cada extremo aporta ≤ 0,72 A y la caída se reduce a ~1/4.
```

Implementación: un segundo mazo desde `+5V_ROWn` / `GND_PWR` hasta el extremo
final de cada tira, con conector J13/J14/J15 (hoja 08) de 2 vías. Los cálculos
de caída de tensión del cálculo 01 §6 asumen esta topología.

## 4. Presupuesto de potencia (resumen; detalle en el cálculo 01)

| Magnitud | Valor |
|---|---:|
| Corriente por fila (24 LED, blanco máximo) | **1,440 A** |
| Corriente total de los 72 LED | **4,320 A** |
| Corriente total del módulo (con lógica) | **4,870 A** |
| Convertidor requerido | **6 A** (81,2 % de carga) |
| Bulk calculado / adoptado | 1 528 µF / **2 000 µF** |
| ESR máxima admisible del bulk | **26,2 mΩ** |
| Sección de cable de fila | **0,75 mm²** (caída 0,067 V a 1 m) |
| Anchura mínima de pista de `+5V_LED` | **2,0 mm** a 1 oz |
| Caída total prevista convertidor → último LED | **0,173 V** |

**Requisito para WP-04 (firmware):** tope global de brillo. El punto de trabajo
recomendado es el **60 %**, que reduce la corriente total a 3,14 A (52 % de carga
del convertidor) y la temperatura de unión de U1 a 83 °C. El blanco al 100 % es
modo de diagnóstico y debe estar **limitado en el tiempo** (propuesta: ≤ 60 s).

## 5. Puntos de prueba

| TP | Red | Criterio de aceptación |
|---|---|---|
| TP60 | `+5V_LED` en la salida del convertidor | 4,90 – 5,10 V en reposo ; ≥ 4,75 V en blanco máximo |
| TP61 | `LED_D1_5V` (tras R60) | Nivel alto ≥ 4,0 V ; tiempos de flanco < 100 ns |
| TP62 | `LED_D2_5V` | ídem |
| TP63 | `LED_D3_5V` | ídem |
| TP64 | `+5V_ROW1` en el **extremo lejano** de la fila | ≥ 4,80 V en blanco máximo |
| TP65 | `+5V_ROW2` extremo lejano | ídem |
| TP66 | `+5V_ROW3` extremo lejano | ídem |

**El transitorio negro→blanco en TP60 es la medida que decide si el bulk está
bien dimensionado.** Criterio: caída ≤ 0,25 V y recuperación en < 500 µs.

## 6. Accesibilidad visual — nota de conformidad

El dosier §10.5 establece que «no se dependerá exclusivamente del color». Esa
tabla de estados (color + patrón) se implementa en **firmware** (WP-04) y en el
**panel web** (WP-03). El hardware sólo debe garantizar que los 8 LED de cada
diana son **independientemente direccionables**, condición que se cumple con las
cadenas de 24 LED por fila (3 dianas × 8 LED).

**Orden de direccionamiento (V):** debe fijarse un ADR que establezca si el LED 0
de la fila superior corresponde a la diana izquierda o a la derecha, y en qué
sentido giran los 8 LED de cada aro. Un error aquí produce iluminación en la
diana equivocada, que es un fallo funcional grave y silencioso.

## 7. Riesgos específicos de esta hoja

1. **Reinicio por sobreconsumo** (dosier §34: «Sobreconsumo LED → Reset o
   calor»). Mitigado por bulk, tope de brillo y separación de rieles. **Ninguna
   de las tres mitigaciones está verificada.**
2. **Diferencia de potencial entre `+5V_LOG` y `+5V_LED`** degradando el margen
   de datos (§3.1).
3. **Longitud de la cadena de 24 LED**: a 800 kbit/s, 24 LED × 24 bit = 576 bits
   = 720 µs por fila. Tres filas en paralelo por RMT ⇒ 720 µs por refresco.
   Suficiente para 50 refrescos/s con holgura. **(V)** Confirmar con WP-04 que
   las tres cadenas se emiten en paralelo y no en serie.
4. **Una avería de un LED corta su cadena** (dosier §34). Mitigado por el diseño
   de 3 cadenas: se pierde una fila, no el módulo.
5. **Los PTC (F60–F62) tienen resistencia no nula** (típicamente 25–50 mΩ), que
   se suma a la caída. A 1,44 A: 36–72 mV. Incluido en el margen, **no medido**.
