# Fase 1 — Devkit + 2 módulos sensores piezo comerciales + WiFi

> **Estado: PROPUESTA PARA REVISIÓN.** Objetivo: validar la arquitectura de
> captura (interrupción agregada + identidad por 74HC165 + amplitud por ADC) y
> la pila completa de firmware (MQTT sobre WiFi, NVS, OTA, selector) **sin
> montar ningún circuito analógico**: la cadena comparador+envolvente la ponen
> módulos comerciales ya soldados.
>
> La cadena analógica discreta del diseño final NO se monta en esta fase: va
> directa a la PCB fabricada (fase 3), que se diseñará en KiCad a partir de las
> hojas de `hardware/electronics/schematics/` una vez medido lo de esta fase.
> El hallazgo **H-PIN-01** (polaridad del comparador) sigue vigente para esa
> PCB — ver anexo A.
>
> Placa: devkit ESP32-S3 N16R8 (o N8R2, mismo conexionado). Grabación y consola
> por USB nativo con `idf.py flash monitor`.

## 1. El módulo sensor a comprar

**"Piezoelectric shock/tap sensor module"** — placa azul de 20×20 mm con **disco
piezo cerámico sobre cable**, comparador (SOIC-8), potenciómetro de
sensibilidad y **4 patillas: G, V, AO, DO** (AliExpress/Amazon, 1–3 €).
**SELECCIONADO.** Comprar **3–4 unidades**.

- **AO**: señal analógica del piezo; a mayor golpe, mayor tensión.
- **DO**: salida del comparador, umbral ajustable por el potenciómetro.

### Dos desviaciones de la ficha del fabricante que condicionan el montaje

| # | Ficha del fabricante | Qué hacemos |
|---|---|---|
| **M-01** | *"Operating voltage: 5,0 V DC"* | **Alimentar a 3,3 V, no a 5 V.** El comparador opera desde ~2 V. A 5 V, `DO` y `AO` excederían el máximo absoluto del ESP32-S3 (V_DD+0,3 = 3,6 V) y **dañarían el GPIO/ADC**. **(V)** Confirmar que el módulo dispara con normalidad alimentado a 3,3 V; si no, alimentar a 5 V **con adaptación de nivel obligatoria** en `DO` y divisor en `AO`. |
| **M-02** | *"The TTL output valid signal is **high**"* | `DO` es **activo ALTO**, al contrario de lo que asume el diseño de la PCB (hoja 04: colector abierto activo BAJO). Consecuencias en fase 1: diodos del OR **invertidos** (ánodo en `DO`, cátodo al nodo común), `IRQ_ANY` con **pull-DOWN** en vez de pull-up, interrupción por **flanco de subida**, entradas no usadas del 74HC165 a **GND** (no a 3V3) y bits interpretados como **1 = disparado**. En firmware lo cubre `DIANA_PIEZO_ACTIVE_LOW=n`. |

> **Pendiente de medida — valor del pull-down de `IRQ_ANY`.** Con salidas de
> colector abierto activas en alto, el OR de diodos forma un divisor entre el
> pull-up interno del módulo (valor desconocido, típicamente 10 kΩ) y nuestro
> pull-down. Con 4,7 kΩ el nivel alto quedaría en ~0,75 V, **muy por debajo del
> V_IH del ESP32-S3 (0,75·3,3 = 2,48 V): no funcionaría.** Hace falta un
> pull-down alto (≈ 100 kΩ da ~2,7 V, aún ajustado). **Medir el pull-up real
> del módulo con el multímetro antes de cablear el OR** y recalcular. Si el
> margen resulta insuficiente, alternativa para la fase 1: llevar los 2 `DO` a
> 2 GPIO independientes (con 2 canales sobra) y validar la agregación más
> adelante con la electrónica definitiva, que sí es activa en bajo.

**Nota sobre `DO` y la envolvente:** este módulo compara sobre la señal cruda,
no sobre la envolvente, así que el pulso de `DO` puede durar menos de 1 ms
(la PCB final sí usa envolvente y da pulsos de ms). Medir su duración real en
B5: condiciona el margen de tiempo para leer el 74HC165.

### Módulo complementario: sensor piezo analógico "pelado"

**"Módulo sensor de vibración piezoeléctrica cerámica, salida analógica"**
(placa azul ~23×30 mm, borne de tornillo verde para el disco, 3 patillas S/+/−,
1–2 €). Lleva solo la resistencia de descarga de 1 MΩ (marcada `105`) y un
diodo de recorte: **no tiene comparador ni salida digital**.

**Se compra también**, porque cubre lo que el módulo LM393 no puede:

| Aporta | Limitación |
|---|---|
| Entrega la **onda cruda** del impacto → el ESP32 puede capturarla con ADC continuo y **caracterizar el material**: duración del pulso, amplitud por fuerza de golpe y **diafonía real entre dianas vecinas** | La detección es por software; no ejercita `IRQ_ANY` ni el 74HC165 |
| Esas medidas son las que hoy figuran como hipótesis **(H)** en el cálculo 02 (τ de envolvente, umbral, histéresis) y las que permiten **diseñar la PCB con datos reales** en vez de estimaciones | Sin comparador, el consumo de CPU por canal es mayor (irrelevante con 2 canales) |
| El borne de tornillo permite llevar el disco a la diana con cable y dejar la placa aparte — el montaje que exige el producto final | — |

**Protección obligatoria:** intercalar **R 1 kΩ en serie** entre la salida `S` y
el pin ADC del ESP32. El diodo de recorte de la placa puede estar dimensionado
para 5 V; la resistencia limita la corriente hacia los diodos internos de
protección del ESP32-S3 (3,3 V). **(V)** Verificar con el módulo en mano la
tensión de recorte real antes de conectar sin resistencia.

**Comprobar al comprar:** que el anuncio **incluya el disco piezo**; si no,
pedir aparte discos piezo de 27 mm con cable.

### Módulos descartados y por qué

| Módulo | Motivo del descarte |
|---|---|
| **KY-037 / KY-038** (micrófono electret) | Capta sonido por el **aire**: los 9 módulos oirían el mismo impacto con amplitud parecida. Destruye la discriminación por amplitud del §9.6, que es la base del rechazo de vibración cruzada. |
| **SW-420 / KY-002** (interruptor de vibración de muelle) | Es un contacto todo-o-nada: no da amplitud. Sin amplitud no hay §9.6. |
| **801S** | Aceptable como sustituto (LM393, AO+DO), pero su sonda responde distinto a un disco piezo plano y su acoplamiento a la superficie es peor. Solo si no se encuentra el de disco. |

**Alimentarlos a 3,3 V** (funcionan de 3,3 a 5 V). Nunca a 5 V: DO saldría a
5 V y dañaría el GPIO del ESP32.

Diferencias con la cadena final (aceptadas para esta fase):

| Cadena final (PCB) | Módulo comercial |
|---|---|
| Comparador sobre la **envolvente** (pulso de ms) | Comparador sobre la señal cruda: DO puede durar < 1 ms |
| Umbral común por PWM, ajustable por firmware | Umbral por potenciómetro, a mano |
| Amplitud = pico de la envolvente (medida fiable) | AO es la señal cruda: la amplitud leída tras la IRQ es aproximada |

La segunda y tercera fila implican que en esta fase la comparación de
amplitudes del §9.6 (vibración cruzada) se prueba **funcionalmente**, no con
precisión de calibración. Es suficiente para desarrollar todo el firmware.

## 2. Material completo de la fase 1

| Componente | Cant. | Nota |
|---|---:|---|
| Devkit ESP32-S3 N16R8/N8R2 | 1 | ya disponible |
| **Módulo piezo shock/tap (G/V/AO/DO)** | 3–4 | §1 — **SELECCIONADO**. Trae el disco con cable. Alimentar a **3,3 V** (M-01) |
| Módulo piezo analógico "pelado" (S/+/−) | 3–4 | §1 — opcional pero recomendado: caracteriza el impacto; **+ R 1 kΩ en serie por canal** |
| 74HC165 (DIP-16) | 1 | identidad de canal |
| Diodo 1N4148 o BAT85 | 2–3 | OR hacia IRQ_ANY (1 por módulo) |
| R 4,7 kΩ | 1 | pull-up de IRQ_ANY |
| R 10 kΩ | 2–3 | pull-up de DO si el módulo no lo trae (la mayoría sí) |
| C 100 nF | 1 | desacoplo del 74HC165 |
| Interruptor 3 posiciones (ON-OFF-ON) | 1 | selector de función |
| Pulsador | 1 | botón identificar |
| LED 3/5 mm (verde + ámbar) + R 330 Ω ×2 | 2 | estado |
| Protoboard + cables dupont | — | — |
| *(pendiente de llegar)* módulo W5500 con RJ45 | 1 | fase 2 |

Sin op-amps, sin comparadores sueltos, sin resistencias de precisión: todo eso
ya viene dentro del módulo.

## 3. Conexionado

Cableado **para `DO` activo en alto** (M-02). El valor de `R_pd` queda
**pendiente de medir** el pull-up interno del módulo (ver §1).

```
                    3V3 ──┬── V módulo 1 ── V módulo 2 ── VCC 74HC165
                          │      (3,3 V, NO 5 V — M-01)
MÓDULO 1:  AO ────────────────────────→ IO1  (ADC1_CH0, amplitud canal 1)
           DO ──┬─────────────────────→ pin 11 (D0) del 74HC165
                └──▶| 1N4148 ────┐       (ánodo en DO, cátodo al nodo común)
MÓDULO 2:  AO ────────────────────│───→ IO2  (ADC1_CH1, amplitud canal 2)
           DO ──┬─────────────────│───→ pin 12 (D1) del 74HC165
                └──▶| 1N4148 ────┤
                                 │
                IRQ_ANY ─────────┴── R_pd (≈100 kΩ, A MEDIR) ── GND
                    │
                    └───────────────→ IO7  (interrupción, flanco de SUBIDA)
```

| Pin 74HC165 | Señal | Conexión |
|---:|---|---|
| 1 (/PL) | `SR_LOAD` | IO47 |
| 2 (CP) | `SR_CLK` | IO48 |
| 15 (/CE) | — | GND |
| 11 (D0) | canal 1 | DO del módulo 1 |
| 12 (D1) | canal 2 | DO del módulo 2 |
| 13, 14, 3–6 (D2–D7) | — | **a GND** (activo-alto: canal ausente = "0" = reposo) |
| 9 (QH) | `SR_DATA` | IO38 |
| 10 (DS) | cascada | GND |
| 16 / 8 | VCC / GND | 3V3 / GND + 100 nF |

El firmware interpreta **1 = canal disparado** en esta fase
(`DIANA_PIEZO_ACTIVE_LOW=n`); la PCB definitiva será al revés.

Resto de pines del devkit, igual que el [pinout definitivo](pinout-definitivo.md):

| GPIO | Señal | Conexión |
|---:|---|---|
| IO15 / IO16 | `SEL_A` / `SEL_B` | interruptor 3 posiciones, común a GND |
| IO17 | `BTN_ID` | pulsador a GND |
| IO18 / IO39 | `ST_LED_G` / `ST_LED_A` | LED + 330 Ω a GND |
| IO4–IO6, IO8–IO14, IO21 | **sin conectar** | reservados (LED filas, W5500, ADC, VREF) |
| IO0, IO3, IO19/20, IO35–37, IO43–46 | **no tocar** | strapping / USB / PSRAM / UART0 |

> IO21 (`VREF_TH_PWM`) no se usa en esta fase: el umbral lo pone el
> potenciómetro de cada módulo. Se estrena en la PCB.
>
> **Aviso devkit:** según revisión, el WS2812 de placa cuelga de IO38 o IO48;
> su entrada es de alta impedancia y no molesta, como mucho parpadea. Verificar.

## 4. Qué valida esta fase

| Se valida | Queda para después |
|---|---|
| IRQ agregada por OR de diodos + identidad por 74HC165 (la arquitectura real) | Cadena analógica discreta (PCB, fase 3) |
| Firmware completo: FSMs, MQTT sobre WiFi, NVS, OTA, cola, selector, botón | Ethernet W5500 (fase 2, al llegar el módulo) |
| Ventana de agrupación 1–3 ms y flujo del §9.6 (funcional) | Calibración real de umbrales y amplitudes |
| Tiempo flanco→lectura de bits (medida clave para WP-06) | Umbral por PWM (D-15), LED WS2812 de dianas |

## 5. Plan de puesta en marcha (con `idf.py`)

1. **B1 — arranque en seco** (sin sensores): `idf.py set-target esp32s3`,
   transporte WiFi por Kconfig, consola USB, NVS, MQTT al broker, selector,
   botón, LEDs de estado.
2. **B2 — polaridad y umbral:** conectar los módulos, verificar con multímetro
   el nivel de DO en reposo, ajustar potenciómetros hasta que un golpe firme
   dispare y el ruido ambiente no.
3. **B3 — un canal:** golpe → IRQ_ANY cae → 74HC165 identifica canal 1 → ADC
   lee AO → evento MQTT publicado con amplitud.
4. **B4 — dos canales:** golpes alternados y simultáneos; ventana de
   agrupación y decisión del §9.6.
5. **B5 — medidas para WP-06:** tiempo flanco→bits leídos (debe ser ≪ 1 ms),
   duración real del pulso DO de estos módulos, nivel bajo de IRQ_ANY.
6. **B6 — caracterización con los módulos analógicos** (la medida que más vale
   para la PCB): ADC continuo con DMA sobre 2 discos pegados a una placa de
   ensayo, capturando la onda cruda. Obtener: duración y forma del pulso,
   amplitud frente a fuerza del golpe, y **atenuación hacia el canal vecino**
   (la cifra que hoy no existe y de la que depende todo el §9.6). Volcar los
   resultados a `hardware/electronics/calculations/02-cadena-piezo.md`
   sustituyendo las hipótesis **(H)** por medidas.

---

## Anexo A — Cadena analógica discreta (referencia para la PCB, fase 3)

No se monta en fase 1. Es el diseño de las hojas 03/04 con el hallazgo
**H-PIN-01** aplicado:

> **⚠ H-PIN-01 — polaridad del comparador.** El cálculo 02 §6 define un Schmitt
> **no inversor** (envolvente en in+), cuya salida queda **ALTA** al disparar.
> La hoja 04, D-03 y TP40 exigen salida **activa a nivel BAJO** (necesaria para
> el OR de diodos, V_OL+V_f = 0,50 V). Se contradicen. La PCB debe usar la
> configuración **INVERSORA**: envolvente en in−, red de histéresis
> (R_in 10 kΩ a VREF_TH bufferizado + R_fb 1 MΩ a la salida) en in+. Umbrales
> resultantes con V_REF = 119,5 mV: subida ≈ 151 mV, bajada ≈ 120 mV
> (histéresis ≈ 31 mV); se compensa ajustando V_REF por PWM.
> **Pendiente: corregir el cálculo 02 §6 en WP-06.**

```
PIEZO ──┬── R_bleed 1 MΩ ── GND_A
        ├── 2×33 kΩ serie ──┬── BAT54S (clamp a 3V3/GND)
        │                   └── seguidor MCP6004 ── 100 Ω ── BAT54 ▶│──┐
        │                                                              │
        │                nodo ENVn: ── 47 nF ── GND_A ── 220 kΩ ── GND_A
        │                     ├──→ ADC (amplitud)
        │                     └──→ LM339 in− ; in+ = R_in 10k→VREF + R_fb 1M→out
        │                          out (act. bajo) ── R_pu 10k ── 3V3
        │                              ├──→ 74HC165
        │                              └──|◀ BAT54 ── IRQ_ANY (pull-up 4,7 kΩ)
```

VREF_TH: IO21 PWM (LEDC, τ_RC = 47 kΩ×1 µF = 47 ms) → seguidor MCP6004 → R_in
de cada canal. **El firmware debe fijar el umbral y esperar ≥ 235 ms antes de
habilitar IRQ_ANY (D-15).**
