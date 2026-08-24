# Riesgos del hardware — WP-06

Severidad: **A** = puede destruir hardware o invalidar la arquitectura ·
**M** = degrada funcionalidad · **B** = molestia.

Estado: **ABIERTO** (sin mitigación verificada) · **MITIGADO EN DISEÑO** (la
mitigación existe en el esquema pero **no se ha comprobado**) · **CERRADO**
(verificado — **hoy no hay ninguno**).

---

## Riesgos heredados del dosier §34

| Riesgo del dosier | Sev. | Mitigación en este diseño | Estado |
|---|:---:|---|---|
| Vibración cruzada → impactos falsos | **A** | Silentblocks f_n 30 Hz (−60,9 dB), envolvente por canal para comparar amplitudes, cable apantallado individual | **ABIERTO** — depende de G5 |
| **Piezo daña el ESP32** | **A** | R serie 2×33 kΩ/0805 + BAT54S; I_clamp calculada 2,15 mA a 150 V | **MITIGADO EN DISEÑO** — validaciones D4 y D5 |
| Fallo de LED corta cadena | M | 3 cadenas independientes por fila + PTC por fila | MITIGADO EN DISEÑO |
| Caída de tensión → reinicios | **A** | 2 000 µF (ESR ≤ 26,2 mΩ), separación topológica de rieles, inyección doble | **MITIGADO EN DISEÑO** — validación B4 |
| Dos principales | M | Selector con estado (0,0) = fallo ⇒ entra en SATÉLITE | MITIGADO EN DISEÑO |
| Sobreconsumo LED → reset o calor | **A** | Convertidor de 6 A (81 % de carga), tope de brillo obligatorio, supervisión de `VSENSE_5V` | **MITIGADO EN DISEÑO** — validación C1 |
| **Escasez de GPIO → rediseño** | **A** | **MATERIALIZADO.** Ver R-01 | **ABIERTO** |
| Fuente no segura | **A** | Fuente externa certificada obligatoria (dosier §11.3) | MITIGADO EN DISEÑO |

---

## Riesgos nuevos identificados en el WP-06

### R-01 · El presupuesto de GPIO del dosier §8.4 no cuadra — **A — ABIERTO**

El riesgo «Escasez de GPIO» del dosier §34 **ya se ha materializado en la fase de
diseño**, que es el mejor momento posible.

```
Disponibles con criterio conservador: 25
Topología literal del dosier §8.4:    29 sin reserva / 34 con reserva
DÉFICIT: 4 a 9 pines
```

**Mitigación:** topología B (cálculo 03 §3) — 21 usados, 4 de reserva. **Coste:**
2 CI y 9 diodos más, y dos decisiones que se apartan del dosier (D-01, D-03).

**Riesgo residual:** de los 4 pines de reserva, **sólo 1 es de uso libre**; los
otros 3 son de JTAG. Si el proyecto exige depuración por JTAG, la reserva
efectiva cae a 1 e incumple el mínimo de 3 del dosier §8.4. Existe la variante B′
(renunciar al USB nativo), que devuelve 2 pines libres y el JTAG completo.

---

### R-02 · La hipótesis de 150 V del piezo no está medida — **A — ABIERTO**

**Toda la protección del ESP32-S3 se apoya en esta hipótesis.** Si un disco real
produce 400 V:

- La corriente de clamp sube a 5,8 mA — **sigue siendo segura**.
- Las resistencias serie de 0805 (150 V cada una, 300 V en serie) **fallan**.
- Al fallar, pueden hacerlo en cortocircuito, y entonces llega tensión plena al
  clamp y potencialmente al microcontrolador.

**Mitigación:** validación D1 (medir el pico real) y D5 (ensayo destructivo sobre
placa sacrificable) **antes** de conectar ningún ESP32-S3.

---

### R-03 · La térmica del convertidor no cierra si η < 0,93 — **A — ABIERTO**

```
η = 0,90 y θ_JA = 36 °C/W  →  Tj = 137 °C  ✘ EXCEDE los 125 °C
η = 0,93 y θ_JA = 36 °C/W  →  Tj = 106 °C  ✔
```

El margen depende de un dato que **no se ha verificado**: el rendimiento real a
12 V de entrada y 4,87 A de salida (los fabricantes publican la curva más
favorable, que rara vez es ésa).

**Mitigación:** validación B3 y C1; requisito de ≥ 2 pulgadas² de cobre con
matriz de vías térmicas; tope de brillo al 60 % como punto de trabajo normal.

---

### R-04 · Pines de arranque mal conectados — **A — MITIGADO EN DISEÑO**

Un error en `IO0`, `EN`, `IO45`, `IO46` o `IO35`–`IO37` produce **una placa que no
arranca y que no se puede depurar fácilmente**. Es la causa más frecuente de
fracaso de una primera tirada.

**Mitigación:** hoja 02 §4 con tabla explícita; `R31` de pull-down expreso en
`IO45`; validación E1 (contraste contra la hoja de datos de la revisión exacta) y
E3. **Es el punto que más se beneficia de una revisión humana antes de fabricar.**

---

### R-05 · `VREF_TH` = 0 V al arrancar dispara los 9 canales — **M — ABIERTO**

Mientras el firmware no configure el PWM, `IO21` está en alta impedancia y el
condensador de filtro descargado ⇒ umbral cero ⇒ **los 9 comparadores activos**.

**Mitigación:** requisito para WP-04 — fijar `VREF_TH` **antes** de habilitar la
interrupción de `IRQ_ANY`. **La mitigación está en software, no en hardware, y
puede olvidarse.** Alternativa hardware a considerar: pull-up de 1 MΩ en el nodo
filtrado que fije un umbral alto por defecto.

---

### R-06 · Bus SPI compartido entre W5500 y ADC — **M — ABIERTO**

Una transacción Ethernet larga puede retrasar la lectura de amplitudes tras un
impacto. También: si alguno de los dos esclavos no libera MISO correctamente, se
bloquea la comunicación.

**Mitigación:** validaciones E4, E5 y E7. Presupuesto: latencia total < 200 µs
frente a la ventana de 1–3 ms del dosier §9.6.

---

### R-07 · Nueve diodos de OR = nueve fallos silenciosos — **M — ABIERTO**

Un diodo abierto deja un canal que **nunca genera interrupción** pero que sí
aparece en el 74HC165 — es decir, un canal que sólo se detecta si otro canal
dispara al mismo tiempo. Fallo silencioso y difícil de diagnosticar.

**Mitigación propuesta:** autocomprobación de arranque que verifique que
`IRQ_ANY` responde a cada canal individualmente. Requiere una forma de excitar
cada comparador desde firmware — **no está resuelta en el hardware actual**.

---

### R-08 · Saturación del ADC por referencia de 2,5 V — **M — MITIGADO EN DISEÑO**

La envolvente llega a 3,65 V; la referencia interna del ADS7953 es de 2,5 V.
Sin divisor, cualquier impacto fuerte se lee saturado y **se pierde justo la
información de amplitud que necesita el algoritmo de vibración cruzada**.

**Mitigación:** divisor 2:1 en cada entrada (D-05). No verificado.

---

### R-09 · Diferencia entre `+5V_LOG` y `+5V_LED` degrada el margen de datos — **M — ABIERTO**

El 74AHCT125 se alimenta del riel de lógica (D-10), pero el V_IH del primer LED
se referencia a **su** V_DD (el de LED). Si los rieles divergen más de 0,3 V, el
margen se degrada.

**Mitigación:** validación B4 y D6 (medir ambos rieles simultáneamente en el
transitorio negro → blanco).

---

### R-10 · J30 con adaptador de 5 V destruye el ESP32-S3 — **A — ABIERTO**

La única barrera actual es mecánica (conector polarizado, retranqueado) y
serigráfica (`SERVICE — 3V3 ONLY`).

**Mitigación propuesta y no incorporada:** resistencias serie de 100 Ω en los
pines 3, 4, 5 y 6 de J30. **Se recomienda añadirlas antes de fabricar.**

---

### R-11 · Correspondencia canal ↔ posición física no fijada — **A — ABIERTO**

No existe ADR que fije qué canal físico corresponde a qué posición del módulo, ni
el orden de direccionamiento de los 216 LED del montaje real (`9 x 24`).

**Un error aquí es completamente silencioso y falsea toda la puntuación del
juego.** No hay ninguna comprobación automática que lo detecte.

**Mitigación:** ADR conjunto WP-06 / WP-04 / WP-02 antes de fabricar, y
verificación explícita en la fase F8 y D1 del protocolo de banco.

---

### R-12 · Q1 en cortocircuito deja de proteger sin aviso — **B — ABIERTO**

No hay indicación de que la protección de polaridad esté sana. Si el PMOS falla
en cortocircuito, todo sigue funcionando **hasta que alguien invierta la
polaridad**, momento en el que se destruye la placa.

**Mitigación posible no incorporada:** el ADC podría leer la tensión en ambos
lados de Q1 y comparar; un canal libre lo permitiría.

---

### R-13 · Inrush de los 2 000 µF sobre una fuente al 75 % de carga — **M — MITIGADO EN DISEÑO**

**Mitigación:** NTC limitadora + soft-start de U1 ≥ 5 ms. Validación C9 y B7.

---

### R-14 · Acoplamiento eléctrico entre cables de piezo — **A — MITIGADO EN DISEÑO**

Un acoplamiento capacitivo de 10 pF entre dos cables sin apantallar, con señales
de 150 V, produce en el vecino una señal **indistinguible de un impacto real**.
Ningún algoritmo de software puede separarlas después.

**Mitigación:** apantallamiento individual obligatorio (BOM ítem 50, crítico).
Validación G7 (medir con y sin apantallamiento para separar el acoplamiento
eléctrico del mecánico).

---

### R-15 · La cadena piezo depende más del pegado que de la electrónica — **A — ABIERTO**

La amplitud de la señal la determina cómo esté pegado el piezo al disco, no la
hoja 03. Un adhesivo elástico o una capa gruesa amortiguan la onda.

**Mitigación:** ensayo de adhesivo (`policarbonato-ensayos.md` §6) y
compatibilidad química con el policarbonato (algunos disolventes producen
*crazing*).

---

## Resumen

| Severidad | ABIERTO | MITIGADO EN DISEÑO | CERRADO |
|---|---:|---:|---:|
| **A (alta)** | 7 | 4 | **0** |
| **M (media)** | 5 | 3 | **0** |
| **B (baja)** | 1 | 0 | **0** |

**Ningún riesgo está cerrado, porque cerrar un riesgo requiere una medida y no se
ha medido nada.** Los tres que deciden la viabilidad del proyecto:

1. **R-02** — si el piezo entrega mucho más de 150 V, hay que rehacer la
   protección antes de conectar ningún microcontrolador.
2. **Vibración cruzada (dosier §34) / validación G5** — si el acoplamiento entre
   dianas supera 0,50, el problema no se arregla con electrónica ni con software.
3. **R-01 / R-03** — GPIO y térmica: ambos cierran, pero con márgenes estrechos
   que dependen de datos no verificados.
