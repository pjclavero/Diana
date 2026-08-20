# Hoja 05 — Lectura de amplitudes: multiplexor (opción A) o ADC SPI externo (opción B)

> ## ⚠ NO UTILIZADO EN PROTOTIPO V1 — hoja completa (ADS7953 / MCP3208 / CD74HC4067)
>
> El prototipo físico V1 detecta **exclusivamente** por la salida digital `DO` de
> nueve módulos comerciales de sensor piezoeléctrico, con umbral ajustado por
> potenciómetro. **No monta** ADS7953, ADS1115, MCP3208, CD74HC4067, MCP6004,
> LM339 externo ni `VREF_TH` por PWM, y **no mide amplitud**.
>
> Este documento se conserva como **DISEÑO FUTURO** (PCB integrada). Sigue siendo
> válido como tal; **no describe el prototipo que se monta hoy**.
> Prototipo V1: `docs/hardware/prototipo-do-only.md` ·
> pinout normativo: `firmware/esp32/boards/esp32s3_proto_do_w5500.h`.

---

> **SIN VALIDAR.** ERC no ejecutado. Dosier §9.5 y §28.4. Corresponde a la
> decisión pendiente n.º 11 del dosier §35 («multiplexor o ADC externo»).

**Recomendación: opción B (ADC SPI externo).** Motivo decisivo: el presupuesto de
GPIO (cálculo 03) sólo cierra con reserva usando la opción B. Ambas opciones se
diseñan sobre la misma PCB; **sólo una se puebla**, la otra queda **(DNP)**.

## 1. Comparación de las dos opciones

| Criterio | Opción A: CD74HC4067 + ADC del ESP32-S3 | Opción B: ADC SPI externo |
|---|---|---|
| GPIO consumidos | **5** (S0–S3 + 1 ADC1) | **1** (nCS_ADC, comparte el bus SPI) |
| Reserva de GPIO resultante | **0** — incumple el dosier §8.4 | **4** |
| Resolución | 12 bit del ESP32-S3 | 12 bit |
| Linealidad | Mediocre; exige calibración por eFuse | Buena (INL ±1 LSB típ.) **(H)** |
| Riesgo ADC2/RF | Ninguno si se usa ADC1 | Ninguno |
| Canales extra | 16 − 9 = 7 libres | 16 − 9 = 7 libres |
| Coste de componentes | Menor | Mayor |
| Disponibilidad | Muy alta | Media |
| Complejidad de firmware | Baja | Media (transacción SPI compartida) |

## 2. OPCIÓN B — ADC SPI externo (recomendada)

### 2.1 Componentes

| Ref. | Valor / tipo | Encapsulado | Función |
|---|---|---|---|
| **U50** | **ADS7953SBDBT** — 16 canales, 12 bit, SAR, SPI, hasta 1 MSPS | TSSOP-30 | ADC principal |
| C50 | 10 µF / 10 V X7R | 0805 | Bulk de alimentación de U50 |
| C51 | 100 nF | 0603 | Desacoplo de U50 |
| C52 | 1 µF | 0603 | Referencia interna de U50 |
| R50 | 10 kΩ | 0603 | Pull-up de `nCS_ADC` (estado seguro en reposo) |
| R51–R61 | 11 × 1 kΩ 1 % | 0603 | Serie de protección/anti-alias en cada entrada |
| C53–C63 | 11 × 1 nF NP0 | 0603 | Anti-alias. f_c = 1/(2π·1k·1n) = **159 kHz** |
| D50–D55 | 6 × **BAV99** (doble diodo) | SOT-23 | Clamp de las entradas a rieles (2 canales por CI) |
| TP50–TP52 | Pines de prueba | THT | ver §4 |

### 2.2 Mapa de canales

| Canal de U50 | Señal | Origen |
|---:|---|---|
| CH0 | `ENV1` | hoja 04, CH1 |
| CH1 | `ENV2` | |
| CH2 | `ENV3` | |
| CH3 | `ENV4` | |
| CH4 | `ENV5` | |
| CH5 | `ENV6` | |
| CH6 | `ENV7` | |
| CH7 | `ENV8` | |
| CH8 | `ENV9` | hoja 04, CH9 |
| CH9 | `VSENSE_12V` | hoja 01. Supervisión de tensión (dosier §8.1) |
| CH10 | `VSENSE_5V` | hoja 01 |
| CH11 | `VREF_TH` | **realimentación del umbral: el firmware comprueba que el PWM ha llegado donde debía** |
| CH12 | `GND_ANA` a través de R | **autocomprobación: debe leer ≈ 0** |
| CH13–CH15 | Reserva, con pads accesibles | Ampliación futura |

CH11 y CH12 no estaban pedidos: son **autocomprobación**. CH12 leyendo un valor
distinto de cero delata una masa analógica degradada; CH11 delata un fallo en la
generación del umbral. Cuestan cero GPIO.

### 2.3 Conexionado

| Nodo | Conexiones |
|---|---|
| `+3V3A` | U50.AVDD, C50, C51 |
| `+3V3` | U50.DVDD (por su propio 100 nF) |
| `GND_ANA` | U50.AGND, C50.2, C51.2, C53–C63.2 |
| `GND_LOG` | U50.DGND — **unida a `GND_ANA` sólo en el punto estrella de la hoja 01** |
| `SPI_SCLK` | IO12 → U50.SCLK |
| `SPI_MOSI` | IO11 → U50.DIN |
| `SPI_MISO` | IO13 ← U50.DOUT |
| `nCS_ADC` | IO14 → U50.CSn ; R50 a `+3V3` |
| `ENVn` | hoja 04 → R5x (1 kΩ) → U50.CHn ; C5x (1 nF) a `GND_ANA` ; D5x clamp a `+3V3A`/`GND_ANA` |
| `U50.REFOUT` | → C52 → `GND_ANA` (referencia interna, ver §2.4) |

### 2.4 Referencia de tensión

Se usa la **referencia interna de 2,5 V** de U50 **(V)**. Consecuencia: el fondo
de escala es 2,5 V, no 3,3 V.

```
Envolvente máxima esperada = 3,65 V (nodo recortado) → saturaría a 2,5 V
```

**Esto es un problema de diseño real:** con una referencia de 2,5 V, cualquier
impacto que lleve la envolvente por encima de 2,5 V se lee como saturado y se
pierde la información de amplitud, que es exactamente lo que necesita el
algoritmo de vibración cruzada del dosier §9.6.

Tres soluciones, por orden de preferencia:

1. **Divisor de 2:1 en cada entrada** (sustituir R5x = 1 kΩ por 1 kΩ + 1 kΩ a
   masa): rango de entrada 0–5 V mapeado a 0–2,5 V. Coste: 9 resistencias más y
   la mitad de resolución efectiva (1,22 mV/LSB sobre la envolvente).
   **RECOMENDADA.**
2. Usar referencia externa de 3,3 V y modo de entrada extendido, si el ADC
   elegido lo admite.
3. Limitar la envolvente por debajo de 2,5 V con un divisor tras el seguidor.

**Adoptada la solución 1.** Con ella:

```
Fondo de escala en la envolvente = 5,00 V
Resolución = 5,00 V / 4096 = 1,221 mV/LSB
Umbral del comparador (120,7 mV) = 99 LSB   ⇒ margen de dinámica suficiente
```

### 2.5 Alternativa de menor riesgo de suministro

**2 × MCP3208-BI/SL** (8 canales, 12 bit, SPI, DIP/SOIC, muy disponible).
Consume **2** chip selects en lugar de 1, lo que deja la reserva de GPIO en 3 en
vez de 4 — sigue cumpliendo el mínimo del dosier §8.4. El MCP3208 usa V_DD como
referencia (3,3 V), lo que evita el problema de §2.4 pero exige el mismo divisor
para no saturar por encima de 3,3 V.

## 3. OPCIÓN A — multiplexor CD74HC4067 **(DNP)**

### 3.1 Componentes

| Ref. | Valor / tipo | Encapsulado | Función |
|---|---|---|---|
| U51 | **CD74HC4067M** — multiplexor analógico 16:1 | SOIC-24 | Selección de canal |
| R70 | 1 kΩ 1 % | 0603 | Serie a la entrada del ADC del ESP32-S3 |
| C70 | 1 nF NP0 | 0603 | Filtro de la salida común |
| D56 | BAV99 | SOT-23 | Clamp de `MUX_AOUT` |

### 3.2 Conexionado

| Nodo | Conexiones |
|---|---|
| `MUX_S0`..`MUX_S3` | ESP32-S3 → U51.S0..S3 |
| `U51.E` (habilitación, activa baja) | → `GND_ANA` (siempre habilitado) |
| `U51.I0..I8` | `ENV1`..`ENV9` |
| `U51.I9`, `I10` | `VSENSE_12V`, `VSENSE_5V` |
| `U51.I11..I15` | Reserva, a `GND_ANA` por 100 kΩ |
| `MUX_AOUT` | U51.COM → R70 → C70 → entrada ADC1 del ESP32-S3 |
| `+3V3A` | U51.VCC ; `GND_ANA` | U51.GND, U51.VEE |

### 3.3 Error introducido por la resistencia de paso

```
R_on(CD74HC4067 a 3,3 V) ≈ 70 Ω  (H)
Divisor con R_env = 220 kΩ:  error = 70 / (70 + 220 000) = 0,032 %
```

**Despreciable.** El multiplexor no degrada la medida de amplitud por este
motivo. El problema de la opción A no es la precisión analógica, es el coste en
GPIO y la linealidad del ADC integrado del ESP32-S3.

### 3.4 Tiempo de establecimiento

```
t_settle = 5 × R_on × (C_muestreo del ADC + C70)
         ≈ 5 × 70 Ω × (25 pF + 1 nF) ≈ 0,36 µs
```

Despreciable frente a los 50 µs por conversión. El barrido de 9 canales sigue
costando ~450 µs y sigue produciendo la caída del 4,26 % de amplitud calculada
en el cálculo 02 §5.1.

## 4. Puntos de prueba

| TP | Red | Criterio |
|---|---|---|
| TP50 | `nCS_ADC` | Pulsos válidos, nivel alto ≥ 3,0 V |
| TP51 | Entrada CH12 (autocomprobación de masa) | Lectura < 5 LSB |
| TP52 | `ENV1` en la entrada del ADC | Coincide con `TP_ENV1` de la hoja 03 dentro del 2 % |

## 5. Riesgos específicos de esta hoja

1. **Saturación por referencia de 2,5 V** (§2.4) — resuelto con divisor, **no
   verificado**.
2. **Bus SPI compartido con el W5500**: una transacción de Ethernet larga puede
   retrasar la lectura de amplitudes tras un impacto. **(V)** Medir el peor caso
   y comprobar que cabe en la ventana de 1–3 ms del dosier §9.6.
3. **Disponibilidad del ADS7953** — mitigado con la alternativa MCP3208 (§2.5).
4. **Caída de la envolvente durante el barrido** (4,26 %): compensable en
   firmware, pero **debe compensarse**, no ignorarse.
5. Si se puebla la opción A, la **reserva de GPIO cae a cero** e incumple el
   dosier §8.4.
