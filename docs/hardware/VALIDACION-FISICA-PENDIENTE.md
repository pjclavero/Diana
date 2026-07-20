# LISTA DE VALIDACIÓN FÍSICA PENDIENTE ANTES DE FABRICAR UNA PCB

> **Este es el documento más importante del WP-06.**
>
> El dosier §28.8 exige, antes de fabricar una PCB: revisión eléctrica, revisión
> de seguridad, revisión de fabricación, **ERC**, **DRC**, revisión de corrientes,
> revisión térmica, revisión de BOM, revisión de disponibilidad y aprobación del
> supervisor.
>
> **De esa lista, este paquete de trabajo no ha ejecutado NINGUNA.**

## Estado del entorno (comprobado, no supuesto)

```
$ command -v kicad-cli   → NO ENCONTRADO
$ command -v kicad       → NO ENCONTRADO
$ command -v eeschema    → NO ENCONTRADO
$ command -v pcbnew      → NO ENCONTRADO
$ python3 -c "import pcbnew"  → ModuleNotFoundError
$ dpkg -l | grep -i kicad     → sin paquetes kicad
```

No hay KiCad. No hay hardware. No hay instrumentación. Lo entregado es **un
diseño documentado y unos ficheros de proyecto**, con la validación
**explícitamente pendiente**.

---

# Las 47 validaciones pendientes

## Bloque A — Validaciones de herramienta (5)

| # | Validación | Cómo | Bloqueante |
|---:|---|---|:---:|
| **A1** | Abrir `diana-module-3x3.kicad_sch` en KiCad 8 y corregir lo que rechace | KiCad | **SÍ** |
| **A2** | Colocar los símbolos de `netlist/components.csv` y cablearlos según `netlist/netlist.csv` | KiCad | **SÍ** |
| **A3** | Asignar huellas a los 58 ítems del BOM | KiCad | **SÍ** |
| **A4** | **Ejecutar ERC** y resolver todos los errores | KiCad | **SÍ** |
| **A5** | **Ejecutar DRC** sobre el layout | KiCad | **SÍ** |

**Ninguna afirmación sobre conformidad eléctrica puede hacerse hasta que A4 esté
ejecutado con salida limpia.**

## Bloque B — Alimentación y potencia (9)

| # | Validación | Criterio numérico | Fase del protocolo |
|---:|---|---|---|
| **B1** | Corriente real de un LED en blanco máximo y en reposo | Confirmar 60 mA / 1 mA **(H)** | D1 |
| **B2** | Consumo real del ESP32-S3 con W5500 enlazado a 100 Mbit/s | ≤ 550 mA presupuestados | C |
| **B3** | **Rendimiento real del convertidor U1 a 4,87 A** | **η ≥ 0,93** o la térmica no cierra | C7 |
| **B4** | Caída de tensión en el transitorio negro → blanco | **≤ 0,25 V, recuperación < 500 µs** | C4 / D6 |
| **B5** | ESR real del bulk adquirido | **≤ 26,2 mΩ combinada** | — |
| **B6** | Tensión en el extremo lejano de cada fila en blanco máximo | **≥ 4,80 V** | D3 |
| **B7** | Corriente de inrush al conectar los 12 V | **< 3 A** (límite de la fuente) | C9 |
| **B8** | **Protección de polaridad inversa: aplicar −12 V** | Corriente ≈ 0, TP2 = 0 V | B8 |
| **B9** | Actuación de los PTC de fila ante cortocircuito | F60 abre, filas 2 y 3 siguen, rearma al retirar | D8 |

## Bloque C — Térmica (5)

| # | Validación | Criterio numérico | Fase |
|---:|---|---|---|
| **C1** | Temperatura de la cápsula de U1 tras 30 min a 4,87 A, caja cerrada | **< 100 °C** | C5 |
| **C2** | Temperatura ambiente interna tras 1 h de uso normal | **< 60 °C** | G3 |
| **C3** | θ_JA real conseguido con el cobre de la PCB | ≤ 25 °C/W si η < 0,93 | — |
| **C4** | Actuación de la protección térmica de U1 | Actúa antes de daño | — |
| **C5** | Rizado de `+3V3A` con U2 conmutando | **< 10 mV_pp** | C8 |

## Bloque D — Cadena piezo (11) — **el bloque de mayor riesgo**

| # | Validación | Criterio numérico | Fase |
|---:|---|---|---|
| **D1** | **Tensión de pico real del piezo en circuito abierto, impacto máximo** | Hipótesis: **150 V**. Si es mayor, rehacer todo el cálculo 02 | E2 |
| **D2** | Capacidad real C_p de los discos | Hipótesis: 20 nF | — |
| **D3** | Duración real del pulso de impacto | Hipótesis: < 1 ms | E2 |
| **D4** | **Tensión en `TP_CLMPn` con el impacto más fuerte, en los 9 canales** | **NUNCA > +3,7 V ni < −0,4 V.** Criterio absoluto | E3 / E4 |
| **D5** | **Ensayo destructivo de sobretensión sobre placa sacrificable** | Debe fallar R_serie, no el clamp | E10 |
| **D6** | Tensión de trabajo real soportada por las resistencias 0805 en pulso | Curva de sobrecarga puntual del fabricante | — |
| **D7** | Tiempo de ataque y caída reales en `TP_ENVn` | Sube < 50 µs ; τ = 10,3 ms ± 20 % | E5 |
| **D8** | Umbral e histéresis reales del comparador | 120,7 mV ± 15 % ; 33 mV ± 30 % | E6 / E7 |
| **D9** | **Nivel bajo de `IRQ_ANY` con 1 y con 9 canales activos** | **≤ 0,60 V** (V_IL = 0,825 V) | E8 / E9 |
| **D10** | V_OL real del LM339 a 1 mA | Hipótesis: 0,20 V | — |
| **D11** | Dispersión entre los 9 canales | Documentar para la calibración del dosier §9.7 | E4 |

## Bloque E — Controlador, Ethernet y GPIO (7)

| # | Validación | Criterio numérico | Fase |
|---:|---|---|---|
| **E1** | **Tabla de pines contra la hoja de datos de la revisión exacta del módulo** | Sin conflictos | — |
| **E2** | Variante de PSRAM del módulo adquirido (`R8` octal vs `R2` quad) | Decide si `IO35`–`IO37` existen | — |
| **E3** | Arranque correcto con `IO0`, `EN`, `IO45`, `IO46` en su estado | Arranca a la primera | F1 |
| **E4** | Integridad de señal del SPI a 20 MHz con dos esclavos | Sobreoscilación < 0,5 V | F4 |
| **E5** | Liberación correcta de MISO por ambos esclavos | Sin bloqueos en 10⁶ transacciones | F3 |
| **E6** | Enlace Ethernet y DHCP estables | 1 000 pings, 0 % de pérdida | F14 |
| **E7** | Latencia desde `IRQ_ANY` hasta 9 bits leídos | **< 200 µs** (ventana de 1–3 ms) | F9 |

## Bloque F — Integración de módulo (5)

| # | Validación | Criterio numérico | Fase |
|---:|---|---|---|
| **F1** | 1 h con 9 sensores y 72 LED | **Sin reinicios. Causa de reinicio = `POWERON`** | G1 |
| **F2** | Detección de impacto con las 3 filas en blanco máximo | Degradación de amplitud **< 10 %** | G4 |
| **F3** | 1 000 impactos en un canal | Fallos de detección **< 1 %** | G7 |
| **F4** | Identificación individual de canal en los 9 | Cada golpe activa **sólo** su bit | F8 |
| **F5** | Recuperación tras pérdida de Ethernet de 60 s | Automática, sin pérdida de cola | G5 |

## Bloque G — Mecánica (10)

| # | Validación | Criterio numérico |
|---:|---|---|
| **G1** | Masa real del conjunto móvil | Hipótesis: 0,26 kg |
| **G2** | Rigidez real de los silentblocks | 2 300 N/m ± 30 % por apoyo |
| **G3** | Frecuencia propia por *bump test* con FFT | **30 Hz ± 30 %** |
| **G4** | FFT del impacto real | Confirmar 500 Hz – 5 kHz **(H)** |
| **G5** | **Matriz 9×9 de acoplamiento entre dianas** | **A_vecina/A_golpeada < 0,25** |
| **G6** | Aportación de la junta perimetral (con/sin) | Cuantificar el camino aéreo |
| **G7** | Aportación del apantallamiento (con/sin) | Separar acoplamiento eléctrico del mecánico |
| **G8** | Que el par de apriete no anule el aislamiento | f_n no sube al apretar |
| **G9** | Ensayo de 1 000 impactos sobre el espesor finalista | Degradación **< 10 %**, sin fisura |
| **G10** | Elección de espesor entre 2, 3 y 4 mm | Ensayos M1–M10 |

---

# LO QUE NO SE PUEDE AFIRMAR HOY

Declaración explícita, para que nadie cite este trabajo fuera de contexto:

| Afirmación | Estado |
|---|---|
| «El ERC está conforme» | **PROHIBIDO AFIRMARLO.** No se ha ejecutado ERC |
| «El DRC está conforme» | **PROHIBIDO.** No hay layout |
| «El circuito está validado» | **PROHIBIDO.** Nada se ha construido ni medido |
| «La PCB puede fabricarse» | **PROHIBIDO.** Faltan las 10 revisiones del dosier §28.8 |
| «La protección del piezo funciona» | **PROHIBIDO.** Es lo que valida D4 y D5, no ejecutados |
| «Los ficheros KiCad se abren correctamente» | **NO SE SABE.** Sólo se ha comprobado que parsean como s-expression |
| «El presupuesto de potencia es correcto» | Calculado sobre datos de catálogo. **No medido** |
| «Los umbrales del piezo están calibrados» | **PROHIBIDO** (dosier §9.3 y prohibición del WP-04). Son valores iniciales |
| «El aislamiento mecánico es suficiente» | **NO SE SABE.** Depende de G5 |

# LO QUE SÍ SE PUEDE AFIRMAR

| Afirmación | Evidencia |
|---|---|
| Existe un diseño completo y trazable de las 8 hojas del dosier §28 | `hardware/electronics/schematics/` |
| Los cálculos están hechos con operaciones visibles y son reproducibles | `hardware/electronics/calculations/` |
| **El presupuesto de GPIO de la topología literal del dosier §8.4 NO CUADRA** | cálculo 03, déficit de 4 a 9 pines |
| Existe una topología alternativa que sí cuadra, con 4 pines de reserva | cálculo 03 §3 |
| Los ficheros `.kicad_sch` parsean como s-expression y tienen UUID únicos | 9/9 ficheros, 322 UUID, 0 duplicados |
| Existe un protocolo de banco ejecutable con criterios numéricos | `test-fixtures/protocolo-banco.md` |
| Existen alternativas documentadas para cada componente crítico | `bom/bom-modulo-3x3-preliminar.csv` |

---

# Orden recomendado de ejecución

```
1. A1-A4  (KiCad + ERC)                    ← desbloquea todo lo demás
2. D1-D6  (piezo, SIN microcontrolador)    ← decide si el diseño es seguro
3. G1-G5  (mecánica y acoplamiento)        ← decide si el proyecto es viable
4. B1-B9, C1-C5  (potencia y térmica)
5. E1-E7  (controlador y red)
6. A5     (layout + DRC)
7. F1-F5  (integración)
8. G6-G10 (elección de material)
```

**El orden no es negociable en sus dos primeros puntos.** D1–D6 se ejecutan
**sin** el ESP32-S3 conectado y **antes** de comprometer dinero en una tirada de
PCB. G5 puede invalidar la arquitectura completa: si el acoplamiento entre dianas
supera 0,50 con el mejor aislamiento construible, el problema no se arregla con
electrónica.
