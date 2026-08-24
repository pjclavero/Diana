# Notas de diseño — WP-06 · Diseño electrónico del módulo 3×3

> **AVISO PROTOTIPO DO-ONLY:** la cadena analogica descrita aqui queda como
> futura PCB. Para el montaje fisico actual usar
> `docs/hardware/prototipo-do-only.md` y
> `docs/hardware/conexionado-prototipo.md`. AO, ADC de impacto, ADS7953,
> MCP3208, MCP6004 externo, LM339 externo y `VREF_TH` son **NO UTILIZADO EN EL
> PROTOTIPO DO-ONLY**.
>
> **AVISO LED 2026-08-20:** el banco real usa aros de 24 LED por diana
> (`9 x 24 = 216 LED`). Las cifras antiguas de 72 LED / 4,32 A de este
> documento pertenecen a una hipotesis previa y no dimensionan el consumo maximo
> del montaje actual.

> **ESTADO: DISEÑO DOCUMENTADO. VALIDACIÓN PENDIENTE.**
>
> No hay KiCad en el entorno de trabajo, no hay hardware, no hay instrumentación.
> **No se ha ejecutado ERC ni DRC. Nada se ha construido ni medido.** Estos
> documentos **no autorizan la fabricación de ninguna PCB**.

## Índice de lo entregado

| Documento | Contenido |
|---|---|
| [`VALIDACION-FISICA-PENDIENTE.md`](VALIDACION-FISICA-PENDIENTE.md) | **Las 47 validaciones pendientes.** El documento más importante |
| [`decisiones.md`](decisiones.md) | 17 decisiones de diseño con su motivo y lo que se pierde |
| [`riesgos.md`](riesgos.md) | 15 riesgos, ninguno cerrado |
| `../../hardware/electronics/schematics/` | Las 8 hojas del dosier §28, nodo a nodo |
| `../../hardware/electronics/calculations/` | 4 cálculos con las operaciones a la vista |
| `../../hardware/electronics/kicad/` | Proyecto y jerarquía KiCad + netlist en CSV |
| `../../hardware/electronics/bom/` | BOM de 58 líneas con alternativas, sin precios |
| `../../hardware/electronics/test-fixtures/` | Protocolo de banco de 7 fases |
| `../../hardware/mechanical/` | Materiales, aislamiento y protocolo de impacto |

---

## 1. Arquitectura resultante

```
Fuente externa 12 V / 3 A certificada
   │
   ▼  J1 → SW1 → NTC1 → F1(T3,15A) → Q1(PMOS) → D1(TVS) → filtro
   │
   ├── U1  buck 12→5 V, 6 A ──┬── +5V_LED ──→ 3 filas de 24 LED (4,32 A)
   │                          └── +5V_LOG ──┬── 74AHCT125 (nivel 3,3→5 V)
   │                                        └── U2 buck 5→3,3 V ──┬── +3V3  (digital)
   │                                                              └── FB1 → +3V3A (analógico)
   └── divisores → VSENSE_12V, VSENSE_5V

9 × piezo → R1 1M ∥ → 2×33k serie → BAT54S clamp → seguidor MCP6004
                                                       │
                                          BAT54 → 47nF/220k (τ = 10,3 ms)
                                                       ├──→ ADC SPI ADS7953 (amplitud)
                                                       └──→ LM339 (colector abierto)
                                                                 ├──→ 2×74HC165 (identidad)
                                                                 └──→ 9 diodos → IRQ_ANY (1 GPIO)

ESP32-S3 ── SPI 20 MHz ──┬── W5500 → RJ45 con magnetismos + TVS
                         └── ADS7953
```

## 2. Los cuatro números que hay que recordar

| Magnitud | Valor | Consecuencia |
|---|---:|---|
| Corriente total en blanco máximo | **4,870 A** | Convertidor de 6 A (81,2 % de carga) |
| Constante de la envolvente | **10,34 ms** | Dentro del rango 2–10 ms del dosier §9.3 |
| Histéresis del comparador | **33,0 mV** sobre 120,7 mV | Evita recuento múltiple por resonancia |
| **GPIO: 21 usados / 25 disponibles** | **4 de reserva** | Sólo cierra con la topología B |

## 3. Los tres hallazgos que cambian el diseño respecto a la lectura literal del dosier

### 3.1 El presupuesto de GPIO no cuadra

La topología literal del dosier §8.4 pide **29 GPIO sin reserva** (34 con la
reserva que el propio dosier solicita) y sólo hay **25** disponibles con criterio
conservador en un ESP32-S3-WROOM-1-N16R8.

**Déficit: 4 a 9 pines.** Esto materializa el riesgo «Escasez de GPIO → Rediseño»
del dosier §34, en el mejor momento posible: durante el diseño.

**Solución:** agregar las 9 interrupciones en 4 GPIO (OR cableado + registro de
desplazamiento) y sustituir el multiplexor de 5 GPIO por un ADC SPI de 1 GPIO.
Resultado: 21 usados, 4 de reserva. Detalle y variantes en el cálculo 03.

### 3.2 El detector de envolvente pasivo no puede funcionar

La lectura literal del diagrama del dosier §9.2 pone el rectificador y el
condensador de envolvente directamente detrás de la resistencia serie:

```
τ_ataque = 68 kΩ × 47 nF = 3,20 ms
```

**3,20 ms para capturar un impacto de menos de 1 ms.** El detector mediría una
fracción arbitraria del pico, dependiente de la duración del golpe, y la
comparación de amplitudes entre canales —que es el mecanismo de rechazo de
vibración cruzada del dosier §9.6— quedaría sin base.

**Solución:** un seguidor de tensión antes del rectificador, τ_ataque = 4,70 µs.
Coste: 3 circuitos integrados cuádruples.

### 3.3 La térmica del convertidor es marginal en blanco máximo

```
η = 0,90, θ_JA = 36 °C/W  →  Tj = 137 °C   EXCEDE los 125 °C
η = 0,93, θ_JA = 36 °C/W  →  Tj = 106 °C   ✔
```

El tope global de brillo del dosier §10.4 **no es una recomendación de eficiencia:
es un requisito térmico**. Con el tope al 60 %, Tj baja a 83 °C.

## 4. Qué se ha hecho con los avisos del encargo

| Prohibición | Cumplimiento |
|---|---|
| «PROHIBIDO decir que el ERC está conforme» | No se dice. Se declara ejecutado: **NO** |
| «PROHIBIDO decir que el circuito está validado» | No se dice. Se declara: **nada medido** |
| «PROHIBIDO decir que la PCB puede fabricarse» | No se dice. Se listan las 10 revisiones pendientes del dosier §28.8 |
| «Ser honesto vale más que un fichero binario roto» | Los `.kicad_sch` **no llevan símbolos**, y el motivo está explicado en `kicad/README.md`. El conexionado normativo va en CSV y Markdown |
| «Si NO cuadran los pines, dilo» | Se dice, con los números: déficit de 4 a 9 pines |
| «Sin precios inventados» | El BOM no tiene columna de precio |

## 5. Sobre los ficheros KiCad

Lo comprobado, con las herramientas que sí existen en este entorno:

| Comprobación | Resultado |
|---|---|
| Balance de paréntesis con literales y escapes | 9/9 a profundidad 0 |
| Parseo como s-expression (tokenizador + árbol) | 9/9 parsean, raíz `kicad_sch` |
| Unicidad de UUID | 322 UUID, **0 duplicados** |
| **Apertura real en Eeschema** | **NO EJECUTADA — no hay KiCad** |
| **ERC** | **NO EJECUTADO** |

**Que un fichero parsee como s-expression no garantiza que KiCad lo acepte:**
KiCad valida además el orden, el nombre y la aridad de cada token contra su
esquema interno, y eso no se puede reproducir aquí.

Los ficheros **sí** contienen: proyecto con clases de red predimensionadas, hoja
raíz con las 8 sub-hojas y sus pines jerárquicos, las 8 hojas hijas con
etiquetas jerárquicas y documentación embebida, y la reutilización jerárquica
real de la hoja 03 instanciada 9 veces desde la hoja 04.

**No** contienen instancias de símbolos. Decisión D-16, motivo en
`kicad/README.md`.

## 6. Qué debería pasar a continuación

1. **Revisión humana de la hoja 02 §4** (pines de arranque). Es el punto donde un
   error produce una placa muerta y donde una revisión de diez minutos vale más
   que cualquier documento.
2. **Aprobación del supervisor** de las decisiones marcadas ⚠: D-01, D-03, D-09,
   D-12, D-13, D-16.
3. **ADR de correspondencia canal ↔ posición física** y orden de direccionamiento
   de los LED (riesgo R-11), conjunto con WP-04 y WP-02.
4. **A1–A4:** abrir en KiCad, colocar símbolos, ejecutar ERC.
5. **D1–D6:** ensayos de la cadena piezo **sin el microcontrolador conectado**,
   sobre placa de prototipo, **antes** de comprometer dinero en una tirada.
6. **G1–G5:** medir la matriz 9×9 de acoplamiento. Puede invalidar la
   arquitectura completa.

## 7. Interfaces con otros paquetes de trabajo

| WP | Qué necesita de WP-06 | Qué necesita WP-06 de él |
|---|---|---|
| **WP-04 firmware** | Pinout (cálculo 03 §3.1), secuencia de lectura del 74HC165 (hoja 04 §3.3), requisito de fijar `VREF_TH` antes de habilitar la IRQ (R-05), tope de brillo obligatorio | Confirmación de que el algoritmo de vibración cruzada tolera la agregación de interrupciones (D-03) |
| **WP-02 backend** | Numeración de canales | ADR de correspondencia canal ↔ posición (R-11) |
| **WP-03 panel** | — | — |
| **WP-12 supervisión** | Este dosier completo | Aprobación de las 6 decisiones marcadas ⚠ |
