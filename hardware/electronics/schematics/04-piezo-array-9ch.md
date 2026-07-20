# Hoja 04 — Array de 9 canales piezoeléctricos y agregación de eventos

> **SIN VALIDAR.** ERC no ejecutado. Dosier §9, §8.4 y §28.3.

Esta hoja contiene **9 instancias** de la hoja 03 (`CH1`..`CH9`) más la lógica
que reduce **9 interrupciones a 4 GPIO** (cálculo 03 §3).

## 1. Mapa de canales

La numeración de canales sigue las coordenadas internas del dosier §6.2.

| Canal | Posición en el módulo | Conector (hoja 08) |
|---|---|---|
| CH1 | fila superior, izquierda | J20 pines 1–2 |
| CH2 | fila superior, centro | J20 pines 3–4 |
| CH3 | fila superior, derecha | J20 pines 5–6 |
| CH4 | fila central, izquierda | J21 pines 1–2 |
| CH5 | fila central, centro | J21 pines 3–4 |
| CH6 | fila central, derecha | J21 pines 5–6 |
| CH7 | fila inferior, izquierda | J22 pines 1–2 |
| CH8 | fila inferior, centro | J22 pines 3–4 |
| CH9 | fila inferior, derecha | J22 pines 5–6 |

**(V)** La correspondencia entre número de canal y posición física debe fijarse
en un ADR conjunto con WP-04 y WP-02 antes de fabricar; un intercambio silencioso
produciría puntuaciones erróneas indetectables.

## 2. Componentes de agregación

| Ref. | Valor / tipo | Encapsulado | Función |
|---|---|---|---|
| U40 | **74HC165** (registro de desplazamiento entrada paralelo / salida serie) | SOIC-16 | Bits 0–7 = CMP_OUT1..8 |
| U41 | **74HC165** | SOIC-16 | Bit 0 = CMP_OUT9 ; bits 1–7 a `+3V3` (inactivos) |
| D40–D48 | 9 × **BAT54** (Schottky) | SOT-23 (o 3 × BAT54S/BAV70 en array) | OR cableado hacia `IRQ_ANY` |
| R40 | **4,7 kΩ** | 0603 | Pull-up de `IRQ_ANY` a `+3V3` |
| R41 | 47 kΩ 1 % | 0603 | Filtro del PWM de umbral |
| C40 | 1 µF X7R | 0603 | Filtro del PWM de umbral. τ = **47 ms** |
| U42 | ¼ de MCP6004 (sección sobrante) | — | Seguidor de `VREF_TH` para desacoplar el filtro de los 9 comparadores |
| C41–C44 | 4 × 100 nF | 0603 | Desacoplo de U40, U41 y de los MCP6004/LM339 |
| TP40–TP44 | Pines de prueba | THT | ver §6 |

## 3. Agregación de las 9 interrupciones

### 3.1 Doble camino desde cada comparador

Cada `CMP_OUTn` (colector abierto, **activo a nivel bajo**, con su pull-up
individual `Rn7` de 10 kΩ en la hoja 03) va a **dos** sitios:

```
CMP_OUTn ──┬──────────────────────────→ entrada paralela del 74HC165  (identidad del canal)
           │
           └──[ D4x cátodo ]──── IRQ_ANY (ánodo común, pull-up R40 4,7 kΩ)  (despertador)
```

**Por qué hacen falta los diodos:** unir directamente las 9 salidas de colector
abierto daría un OR cableado perfecto, pero entonces las 9 entradas del 74HC165
verían todas la misma señal y se perdería la identidad del canal. Con los diodos,
cada salida conserva su nivel propio (el diodo bloquea la corriente entrante) y
sólo la que está baja arrastra el nodo común.

### 3.2 Verificación de niveles lógicos

```
V_IL(IRQ_ANY) = V_OL(LM339 a 1 mA) + V_f(BAT54 a 0,7 mA)
              = 0,20 V + 0,30 V = 0,50 V

V_IL_máx(ESP32-S3) = 0,25 × V_DD = 0,25 × 3,3 = 0,825 V

MARGEN = 0,825 − 0,50 = 0,325 V   ✔ CUMPLE
```

Corriente por el nodo cuando un canal está activo: 3,3 V / 4,7 kΩ ≈ **0,70 mA**,
más 3,3 V / 10 kΩ ≈ 0,33 mA del propio pull-up del canal. Total ≈ 1,0 mA por el
LM339, muy por debajo de sus 16 mA de capacidad de sumidero. **(V)** El V_OL real
del LM339 a 1 mA debe leerse de su hoja de datos (el valor de 0,20 V es
conservador pero no verificado).

### 3.3 Conexionado del registro de desplazamiento

| Red | ESP32-S3 | U40 | U41 |
|---|---|---|---|
| `SR_LOAD` | IO47 | SH/LD (pin 1) | SH/LD (pin 1) |
| `SR_CLK` | IO48 | CLK (pin 2) | CLK (pin 2) |
| `SR_DATA` | IO38 | — | QH (pin 9) |
| cadena | — | QH (pin 9) → **U41.SER (pin 10)** | — |
| — | — | SER (pin 10) → `GND_LOG` | — |
| — | — | CLK_INH (pin 15) → `GND_LOG` | CLK_INH (pin 15) → `GND_LOG` |

Entradas paralelas:

| U40 | Señal | U41 | Señal |
|---|---|---|---|
| A (pin 11) | `CMP_OUT1` | A (pin 11) | `CMP_OUT9` |
| B (pin 12) | `CMP_OUT2` | B–H | → `+3V3` (inactivo) |
| C (pin 13) | `CMP_OUT3` | | |
| D (pin 14) | `CMP_OUT4` | | |
| E (pin 3) | `CMP_OUT5` | | |
| F (pin 4) | `CMP_OUT6` | | |
| G (pin 5) | `CMP_OUT7` | | |
| H (pin 6) | `CMP_OUT8` | | |

**Secuencia de lectura (para WP-04):**

1. Flanco de bajada en `IRQ_ANY` → interrupción.
2. `SR_LOAD` a nivel bajo ≥ 100 ns → captura paralela.
3. `SR_LOAD` a nivel alto.
4. 16 pulsos de `SR_CLK`, leyendo `SR_DATA` en cada flanco. Se obtienen 16 bits;
   los 9 primeros son los canales, **activos a nivel bajo**.
5. Lectura de amplitudes por el ADC de la hoja 05.

**Presupuesto de tiempo (V):** los pasos 2–4 deben completarse muy por debajo de
la ventana de agrupación de 1–3 ms del dosier §9.6. A 1 MHz de `SR_CLK` son
16 µs. Debe medirse el tiempo real de servicio de la interrupción.

### 3.4 Limitación conocida y aceptada

Si **dos canales** se activan en el mismo instante, hay **una sola**
interrupción, pero el 74HC165 devuelve **ambos bits** en la misma lectura. Se
detectan los dos eventos; lo que se pierde es el orden temporal **dentro de la
ventana de lectura** (decenas de µs). El algoritmo del dosier §9.6 agrupa por
ventana de 1–3 ms y decide por **amplitud**, no por orden, así que la
funcionalidad especificada se conserva. **Debe confirmarlo WP-04.**

## 4. Generación del umbral `VREF_TH`

```
IO21 (PWM) ──[ R41 47 kΩ ]──┬── U42(+)  seguidor  ──→ VREF_TH → los 9 comparadores
                            │
                        [ C40 1 µF ]
                            │
                         GND_ANA
```

- τ = 47 kΩ × 1 µF = **47 ms**. Con una frecuencia de PWM de 10 kHz el rizado
  residual es despreciable frente a los 33 mV de histéresis.
- Rango: 0 V a 3,3 V con resolución de 8 bits ⇒ **12,9 mV por paso**, sobre un
  umbral nominal de 120,7 mV. Resolución del 10,7 % del umbral — **gruesa**.
  **(V)** Si en banco resulta insuficiente, usar PWM de 10 bits (3,2 mV/paso) o
  reducir el rango con un divisor a la salida del seguidor.
- El seguidor U42 es necesario porque los 9 divisores de entrada de los
  comparadores cargarían el filtro RC y desplazarían la tensión.

**Estado de arranque seguro:** mientras el firmware no configure el PWM, `IO21`
está en alta impedancia y C40 descargado ⇒ `VREF_TH` = 0 V ⇒ **todos los
comparadores disparados**. El firmware debe fijar `VREF_TH` **antes** de habilitar
la interrupción de `IRQ_ANY`. Requisito para WP-04, y una fuente de falsos
positivos si se olvida.

## 5. Distribución de alimentación en la hoja

| Riel | Consumidores |
|---|---|
| `+3V3A` | 3 × MCP6004 (9 seguidores + U42) ; clamps de los 9 canales |
| `+3V3` | 3 × LM339 ; 2 × 74HC165 ; los 9 pull-up `Rn7` ; R40 |
| `GND_ANA` | retornos de la cadena analógica de los 9 canales |
| `GND_LOG` | retornos de los 74HC165 y los pull-up |

Un condensador de 100 nF por cada CI, a menos de 3 mm de su pin de alimentación.

## 6. Puntos de prueba

| TP | Red | Criterio |
|---|---|---|
| TP40 | `IRQ_ANY` | Alto ≥ 3,0 V en reposo ; bajo ≤ 0,60 V con **cualquier** canal activo, y con los 9 a la vez |
| TP41 | `SR_LOAD` | Pulso bajo ≥ 100 ns |
| TP42 | `SR_CLK` | 16 pulsos por lectura |
| TP43 | `SR_DATA` | Trama coherente con el canal golpeado |
| TP44 | `VREF_TH` | Ajustable de 0 a 3,3 V ; rizado < 5 mV_pp |

## 7. Riesgos específicos de esta hoja

1. **Arranque con `VREF_TH` = 0 V** dispara los 9 canales (§4). Mitigación en
   firmware, no en hardware. Riesgo de que se olvide.
2. **Pérdida de eventos** si la rutina de interrupción tarda más que la duración
   del pulso del comparador. Mitigado por la decisión de la hoja 03 §5
   (comparador sobre la envolvente ⇒ pulso de milisegundos). **(V)**
3. **Nueve diodos de OR** = nueve puntos de fallo silencioso. Un diodo en abierto
   deja un canal que nunca genera interrupción pero que sí aparece en el 74HC165.
   **Se recomienda una autocomprobación de arranque** que verifique que el
   nivel de `IRQ_ANY` responde a cada canal.
4. **Ruido digital de los 74HC165 acoplado a la cadena analógica**: separar el
   bloque digital del analógico en el layout.
5. **Ninguna de estas cifras se ha medido.**
