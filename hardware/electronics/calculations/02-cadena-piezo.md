# Cálculo 02 — Cadena piezoeléctrica: energía, clamp, envolvente e histéresis

> **Estado: cálculo de diseño. NADA medido.** El dosier §9.3 declara
> explícitamente que «los valores finales deben validarse en banco» y §34 lista
> «Piezo daña el ESP32» como riesgo de impacto *avería*. Este documento
> dimensiona la protección; **no demuestra que proteja**.

Fuente normativa: dosier §9.2, §9.3, §9.5, §28.3.

---

## 1. Modelo del transductor

Disco piezoeléctrico de 27–35 mm (dosier §27.1). Modelo eléctrico: fuente de
carga en paralelo con su propia capacidad.

| Parámetro | Valor adoptado | Origen |
|---|---:|---|
| C_p (capacidad del disco de 27 mm) | **20 nF** | típico de catálogo **(H)** |
| V_pico en circuito abierto, impacto fuerte | **hasta 150 V** | hipótesis conservadora **(H)** |

**El valor de 150 V es la hipótesis crítica de toda la protección.** Un disco
piezo golpeado con fuerza y sin carga puede superar los 100 V con facilidad. Si
en banco se midieran picos superiores, todo este dimensionado hay que rehacerlo.

## 2. Energía del pulso

```
E = ½ · C_p · V²
```

| V_pico | E almacenada | I por el clamp con R_serie = 68 kΩ | P instantánea en R_serie |
|---:|---:|---:|---:|
| 30 V | 9,0 µJ | 0,39 mA | 0,010 W |
| 50 V | 25,0 µJ | 0,68 mA | 0,032 W |
| 100 V | 100,0 µJ | 1,42 mA | 0,137 W |
| **150 V (caso de diseño)** | **225,0 µJ** | **2,15 mA** | **0,315 W** |

Corriente por el clamp:

```
I_clamp = (V_pico − V_clamp) / R_serie = (150 − 3,65) / 68 000 = 2,152 mA
```

donde V_clamp = 3,30 V (riel) + 0,35 V (V_f del BAT54 a esa corriente) = 3,65 V.

**2,15 mA está tres órdenes por debajo** de los 200 mA continuos del BAT54S y muy
por debajo de los límites de los diodos de sujeción internos del ESP32-S3. La
resistencia serie es lo que hace segura la cadena; sin ella el pico llegaría
directamente al silicio.

## 3. Dos hallazgos reales sobre la resistencia serie

### 3.1 Tensión de trabajo del componente

La resistencia serie ve **la tensión completa del piezo** antes del clamp. Una
resistencia 0603 típica está calificada para **50 V** — insuficiente para 150 V.

**Decisión:** dividir R_serie en **dos resistencias de 33 kΩ en serie, encapsulado
0805 (150 V cada una)**, dando 66 kΩ ≈ 68 kΩ y 300 V de tensión soportada.
Separación en PCB de la clase de red `PIEZO_HV` (aislamiento 0,8 mm).

### 3.2 Energía por pulso, no potencia continua

La potencia instantánea de 0,315 W supera los 100 mW de un 0603, pero el pulso
dura menos de 1 ms:

```
E_pulso   = 0,315 W × 0,5 ms = 0,158 mJ
P_media a 5 impactos/s = 0,158 mJ × 5 = 0,79 mW
```

**Despreciable en media.** El criterio que decide es la energía de pulso único,
que debe contrastarse con la curva de sobrecarga puntual del fabricante — **no
comprobada**, entra en la lista de validación física.

## 4. Resistencia de descarga (bleed)

R_bleed = 1 MΩ en paralelo con el piezo (dosier §9.3):

```
τ_bleed = 1 MΩ × 20 nF = 20,0 ms
f_corte = 1 / (2π · 1 MΩ · 20 nF) = 7,96 Hz
```

Función: (a) impedir que la carga se acumule y derive el punto de reposo,
(b) formar un paso alto de 7,96 Hz que rechaza deriva térmica y flexión lenta de
la diana sin tocar el contenido del impacto (cientos de Hz a kHz).

## 5. Detector de envolvente — el punto donde el diseño «de libro» falla

Requisito del dosier §9.3: mantener el pico entre **2 y 10 ms**.

### 5.1 Constante de caída

```
τ_env = R_env · C_env      con R_env = 220 kΩ
```

| C_env | τ_env | Caída durante un barrido de 9 canales (450 µs) |
|---:|---:|---:|
| 22 nF | 4,84 ms | **8,88 %** |
| **47 nF (adoptado)** | **10,34 ms** | **4,26 %** |
| 100 nF | 22,00 ms | 2,02 % |

El barrido de 450 µs supone 9 conversiones a 50 µs **(H)**. Con 22 nF el último
canal leído habría perdido casi el 9 % de amplitud, lo que **falsearía la
comparación de amplitudes entre canales vecinos** — que es exactamente el
mecanismo de rechazo de vibración cruzada del dosier §9.6. Con 47 nF el error
cae al 4,26 % y, además, es determinista: el firmware puede compensarlo canal a
canal multiplicando por `exp(+t_canal/τ)`.

**Adoptado: R_env = 220 kΩ, C_env = 47 nF, τ = 10,34 ms.** Está en el extremo
alto del rango 2–10 ms del dosier, deliberadamente.

### 5.2 Hallazgo: el tiempo de ATAQUE del detector pasivo es inaceptable

Si el rectificador y C_env se colocan directamente detrás de la resistencia serie
de 68 kΩ, como sugiere la lectura literal del diagrama de bloques del §9.2:

```
τ_ataque = 68 kΩ × 47 nF = 3,20 ms
```

**3,20 ms para cargar el condensador con un impacto que dura menos de 1 ms.** El
detector nunca alcanzaría el pico: mediría una fracción arbitraria de él,
dependiente de la duración del golpe. La medida de amplitud sería inservible y la
clasificación de vibración cruzada, también.

**Corrección de diseño adoptada:** insertar un **seguidor de tensión** (una
sección de MCP6004, rail-to-rail, alimentado a 3,3 V) entre el nodo recortado y
el rectificador. Con una impedancia de salida de ~100 Ω:

```
τ_ataque = 100 Ω × 47 nF = 4,70 µs
```

Relación ataque/caída = 10,34 ms / 4,70 µs = **2 200 : 1**. Correcto para un
detector de envolvente.

Coste: 9 secciones de operacional = 3 × MCP6004 (cuádruple). Es la diferencia
entre un circuito que funciona y uno que sólo lo parece sobre el papel.

## 6. Comparador con histéresis

Topología: comparador **no inversor** con realimentación positiva, salida en
**colector abierto** (LM339), entrada + tomada de la **envolvente** (no de la
señal cruda — ver §7).

### 6.1 Referencia de umbral

Divisor desde +3,3 V con R_top = 33 kΩ y R_bot = 1,24 kΩ:

```
V_REF = 3,3 × 1 240 / (33 000 + 1 240) = 0,1195 V = 119,5 mV
```

### 6.2 Umbrales de conmutación

Con R_in = 10 kΩ (entre la envolvente y la entrada +) y R_fb = 1 MΩ (de la salida
a la entrada +), salida con pull-up de 10 kΩ a 3,3 V:

```
V_subida  = V_REF · (R_in + R_fb) / R_fb
          = 0,1195 × (1 010 000 / 1 000 000) = 0,1207 V = 120,7 mV

V_bajada  = [ V_REF − 3,3 · R_in/(R_in+R_fb) ] · (R_in+R_fb)/R_fb
          = [ 0,1195 − 3,3 × 0,009901 ] × 1,010
          = [ 0,1195 − 0,03267 ] × 1,010 = 0,0877 V = 87,7 mV
```

```
HISTÉRESIS = 120,7 − 87,7 = 33,0 mV   (27,3 % del umbral de subida)
```

Una histéresis del 27 % es amplia a propósito: el objetivo del dosier §9.1 es
«evitar múltiples conteos por resonancia», y la cola de un impacto oscila
alrededor del umbral. Si en banco resultara excesiva (pérdida de impactos
suaves), se reduce subiendo R_fb: con R_fb = 2,2 MΩ la histéresis baja a ~15 mV.

### 6.3 Umbral ajustable

El dosier §9.3 exige «umbral ajustable por banco o por canal». Opciones, en orden
de preferencia:

1. **PWM del ESP32-S3 + filtro RC** (R 47 kΩ / C 1 µF, τ = 47 ms) generando
   V_REF común a los 9 canales desde un GPIO de la reserva. Ajustable por
   firmware, sin componentes caros. **Recomendada para el prototipo.**
2. Potenciómetro multivuelta de 10 kΩ en el divisor. Ajustable sólo a mano.
3. DAC I²C de 4 canales (MCP4728) para umbral por banco de 3 canales. Cuesta
   2 GPIO adicionales.

Nota: el ESP32-S3 **no tiene DAC interno** (a diferencia del ESP32 original), por
lo que la opción «GPIO → DAC directo» no existe. Es una diferencia que se ha
verificado antes de proponer la opción 1.

## 7. Decisión: el comparador se alimenta de la envolvente, no de la señal cruda

| | Comparador sobre señal cruda | Comparador sobre envolvente **(adoptado)** |
|---|---|---|
| Latencia de detección | ~1 µs | ~10–30 µs (ataque + V_f del rectificador) |
| Duración del pulso de salida | igual al cruce de umbral (puede ser < 50 µs) | mientras la envolvente supere el umbral: **milisegundos** |
| ¿Necesita un latch para no perder el evento? | **Sí** (9 biestables adicionales) | No: el 74HC165 se lee con holgura |
| Riesgo de recuento múltiple por resonancia | alto | bajo (la envolvente integra) |

La latencia de 10–30 µs es irrelevante frente a la ventana de agrupación de
**1–3 ms** del dosier §9.6, y frente al bloqueo de 30–100 ms tras impacto válido.
La ganancia —no necesitar 9 biestables ni arriesgarse a perder pulsos cortos— es
sustancial.

**Contrapartida documentada:** se pierde la capacidad de discriminar dos impactos
separados por menos de ~10 ms en el mismo canal. El dosier §9.6 ya impone un
bloqueo de 30–100 ms tras impacto válido, así que no se pierde funcionalidad
requerida. Si en el futuro se exigiera cadencia mayor, hay que volver a la señal
cruda con latch.

## 8. Nivel lógico del OR cableado de interrupción (hoja 04)

Los 9 comparadores de colector abierto se unen a un único GPIO mediante 9 diodos
Schottky (cátodo en cada salida, ánodo en el nodo común con pull-up de 4,7 kΩ):

```
V_IL(IRQ_ANY) = V_OL(LM339) + V_f(BAT54) = 0,20 V + 0,30 V = 0,50 V
V_IL_máx(ESP32-S3) = 0,25 × 3,3 V = 0,825 V
MARGEN = 0,825 − 0,50 = 0,325 V
```

**Cumple.** Los diodos son necesarios porque una unión directa de las 9 salidas
haría perder la identidad del canal; con ellos, cada salida conserva su propio
pull-up y su propia entrada del 74HC165.

## 9. Resumen de valores adoptados por canal

| Elemento | Valor | Justificación |
|---|---|---|
| R_bleed | 1 MΩ | dosier §9.3 ; τ = 20 ms ; f_c = 7,96 Hz |
| R_serie | 2 × 33 kΩ (0805) | rango 47–100 kΩ del dosier ; 300 V soportados |
| Clamp | BAT54S a +3V3A y GND | I_clamp máx. 2,15 mA a 150 V |
| Buffer | MCP6004 (¼) seguidor | τ_ataque 4,70 µs en vez de 3,20 ms |
| Rectificador | BAT54 | V_f baja |
| C_env / R_env | 47 nF / 220 kΩ | τ = 10,34 ms ; caída de barrido 4,26 % |
| Comparador | LM339 (¼), colector abierto | permite OR cableado |
| R_in / R_fb / R_pu | 10 kΩ / 1 MΩ / 10 kΩ | histéresis 33,0 mV |
| V_REF | 119,5 mV (33 kΩ / 1,24 kΩ) | umbral 120,7 mV |

## 10. Lo que hay que medir antes de creerse esto

1. **Tensión de pico real** en circuito abierto de los discos comprados, con el
   impacto más fuerte previsto. Es la hipótesis que sostiene toda la protección.
2. Capacidad real C_p de los discos (afecta τ_bleed y la energía).
3. Duración real del pulso de impacto (afecta el dimensionado de R_serie).
4. Forma de onda en TP_CLMP con el osciloscopio: confirmar que **nunca** supera
   +3,7 V ni baja de −0,4 V, con la punta a 10:1 y ancho de banda suficiente.
5. Ensayo de sobretensión destructivo sobre una placa sacrificable antes de
   conectar ningún ESP32 (dosier §34, mitigación «pruebas de sobretensión»).
6. Tiempo de ataque y de caída reales en TP_ENV.
7. Umbral e histéresis reales en TP_CMP con rampa lenta de entrada.
8. Nivel bajo real de IRQ_ANY con 1 y con 9 canales activos simultáneamente.
