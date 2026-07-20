# Cálculo 01 — Presupuesto de potencia, bulk, caída de tensión y sección de cable

> **Estado: cálculo de diseño sobre hojas de datos y fórmulas normalizadas.
> NINGÚN valor de este documento ha sido medido.** No hay hardware. Las hipótesis
> marcadas con **(H)** son suposiciones que deben confirmarse en banco.

Fuente normativa: dosier §10.4 y §11.1.

---

## 1. Corriente de los LED

Base del dosier §10.4: 72 LED × 60 mA = 4,32 A a 5 V.

```
I_LED_pico = 72 × 60 mA = 4 320 mA = 4,320 A
P_LED_pico = 4,320 A × 5 V = 21,60 W
```

Ese es el caso «blanco máximo simultáneo», que el dosier §10.4 restringe a
diagnóstico. Desglose del origen de los 60 mA **(H)**: LED direccionable tipo
WS2812B, tres dados de ~19 mA + ~1 mA de consumo del controlador interno.

```
I_LED_reposo (todos apagados) = 72 × 1 mA = 72 mA
```

## 2. Corriente de la lógica

| Bloque | Corriente máx. considerada | Origen |
|---|---:|---|
| ESP32-S3 (Wi-Fi/BT apagados, CPU 240 MHz) | 240 mA | pico de hoja de datos **(H)** |
| W5500 (enlace 100 Mbit/s) | 183 mA | máximo de hoja de datos **(H)** |
| 3 × LM339 (9 comparadores) | 12 mA | 3 × ~4 mA **(H)** |
| 3 × MCP6004 (9 seguidores) | 5 mA | 3 × ~1,7 mA **(H)** |
| ADC SPI externo + 74HC165 ×2 | 8 mA | **(H)** |
| 74AHCT125 + LED de estado | 8 mA | **(H)** |
| **Suma** | **456 mA** | |
| **Presupuesto adoptado (redondeo al alza)** | **550 mA** | margen del 20 % |

## 3. Total y margen del convertidor

```
I_total_pico = 4,320 A (LED) + 0,550 A (lógica) = 4,870 A a 5 V
P_5V         = 4,870 A × 5 V = 24,35 W
```

Convertidor especificado por el dosier: **5–6 A**. Adoptando **6 A**:

```
Factor de carga = 4,870 / 6,000 = 81,2 %
Margen          = (6,000 − 4,870) / 6,000 = 18,8 %
```

**Dictamen:** un convertidor de 5 A dejaría un margen de sólo el 2,6 % y queda
descartado. **Se exige 6 A como mínimo.** Aun con 6 A, el 18,8 % de margen es
ajustado para picos de arranque, por lo que el firmware **debe** aplicar el tope
global de brillo del dosier §10.4 (ver §7).

## 4. Corriente en la entrada de 12 V

```
P_in = P_5V / η
```

| η del convertidor | P_in | I_12V | P disipada |
|---:|---:|---:|---:|
| 0,90 | 27,06 W | **2,255 A** | 2,706 W |
| 0,93 | 26,18 W | **2,182 A** | 1,833 W |
| 0,94 | 25,90 W | **2,159 A** | 1,554 W |

La fuente del dosier §11.1 es de **12 V / 3 A = 36 W**.

```
Factor de carga de la fuente = 2,255 / 3,000 = 75,2 %   (caso peor, η = 0,90)
```

Cabe, pero sin holgura para inrush. **Riesgo declarado:** la carga inicial de los
2 000 µF de bulk desde 12 V puede disparar la protección de la fuente. Mitigación
en el esquema 01: arranque suave (soft-start) del convertidor programado a ≥5 ms
y NTC limitadora de inrush en serie con la entrada de 12 V.

## 5. Dimensionado del condensador de bulk del bus LED

Escalón de carga considerado: de reposo (0,5 A) a blanco máximo (4,32 A).

```
ΔI = 4,320 − 0,500 = 3,820 A
```

Criterio de caída admisible: **ΔV = 0,25 V** (5,00 V → 4,75 V). Justificación: el
dato de las cadenas llega a 5 V desde el 74AHCT125; si el riel de LED cae, el
V_IH del primer LED (0,7 × V_DD) también cae y el margen de dato se mantiene,
pero por debajo de 4,5 V empieza a degradarse el color. 0,25 V es conservador.

```
C ≥ ΔI × t_recuperación / ΔV
```

| t de recuperación del lazo **(H)** | C necesaria |
|---:|---:|
| 50 µs (lazo de 20 kHz, buen diseño) | 764 µF |
| **100 µs (valor de diseño adoptado)** | **1 528 µF** |
| 200 µs (lazo lento) | 3 056 µF |

**Adoptado: 2 × 1 000 µF = 2 000 µF**, dentro del rango 1 000–2 200 µF del dosier
§10.4, con 31 % de margen sobre los 1 528 µF calculados.

### Requisito de ESR (frecuentemente olvidado)

La caída instantánea por ESR no la resuelve la capacidad:

```
ΔV_ESR = ΔI × ESR
```

Reservando 0,10 V de los 0,25 V para el término resistivo:

```
ESR_total ≤ 0,10 V / 3,820 A = 26,2 mΩ
```

Dos condensadores de 1 000 µF/10 V *low-ESR* de ~30 mΩ cada uno dan 15 mΩ en
paralelo. **Cumple con margen.** Un electrolítico genérico de 0,15 Ω **no**
cumpliría: el 26,2 mΩ es un requisito de compra, no una recomendación.

### Distribución

- 2 × 1 000 µF en la salida del convertidor (bus LED).
- 470 µF en **cada** punto de inyección de fila (3 filas).
- 100 nF cerámico cada 3–4 LED en las tiras.

## 6. Caída de tensión: cable e inyección de 5 V

Cada fila del dosier §10.2 lleva 24 LED:

```
I_fila = 24 × 60 mA = 1,440 A
```

Con inyección de 5 V en **ambos** extremos de la fila, cada extremo aporta
≤ 0,720 A.

Resistividad del cobre: ρ = 0,0175 Ω·mm²/m.

| Sección | R lineal | R ida+vuelta a 1 m | Caída a 1,44 A |
|---:|---:|---:|---:|
| 0,50 mm² (AWG 20) | 0,0350 Ω/m | 0,0700 Ω | **0,101 V** |
| 0,75 mm² (AWG 18) | 0,0233 Ω/m | 0,0467 Ω | **0,067 V** |
| 1,00 mm² (AWG 17) | 0,0175 Ω/m | 0,0350 Ω | **0,050 V** |

**Adoptado: 0,75 mm² para las mazos de alimentación de fila** (0,067 V a 1 m,
con margen para tiradas de hasta 1,5 m dentro del módulo). El dato (señal) puede
ir en 0,25 mm².

Nota: la carga está distribuida a lo largo de la tira, no concentrada en el
extremo, por lo que la caída real será aproximadamente la mitad de la tabla. Se
usa el caso concentrado por ser el conservador.

## 7. Sección de pista de PCB

Norma IPC-2221, capa externa:

```
I = k · ΔT^0,44 · A^0,725      con k = 0,048 ; A en mil² ; ΔT en °C
⇒ A = ( I / (k · ΔT^0,44) )^(1/0,725)
```

Punto de diseño: **I = 5,0 A** (4,87 A calculados, redondeado al alza), **ΔT = 20 °C**.

```
ΔT^0,44 = 20^0,44 = 3,736
k · 3,736 = 0,1793
A = (5,0 / 0,1793)^1,379 = 27,89^1,379 = 98,5 mil²
```

| Espesor de cobre | Anchura necesaria |
|---|---:|
| 1 oz (35 µm, 1,378 mil) | 98,5 / 1,378 = 71,5 mil = **1,82 mm** |
| 2 oz (70 µm, 2,756 mil) | 98,5 / 2,756 = 35,7 mil = **0,91 mm** |

**Regla de diseño adoptada:** riel `+5V_LED` y su retorno `GND_PWR` con
**anchura mínima de 2,0 mm a 1 oz** (equivale a la clase de red `POWER_LED` del
`.kicad_pro`), preferentemente como polígono. Para 12 V a 2,26 A basta 1,2 mm.

### Caída en la propia pista

ρ_Cu = 1,72·10⁻⁸ Ω·m, tramo de 100 mm del convertidor al conector de fila:

| Pista | R | Caída a 4,32 A |
|---|---:|---:|
| 2,0 mm × 35 µm × 100 mm | 24,6 mΩ | **0,106 V** |
| 3,0 mm × 35 µm × 100 mm | 16,4 mΩ | 0,071 V |
| 2,0 mm × 70 µm × 100 mm | 12,3 mΩ | 0,053 V |

**Presupuesto total de caída convertidor → último LED:** 0,106 V (pista) +
0,067 V (cable) = **0,173 V**, es decir 5,00 → 4,83 V. Dentro del objetivo de
0,25 V con 31 % de margen.

## 8. Consecuencia para el firmware (WP-04)

Con el tope global de brillo al **60 %**:

```
I_LED = 4,320 × 0,60 = 2,592 A
I_total = 2,592 + 0,550 = 3,142 A   →  52 % de carga del convertidor de 6 A
```

Ese es el punto de trabajo normal recomendado. El blanco al 100 % queda
reservado a diagnóstico y limitado en el tiempo (ver cálculo 04, térmica).

## 9. Lo que hay que medir antes de creerse esto

1. Corriente real de un LED del modelo que se compre, en blanco máximo y en
   reposo (los 60 mA y 1 mA son de catálogo).
2. Consumo real del ESP32-S3 con el W5500 enlazado a 100 Mbit/s.
3. Rendimiento real del convertidor a 4,87 A y a 3,14 A.
4. Caída real de tensión en el extremo lejano de cada fila, en blanco máximo.
5. Amplitud del escalón de tensión en el bus LED con transición negro→blanco.
6. Corriente de inrush al conectar los 12 V.
