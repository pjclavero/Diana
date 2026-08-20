# Hoja 03 — Canal piezoeléctrico (hoja reutilizable, 9 instancias)

> ## ⚠ NO UTILIZADO EN PROTOTIPO V1 — hoja completa (front-end MCP6004 + LM339 + `VREF_TH`)
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

> **SIN VALIDAR.** ERC no ejecutado. Ningún umbral está calibrado: los valores
> son **iniciales** y configurables (dosier §9.3 y prohibición explícita del
> WP-04). Dosier §9.2, §9.3, §9.4, §9.5, §28.3.
>
> **Esta es la hoja de mayor riesgo del proyecto.** El dosier §34 registra «Piezo
> daña el ESP32 → Avería» y exige «protección y pruebas de sobretensión».
> El dimensionado está en [`../calculations/02-cadena-piezo.md`](../calculations/02-cadena-piezo.md).

Esta hoja se instancia **9 veces** desde la hoja 04, con `n` = 1..9. Las
referencias llevan el número de canal: `R101` es la R1 del canal 1, `R901` la del
canal 9.

## 1. Arquitectura del canal

```
 PZn (piezo)
   │
   ├──[ Rn1  1 MΩ ]── GND_ANA          descarga / paso alto 7,96 Hz
   │
   └──[ Rn2a 33 kΩ ]──[ Rn2b 33 kΩ ]──┬── CLMPn
                                       │
                                       ├── Dn1 (BAT54S): clamp a +3V3A y a GND_ANA
                                       ├──[ Rn3 1 MΩ ]── GND_ANA
                                       │
                                       └── Un_A (MCP6004, seguidor)
                                             │
                                             └──[ Dn2 BAT54 ]── ENVn
                                                                 │
                                                    ┌────────────┼────────────┐
                                              [Cn1 47 nF]  [Rn4 220 kΩ]   ├── ENV_OUTn → hoja 05
                                                    │            │        │
                                                 GND_ANA      GND_ANA     └──[ Rn5 10 kΩ ]── Un_C(+)
                                                                                    │
                                                                    Un_C = LM339, colector abierto
                                                                    (−) ← VREF_TH
                                                                    realimentación [Rn6 1 MΩ] salida→(+)
                                                                             │
                                                                     CMP_OUTn ──[ Rn7 10 kΩ ]── +3V3
                                                                             └──→ hoja 04
```

## 2. Componentes por canal

| Ref. | Valor | Encapsulado | Función | Nota |
|---|---|---|---|---|
| `PZn` | Disco piezoeléctrico ⌀27–35 mm, C_p ≈ 20 nF **(H)** | Externo, cable apantallado | Transductor de impacto | Pegado a la cara posterior del disco de la diana (dosier §7.2) |
| `Rn1` | **1 MΩ** 1 % | 0805 | Resistencia de descarga en paralelo con el piezo | τ = 20,0 ms ; f_c = 7,96 Hz |
| `Rn2a` | **33 kΩ** 1 % | **0805** | Serie limitadora (mitad 1) | **0805 por tensión: 150 V. Un 0603 (50 V) NO sirve** |
| `Rn2b` | **33 kΩ** 1 % | **0805** | Serie limitadora (mitad 2) | Total 66 kΩ, dentro del rango 47–100 kΩ del dosier |
| `Dn1` | **BAT54S** (dos Schottky en serie, nodo común accesible) | SOT-23 | Clamp positivo y negativo | I_clamp máx. calculada 2,15 mA a 150 V |
| `Rn3` | 1 MΩ 1 % | 0603 | Descarga del nodo recortado, define el reposo a 0 V | |
| `Un_A` | ¼ de **MCP6004** (rail-to-rail, alimentado a 3,3 V) | SOIC-14 (3 CI para 9 canales + 3 libres) | **Seguidor de tensión** | **Imprescindible**: sin él τ_ataque = 3,20 ms y el detector no alcanza el pico |
| `Dn2` | **BAT54** (Schottky simple) | SOT-23 | Rectificador de la envolvente | V_f baja |
| `Cn1` | **47 nF** X7R 50 V | 0603 | Condensador de envolvente | τ = 10,34 ms |
| `Rn4` | **220 kΩ** 1 % | 0603 | Descarga de la envolvente | Caída durante barrido de 9 canales: 4,26 % |
| `Rn5` | 10 kΩ 1 % | 0603 | Entrada del comparador | Fija la histéresis con Rn6 |
| `Un_C` | ¼ de **LM339** (colector abierto) | SOIC-14 (3 CI para 9 canales + 3 libres) | Comparador | Colector abierto: imprescindible para el OR de la hoja 04 |
| `Rn6` | 1 MΩ 1 % | 0603 | Realimentación positiva | Histéresis = **33,0 mV** |
| `Rn7` | 10 kΩ | 0603 | Pull-up de la salida del comparador a `+3V3` | |
| `Cn2` | 1 nF | 0603 | Filtro en la entrada (−) del comparador, junto a `VREF_TH` | |
| `TP_PZn` | Pin de prueba | THT | Señal cruda tras Rn1 | |
| `TP_CLMPn` | Pin de prueba | THT | Señal recortada | **El punto de prueba más importante del proyecto** |
| `TP_ENVn` | Pin de prueba | THT | Envolvente | |
| `TP_CMPn` | Pin de prueba | THT | Salida digital | |

Recuento de circuitos integrados para los 9 canales: **3 × MCP6004** (12
secciones, 9 usadas) y **3 × LM339** (12 secciones, 9 usadas). Las secciones
sobrantes se conectan como seguidores con la entrada a masa (MCP6004) o con las
entradas atadas a rieles (LM339) — nunca al aire.

## 3. Conexionado nodo a nodo (canal `n`)

| Nodo | Conexiones |
|---|---|
| `PZn_P` | J2n.pin (hoja 08) ; `Rn1`.1 ; `Rn2a`.1 |
| `PZn_N` | J2n.pin ; `GND_ANA` (masa del apantallamiento del cable) |
| — | `Rn1`.2 → `GND_ANA` |
| `PZn_MID` | `Rn2a`.2 → `Rn2b`.1 |
| `CLMPn` | `Rn2b`.2 ; `Dn1`.ánodo-superior ; `Dn1`.cátodo-inferior ; `Rn3`.1 ; `Un_A`.entrada+ |
| — | `Dn1`.cátodo-superior → `+3V3A` ; `Dn1`.ánodo-inferior → `GND_ANA` |
| — | `Rn3`.2 → `GND_ANA` |
| — | `Un_A`.salida → `Un_A`.entrada− (realimentación de seguidor) ; `Dn2`.ánodo |
| `ENVn` | `Dn2`.cátodo ; `Cn1`.1 ; `Rn4`.1 ; `Rn5`.1 ; `TP_ENVn` |
| — | `Cn1`.2 → `GND_ANA` ; `Rn4`.2 → `GND_ANA` |
| `CMPn_IN` | `Rn5`.2 ; `Un_C`.entrada+ ; `Rn6`.1 |
| `VREF_TH` | `Un_C`.entrada− ; `Cn2`.1 (común a los 9 canales) |
| — | `Cn2`.2 → `GND_ANA` |
| `CMP_OUTn` | `Un_C`.salida ; `Rn6`.2 ; `Rn7`.1 ; `TP_CMPn` ; → hoja 04 |
| — | `Rn7`.2 → `+3V3` |
| `+3V3A` | `Un_A`.V+ (por CI), `Dn1`.cátodo-superior |
| `+3V3` | `Un_C`.V+ (por CI), `Rn7`.2 |

**Nota sobre las alimentaciones cruzadas:** el seguidor se alimenta de `+3V3A`
(limpio) y el comparador de `+3V3` (digital), porque el comparador conmuta y
generaría ruido en el riel analógico. El clamp se referencia a `+3V3A` porque es
lo que fija el nivel máximo que ve el silicio.

## 4. Comportamiento esperado (calculado, **no medido**)

| Magnitud | Valor calculado | Condición |
|---|---:|---|
| Tensión máxima en `CLMPn` | **+3,65 V** | pico de piezo 150 V |
| Tensión mínima en `CLMPn` | **−0,35 V** | excursión negativa |
| Corriente máxima por el clamp | **2,15 mA** | pico de piezo 150 V |
| Energía por pulso en `Rn2a`+`Rn2b` | **0,158 mJ** | pulso de 0,5 ms |
| Potencia media a 5 impactos/s | **0,79 mW** | |
| τ de ataque de la envolvente | **4,70 µs** | con el seguidor |
| τ de caída de la envolvente | **10,34 ms** | dentro del rango 2–10 ms del dosier §9.3 |
| Umbral de subida | **120,7 mV** | con V_REF = 119,5 mV |
| Umbral de bajada | **87,7 mV** | |
| Histéresis | **33,0 mV** (27,3 %) | |
| Latencia de detección | ≈ 10–30 µs **(H)** | frente a ventana de agrupación de 1–3 ms |

## 5. Decisión de diseño: el comparador mira la envolvente

El diagrama del dosier §9.2 sugiere dos ramas paralelas desde el nodo protegido:
digital (comparador) y analógica (envolvente). **Aquí se conectan en cascada:**
la envolvente alimenta también al comparador.

| | Comparador sobre señal cruda | Comparador sobre envolvente **(adoptado)** |
|---|---|---|
| Latencia | ~1 µs | 10–30 µs |
| Duración del pulso de salida | puede ser < 50 µs | milisegundos |
| ¿Hacen falta 9 biestables? | **Sí** | No |
| Recuento múltiple por resonancia | alto | bajo |

Justificación completa y contrapartidas en el cálculo 02 §7. La contrapartida
aceptada es que dos impactos separados por menos de ~10 ms en el **mismo** canal
se cuentan como uno; el dosier §9.6 ya impone bloqueo de 30–100 ms tras impacto
válido, así que no se pierde nada exigido.

**Esta decisión se aparta de la lectura literal del dosier y debe ser aprobada
por el supervisor.**

## 6. Ajuste del umbral

`VREF_TH` es **común a los 9 canales** y se genera en la hoja 04 desde `IO21`
(PWM del ESP32-S3) filtrado por RC. El dosier §9.3 pide umbral «ajustable por
banco o por canal»: esta implementación cubre «por banco» (todo el módulo).

El ajuste **por canal** se hace en firmware, comparando la amplitud leída por el
ADC contra el umbral individual guardado en NVS (dosier §9.7). Es decir: el
umbral hardware es un suelo común de ruido, y la decisión fina es de software.
**(V)** Debe confirmarse con WP-04 que este reparto es aceptable.

## 7. Puntos de prueba por canal

| TP | Nodo | Qué se comprueba | Criterio |
|---|---|---|---|
| `TP_PZn` | Piezo tras Rn1 | Amplitud cruda del impacto | **Sonda 10:1 obligatoria.** Registrar el pico real |
| `TP_CLMPn` | Nodo recortado | **Que la protección protege** | **Nunca > +3,7 V ni < −0,4 V, con el impacto más fuerte** |
| `TP_ENVn` | Envolvente | Ataque y caída | τ_caída = 10,3 ms ±20 % ; sube en < 50 µs |
| `TP_CMPn` | Salida digital | Umbral e histéresis | Subida 120,7 mV ±15 % ; histéresis 33 mV ±30 % |

## 8. Riesgos específicos de esta hoja

1. **La hipótesis de 150 V de pico no está medida.** Si un disco real produce
   400 V, la corriente de clamp sube a 5,8 mA (aún segura) pero las resistencias
   serie ven 400 V y las de 0805 (150 V) fallan. **(V) crítico.**
2. **La capacidad real del piezo** desplaza τ_bleed y f_c.
3. **El pegado del piezo** determina la amplitud tanto o más que la electrónica.
   Fuera del alcance de esta hoja, dentro de `hardware/mechanical/`.
4. **Nueve canales × 4 componentes de precisión** = dispersión entre canales. La
   calibración del dosier §9.7 es obligatoria, no opcional.
5. **Acoplamiento entre canales por la PCB o el cableado.** El apantallamiento
   individual de cada cable de piezo es un requisito, no un lujo.
6. **Ninguna de estas cifras se ha medido.**
