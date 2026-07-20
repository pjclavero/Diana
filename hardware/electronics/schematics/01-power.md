# Hoja 01 — Alimentación, protecciones y distribución

> **SIN VALIDAR.** ERC no ejecutado. Ningún valor medido.
> Corresponde al dosier §11 y §28.1.

## 0. Alcance y seguridad eléctrica

Esta hoja **empieza en la entrada de 12 V de continua**. Los 230 V AC quedan
**fuera de la PCB**: el dosier §11.3 exige que, para los primeros prototipos, se
utilice una **fuente externa certificada de 12 V / 3 A**, y que si la fuente se
integrase en la caja el diseño sea revisado por personal competente en seguridad
eléctrica. **Este diseño asume fuente externa certificada.**

## 1. Cadena de bloques

```
J1 (12 V DC ext.) → SW1 (interruptor) → F1 (fusible) → Q1 (antipolaridad PMOS)
   → D1 (TVS) → L1/C2/C3 (filtro) → [+12V_F]
                                       ├→ U1 buck 12→5 V 6 A → [+5V bus]
                                       │        ├→ [+5V_LED]  (72 LED)
                                       │        └→ [+5V_LOG]  (lógica)
                                       │                └→ U2 buck 5→3,3 V 1 A → [+3V3]
                                       │                          └→ FB1 → [+3V3A]
                                       └→ divisor R6/R7 → VSENSE_12V
```

## 2. Lista de componentes

| Ref. | Valor / tipo | Encapsulado | Función |
|---|---|---|---|
| J1 | Conector 2 vías bloqueable, ≥ 8 A, paso 5,08 mm | THT | Entrada 12 V DC desde fuente externa |
| SW1 | Interruptor bipolar 250 V / 6 A con piloto | Panel | Corte general (dosier §11.3) |
| F1 | Fusible **T 3,15 A** (retardado) 250 V, 5×20 mm, con portafusibles | THT | Protección de sobrecorriente. Cálculo: 2,26 A nominal ⇒ 3,15 A ≈ 140 % |
| NTC1 | 10 Ω / 2 A, inrush limiter | THT | Limita el pico de carga de los 2 000 µF de bulk **(V)** |
| Q1 | MOSFET **canal P**, V_DS ≥ 30 V, R_DS(on) ≤ 30 mΩ, ej. AO3401A / SI2301 | SOT-23 | Protección de polaridad inversa **sin caída de diodo** |
| R1 | 100 kΩ 1 % | 0603 | Pull-down de puerta de Q1 |
| D2 | Zener 12 V / 500 mW | SOD-123 | Protege V_GS de Q1 (límite ±20 V) |
| D1 | TVS unidireccional **SMBJ15A** (V_R 15 V, V_C 24,4 V, 600 W) | SMB | Sobretensión de entrada (dosier §11.3) |
| L1 | 10 µH / 3 A, ferrita de potencia | 1210 | Filtro de entrada |
| C1 | 470 µF / 25 V electrolítico | THT ⌀10 mm | Bulk de entrada de 12 V |
| C2 | 10 µF / 25 V X7R | 1210 | Filtro de entrada |
| C3 | 100 nF / 50 V X7R | 0603 | Filtro de alta frecuencia |
| **U1** | Convertidor **buck síncrono 12 V → 5 V, ≥ 6 A**, f_sw ≥ 500 kHz, η ≥ 0,93 a plena carga **(V)** | ver BOM | Convertidor principal |
| L2 | Inductancia del lazo de U1, según hoja de datos de U1, I_sat ≥ 9 A | — | |
| C4, C5 | 2 × 1 000 µF / 10 V **low-ESR** (ESR ≤ 30 mΩ c/u) | THT ⌀10 mm | Bulk del bus LED. Cálculo 01 §5: 1 528 µF necesarios, ESR combinada ≤ 26,2 mΩ |
| C6 | 22 µF / 10 V X7R | 1210 | Salida de U1, alta frecuencia |
| C7 | 100 nF | 0603 | |
| **U2** | Buck síncrono **5 V → 3,3 V, 1 A**, f_sw ≥ 1 MHz | ver BOM | Riel de lógica. Cálculo 04 §5 |
| C8 | 10 µF / 10 V X7R | 0805 | Entrada de U2 |
| C9 | 22 µF / 10 V X7R | 0805 | Salida de U2 |
| FB1 | Ferrita 600 Ω @ 100 MHz, ≥ 500 mA | 0805 | Aísla `+3V3A` del ruido de conmutación |
| C10 | 10 µF / 10 V X7R | 0805 | Bulk de `+3V3A` |
| C11 | 100 nF | 0603 | `+3V3A` alta frecuencia |
| R6 | 100 kΩ 1 % | 0603 | Divisor de medida de 12 V (rama alta) |
| R7 | 10 kΩ 1 % | 0603 | Divisor de medida de 12 V (rama baja) |
| C12 | 100 nF | 0603 | Filtro del divisor de 12 V, τ = 0,91 ms |
| R8 | 22 kΩ 1 % | 0603 | Divisor de medida de 5 V (rama alta) |
| R9 | 10 kΩ 1 % | 0603 | Divisor de medida de 5 V (rama baja) |
| C13 | 100 nF | 0603 | Filtro del divisor de 5 V |
| D3 | LED verde 3 mm «POWER» | THT | Indicador de alimentación |
| R10 | 1,5 kΩ | 0603 | Limitadora de D3, (5 − 2,0)/1500 = 2,0 mA |
| TP1..TP8 | Pin de prueba 1 mm | THT | ver §6 |

## 3. Conexionado nodo a nodo

### 3.1 Entrada y protecciones

| Nodo | Conexiones |
|---|---|
| `+12V_IN` | J1.1 → SW1.1 |
| `+12V_SW` | SW1.2 → NTC1.1 |
| `+12V_NTC` | NTC1.2 → F1.1 |
| `+12V_FUSE` | F1.2 → **Q1.source** |
| `+12V_F` | **Q1.drain** → D1.cátodo, L1.1, R6.1, C1.+ |
| `Q1.gate` | → R1.1 → `GND_PWR` ; → D2.cátodo (D2.ánodo a `GND_PWR`) |
| `GND_PWR` | J1.2 → SW1.3 (segundo polo) → plano de masa de potencia |

**Nota sobre la protección de polaridad inversa con PMOS:** el *source* va al
lado de la fuente y el *drain* al de la carga; la puerta se referencia a masa.
Con polaridad correcta V_GS es negativa (≈ −12 V, limitada a −12 V por D2) y el
MOSFET conduce con R_DS(on) ≤ 30 mΩ ⇒ caída de 2,26 A × 0,03 = **68 mV** y
disipación de **0,15 W**. Con polaridad invertida V_GS es positiva y el MOSFET
corta. Ventaja frente a un diodo en serie: un Schottky habría disipado
0,4 V × 2,26 A = **0,9 W**, seis veces más.

### 3.2 Filtro y convertidor principal

| Nodo | Conexiones |
|---|---|
| `+12V_F` | L1.1, D1.cátodo, C1.+, R6.1 |
| `+12V_FILT` | L1.2 → C2.1, C3.1, **U1.VIN** |
| `GND_PWR` | D1.ánodo, C1.−, C2.2, C3.2, U1.GND, U1.PAD térmico |
| `U1.EN` | → divisor de arranque según hoja de datos de U1; UVLO ajustado a **10,5 V** |
| `U1.SS` | → C_SS dimensionado para **t_arranque ≥ 5 ms** (limita el inrush de bulk) |
| `U1.SW` | → L2.1 |
| `+5V` (bus) | L2.2 → C4.+, C5.+, C6.1, C7.1, U1.FB (por divisor de realimentación), R8.1 |
| `+5V_LED` | derivación del bus `+5V` **por polígono ancho** hacia la hoja 06 |
| `+5V_LOG` | derivación del bus `+5V` hacia U2 y hacia la hoja 06 (V_CC del 74AHCT125) |

**`+5V_LED` y `+5V_LOG` son el mismo riel eléctrico**, separados
**topológicamente**: parten del mismo polígono de salida de U1 en un único punto
(estrella), pero recorren caminos de cobre distintos. Motivo: los transitorios de
4,32 A de los LED no deben circular por el cobre que alimenta la lógica. Esta es
la «separación de la alimentación de lógica y de LED» del encargo. **(V)** — hay
que medir si basta o si hace falta una separación galvánica real con un segundo
convertidor.

### 3.3 Riel de 3,3 V

| Nodo | Conexiones |
|---|---|
| `+5V_LOG` | → C8.1, **U2.VIN** |
| `+3V3` | U2.VOUT → C9.1, FB1.1, y a las hojas 02, 04, 05, 07 |
| `+3V3A` | FB1.2 → C10.1, C11.1, y a las hojas 03/04 (cadena analógica) y 05 |
| `GND` | C8.2, C9.2, C10.2, C11.2, U2.GND |

### 3.4 Medición de tensión

| Nodo | Conexiones | Cálculo |
|---|---|---|
| `VSENSE_12V` | R6.2 ∧ R7.1 ∧ C12.1 → hoja 02 (IO1, ADC1_CH0) y hoja 05 (canal 9 del ADC) | 12,0 V → **1,091 V** ; 13,8 V → **1,255 V** |
| `VSENSE_5V` | R8.2 ∧ R9.1 ∧ C13.1 → hoja 05 (canal 10 del ADC) | 5,00 V → **1,563 V** ; 5,50 V → **1,719 V** |
| `GND_LOG` | R7.2, C12.2, R9.2, C13.2 | |

Ambas tensiones quedan holgadamente por debajo de los 3,3 V de fondo de escala,
con margen para sobretensión. Constante de filtrado del divisor de 12 V:
τ = (100k ∥ 10k) × 100 nF = 9,09 kΩ × 100 nF = **0,91 ms**.

## 4. Distribución de masas

```
                    ┌── GND_PWR  (retorno de LED, C4/C5, J10..J12)  polígono ≥ 2 mm
U1.GND (pad) ───────┼── GND_LOG  (ESP32, W5500, digital)            plano continuo
   PUNTO ESTRELLA   └── GND_ANA  (piezo, ADC)                       plano continuo separado
```

`CHASSIS` (hoja 02/08) queda **aislado**, unido a `GND_LOG` únicamente a través
del condensador de 10 nF / 2 kV de la terminación Bob Smith.

## 5. Protecciones — trazabilidad contra el dosier §11.3

| Requisito del dosier §11.3 | Implementación | Estado |
|---|---|---|
| Fusible de entrada | F1, T 3,15 A | En esquema |
| Interruptor bipolar o equivalente | SW1, bipolar 6 A | En esquema |
| Protección contra polaridad inversa en 12 V | Q1 PMOS + R1 + D2 | En esquema |
| Protección contra sobretensión | D1, TVS SMBJ15A | En esquema |
| Protección térmica | Interna de U1 y U2 + tope de brillo por firmware | Parcial: **el corte térmico de U1 no se ha verificado (V)** |
| Tierra o doble aislamiento | Responsabilidad de la fuente externa certificada | **Fuera del alcance de esta PCB** |
| Conector bloqueable para 12 V interno | J1 | En esquema |
| Separación física 230 V / baja tensión | No aplica: fuente externa | **Fuera del alcance** |
| Caja cerrada para la fuente | Mecánica | **Fuera del alcance de esta hoja** |
| Prensaestopas y alivio de tracción | Mecánica | **Fuera del alcance de esta hoja** |
| Etiquetado eléctrico | Serigrafía de PCB: `12V DC 3A MAX`, polaridad junto a J1 | En esquema |
| Conector de servicio protegido | J30 (hoja 08), retranqueado y con marca | En esquema |

## 6. Puntos de prueba

| TP | Red | Qué se comprueba | Criterio |
|---|---|---|---|
| TP1 | `+12V_F` | Entrada tras protecciones | 11,4 – 12,6 V |
| TP2 | `+5V_LED` | Riel de LED en la salida de U1 | 4,90 – 5,10 V en vacío |
| TP3 | `+5V_LOG` | Riel de lógica | 4,90 – 5,10 V |
| TP4 | `+3V3` | Riel digital | 3,25 – 3,35 V |
| TP5 | `+3V3A` | Riel analógico | 3,25 – 3,35 V, rizado < 10 mV_pp |
| TP6 | `GND_PWR` | Referencia de potencia | — |
| TP7 | `GND_LOG` | Referencia de lógica | diferencia con TP6 < 50 mV en carga |
| TP8 | `U1.SW` | Conmutación de U1 | **sólo con punta diferencial**, no referenciar a masa |

## 7. Riesgos específicos de esta hoja

1. **Inrush.** 2 000 µF cargándose desde 12 V puede exceder el pico de la fuente
   de 3 A. Mitigado por NTC1 y soft-start de 5 ms; **no verificado (V)**.
2. **η del convertidor.** Si es < 0,93, la térmica no cierra en blanco máximo
   (cálculo 04 §2).
3. **Carga de la fuente al 75 %.** Poco margen para tolerancias de fuente
   comercial.
4. **Ruido del buck de 3,3 V** acoplándose a la cadena piezo (cálculo 04 §5).
5. **Un solo punto de fallo:** Q1 en cortocircuito deja de proteger sin aviso.
   No hay indicación de que la protección de polaridad esté sana.
