# Protocolo de prueba en banco — módulo 3×3

> ## ⚠ NO UTILIZADO EN PROTOTIPO V1 — los ensayos que dependen de `VREF_TH`, del ADC o de la amplitud (p. ej. F6)
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

> **Este protocolo NO SE HA EJECUTADO.** No hay hardware. Es el procedimiento que
> debe seguirse cuando exista la primera placa, y **es la única vía por la que
> este diseño puede pasar de «documentado» a «validado»**.
>
> Dosier §29.1, §29.2, §29.3 y §27.4.

## Regla general de seguridad del procedimiento

**El ESP32-S3 se conecta en el paso F, no antes.** Los pasos A a E se ejecutan
con el zócalo del microcontrolador **vacío** o con la placa de desarrollo
desconectada. Motivo: el dosier §34 registra «Piezo daña el ESP32» como riesgo de
avería, y el paso E es precisamente el que comprueba si la protección funciona.
Si se comprueba con el microcontrolador puesto y la protección falla, se destruye
el microcontrolador y **además** se pierde la medida.

---

## Instrumentación necesaria (dosier §27.4)

| Instrumento | Requisito mínimo | Para qué |
|---|---|---|
| **Osciloscopio** | 2 canales, ≥ 100 MHz, memoria ≥ 10 kpts | Cadena piezo, transitorios del bus LED, SPI |
| **Sonda 10:1** | ≥ 300 V, ≥ 100 MHz | **Obligatoria** en TP_PZn: hasta 150 V |
| **Sonda diferencial** | ≥ 25 MHz, ≥ 100 V | TP8 (nodo de conmutación de U1). **Sin ella, no medir TP8** |
| **Fuente de laboratorio** | 0–30 V, 0–5 A, **con límite de corriente** | Alimentación controlada en los primeros encendidos |
| **Carga electrónica o resistencias de potencia** | 0–6 A a 5 V (≥ 30 W) | Escalones de carga sin LED |
| **Multímetro** | 4½ dígitos, mide µA | Tensiones de reposo, corrientes de fuga |
| **Analizador lógico** | ≥ 8 canales, ≥ 24 MHz | SPI, 74HC165, rebotes |
| **Medidor de consumo** | En la entrada de 12 V | Presupuesto de potencia real |
| **Cámara térmica o termopar** | | Térmica de U1 |
| **Generador de funciones** | 0–1 MHz, salida ± 10 V | Inyección de señal en la cadena piezo sin golpear |
| **Utillaje de impacto repetible** | ver `hardware/mechanical/tests/protocolo-impacto.md` | Impactos de energía conocida |

---

## FASE A — Inspección previa (sin alimentación)

| # | Paso | Criterio |
|---:|---|---|
| A1 | Inspección visual de soldaduras con lupa | Sin puentes, sin componentes girados |
| A2 | Verificar polaridad de C1, C4, C5, C62–C64 | Marca `+` coincidente |
| A3 | Verificar orientación del pin 1 de todos los CI | Coincide con serigrafía |
| A4 | Medir resistencia `+12V_F` → `GND_PWR` | **> 1 kΩ**. Si es < 100 Ω, hay un cortocircuito: **no alimentar** |
| A5 | Medir `+5V_LED` → `GND_PWR` | > 100 Ω (los bulks se cargan; medir con el óhmetro estabilizado) |
| A6 | Medir `+3V3` → `GND_LOG` | > 1 kΩ |
| A7 | Medir `+3V3A` → `GND_ANA` | > 1 kΩ |
| A8 | Medir `GND_PWR` ↔ `GND_LOG` ↔ `GND_ANA` | < 1 Ω entre sí (unidas en el punto estrella) |
| A9 | Medir `CHASSIS` → `GND_LOG` | **> 1 MΩ en continua** (sólo acopladas por C23) |

**Criterio de paso de fase:** A4 a A9 conformes. Si alguno falla, **no continuar**.

## FASE B — Primer encendido con límite de corriente

| # | Paso | Criterio |
|---:|---|---|
| B1 | Fuente de laboratorio a 12,0 V con **límite de 0,2 A**. Conectar | La fuente **no** debe entrar en limitación |
| B2 | Medir TP1 | 11,4 – 12,6 V |
| B3 | Medir TP2, TP3 | 4,90 – 5,10 V |
| B4 | Medir TP4 | 3,25 – 3,35 V |
| B5 | Medir TP5 | 3,25 – 3,35 V |
| B6 | Medir TP6–TP7 (diferencia) | < 50 mV |
| B7 | Palpar todos los CI con el dorso del dedo tras 2 min | Ninguno quemando |
| B8 | Conectar la alimentación **invertida** (−12 V) con límite de 0,1 A | **La corriente debe ser ≈ 0 mA** y TP2 = 0 V. Verifica Q1 |
| B9 | Restaurar polaridad correcta | Todo vuelve a B2–B5 |

**B8 es la prueba de la protección de polaridad. Ejecutarla con límite de
corriente de 0,1 A y durante menos de 5 s.**

## FASE C — Alimentación bajo carga (sin LED, con carga electrónica)

| # | Paso | Criterio |
|---:|---|---|
| C1 | Límite de la fuente a 3,5 A. Carga electrónica en `+5V_LED` | |
| C2 | Escalón 0 → 1 A. Osciloscopio en TP2, acoplamiento AC, 20 MHz de ancho de banda | Caída ≤ 0,10 V |
| C3 | Escalón 0 → 3 A | Caída ≤ 0,20 V |
| C4 | Escalón 0,5 → 4,32 A | **Caída ≤ 0,25 V ; recuperación < 500 µs** |
| C5 | Carga estática de 4,87 A durante 30 min, caja cerrada | TP2 ≥ 4,75 V ; T de la cápsula de U1 **< 100 °C** |
| C6 | Medir corriente de entrada de 12 V en C5 | Registrar. Calcular η = (5 × I_5V)/(12 × I_12V) |
| C7 | Verificar η contra el cálculo 04 | **η ≥ 0,93** o rehacer la térmica |
| C8 | Medir rizado en TP5 con U2 conmutando | **< 10 mV_pp** |
| C9 | Inrush: conectar 12 V con osciloscopio y sonda de corriente | Pico < 3 A |

**C4, C5 y C7 son criterios de paso/no paso.** Si C7 falla, el diseño térmico no
es válido en blanco máximo y hay que cambiar U1 o reducir el tope de brillo.

## FASE D — Cadenas LED

| # | Paso | Criterio |
|---:|---|---|
| D1 | Conectar sólo la fila 1. Todos los LED en verde al 50 % | 24 LED encendidos, sin parpadeo |
| D2 | Medir TP61 con osciloscopio | Nivel alto ≥ 4,0 V ; flancos < 100 ns |
| D3 | Medir TP64 (extremo lejano) con la fila en blanco máximo | **≥ 4,80 V** |
| D4 | Repetir D1–D3 con filas 2 y 3 | Ídem |
| D5 | Las 3 filas en blanco máximo | TP60 ≥ 4,75 V ; sin parpadeo ni cambios de color espurios |
| D6 | Transición negro → blanco de las 3 filas, TP60 en AC | **Caída ≤ 0,25 V, recuperación < 500 µs** |
| D7 | Desconectar el mazo de la fila 2 en caliente | Filas 1 y 3 siguen funcionando |
| D8 | Cortocircuitar `+5V_ROW1` a `GND_PWR` durante 5 s | **F60 abre. Filas 2 y 3 siguen. Al retirar, F60 rearma** |
| D9 | 1 h en blanco al 60 % con la caja cerrada | Sin reinicios ; T ambiente interna registrada |

## FASE E — Cadena piezo **SIN el microcontrolador conectado**

> **Fase crítica.** Es la que decide si el hardware es seguro para el ESP32-S3.

| # | Paso | Criterio |
|---:|---|---|
| E1 | Con el ESP32-S3 **desconectado**, conectar el piezo del canal 1 | |
| E2 | Sonda 10:1 en `TP_PZ1`. Golpear la diana con la máxima fuerza prevista, 10 veces | **REGISTRAR el pico máximo.** Si supera 150 V, rehacer el cálculo 02 |
| E3 | Sonda en `TP_CLMP1`, misma serie de golpes | **NUNCA > +3,7 V ni < −0,4 V.** Criterio absoluto de paso/no paso |
| E4 | Repetir E2–E3 en los 9 canales | Ídem |
| E5 | Sonda en `TP_ENV1`. Golpe único | Sube en < 50 µs ; **τ de caída = 10,3 ms ± 20 %** |
| E6 | Generador de funciones: rampa lenta 0 → 500 mV en la entrada del comparador. Osciloscopio en `TP_CMP1` | Conmuta a **120,7 mV ± 15 %** |
| E7 | Rampa descendente | Conmuta a **87,7 mV ± 15 %**. Histéresis = 33 mV ± 30 % |
| E8 | Cortocircuitar `TP_CMP1` a masa con una resistencia de 1 kΩ. Medir TP40 | **≤ 0,60 V** |
| E9 | Repetir E8 con los 9 canales a la vez | **≤ 0,60 V** (el caso peor) |
| E10 | **Ensayo destructivo de sobretensión** sobre una **placa sacrificable**: inyectar 300 V de pulso en `PZ1_P` | Documentar qué falla primero. Objetivo: que falle R_serie, **no** el clamp |

**E3 y E10 son los ensayos que el dosier §34 exige («protección y pruebas de
sobretensión»). Sin ellos, no se puede afirmar que el ESP32-S3 esté protegido.**

## FASE F — Integración del microcontrolador

> Sólo se entra en esta fase si **todas** las fases anteriores han pasado.

| # | Paso | Criterio |
|---:|---|---|
| F1 | Conectar el ESP32-S3 sin firmware de aplicación | Arranca ; consola por J30 responde |
| F2 | Verificar TP14 (`W5500_RSTn`) al arrancar | Bajo ≥ 500 µs |
| F3 | Analizador lógico en SPI. Leer el registro de versión del W5500 | Devuelve `0x04` |
| F4 | Medir TP11 (SCLK) a 20 MHz | Sobreoscilación < 0,5 V. Si falla, bajar a 10 MHz y repetir |
| F5 | Leer el ADC externo, canal CH12 (masa) | **< 5 LSB** |
| F6 | Fijar `VREF_TH` por PWM a 120 mV. Medir TP44 | 120 mV ± 10 mV ; rizado < 5 mV_pp |
| F7 | Golpear el canal 1. Verificar que salta `IRQ_ANY` y que el 74HC165 devuelve el bit 0 | Sólo el bit 0 activo |
| F8 | Repetir F7 en los 9 canales | Cada golpe activa **su** bit y sólo el suyo |
| F9 | Medir el tiempo desde el flanco de `IRQ_ANY` hasta los 9 bits leídos | **< 200 µs** (muy inferior a la ventana de 1–3 ms) |
| F10 | Leer la amplitud por el ADC tras el golpe | Valor coherente con `TP_ENVn` dentro del 2 % |
| F11 | Girar el selector por sus 3 posiciones | 3 combinaciones válidas, nunca (0,0) |
| F12 | Desconectar el mazo J31 | El firmware lee (0,0) y declara fallo de selector |
| F13 | Pulsar el botón de identificación, analizador lógico en TP72 | Rebote extinguido en < 5 ms |
| F14 | Ethernet: conectar cable, verificar enlace y DHCP | IP obtenida ; ping estable 1 000 paquetes, 0 % de pérdida |

## FASE G — Módulo completo (dosier §29.3)

| # | Paso | Criterio |
|---:|---|---|
| G1 | 9 sensores + 72 LED simultáneamente, 1 h | Sin reinicios. **Leer la causa de reinicio del ESP32-S3: debe ser `POWERON`** |
| G2 | Consumo máximo con blanco máximo y los 9 canales activos | ≤ 5,0 A a 5 V ; ≤ 2,4 A a 12 V |
| G3 | Temperatura tras 1 h con la caja cerrada | U1 < 100 °C ; ambiente interno < 60 °C |
| G4 | Golpear la diana 5 mientras las 3 filas están en blanco máximo | **La detección no se degrada.** Comparar amplitud con el caso de LED apagados: diferencia < 10 % |
| G5 | Desconectar Ethernet 60 s y reconectar | Recuperación automática ; cola local sin pérdidas |
| G6 | Cortar la alimentación durante una detección | Al volver, causa de reinicio registrada correctamente |
| G7 | 1 000 impactos en el canal 5 (dosier §29.1) | Sin fallos de detección > 1 % ; sin degradación de amplitud > 10 % |
| G8 | Vibración cruzada: golpear la diana 5, medir amplitud en los 9 canales | **Registrar la matriz 9×9 de acoplamiento**: es la entrada del algoritmo del dosier §9.6 |

**G4 y G8 son los ensayos que deciden si el conjunto electrónica + mecánica
funciona.** G8 produce el dato que WP-04 necesita para configurar el coeficiente
de vibración vecina.

---

## Registro de resultados

Cada ejecución debe producir una tabla con: fecha, número de serie de la placa,
instrumento usado, valor medido, criterio, y **PASA / NO PASA**. Las capturas de
osciloscopio de E2, E3, E5, C4 y D6 se archivan como evidencia.

**Sin ese registro, ningún informe puede afirmar que el diseño está validado.**

## Criterios de aceptación agregados

| Fase | Se puede continuar si |
|---|---|
| A | Todas las resistencias de aislamiento conformes |
| B | Rieles en tolerancia **y** protección de polaridad demostrada (B8) |
| C | Caída ≤ 0,25 V (C4), térmica conforme (C5), η ≥ 0,93 (C7) |
| D | Caída ≤ 0,25 V en el transitorio (D6) y ≥ 4,80 V en el extremo lejano (D3) |
| E | **`TP_CLMPn` nunca fuera de −0,4 / +3,7 V (E3)** |
| F | Cada canal identificado individualmente (F8) y latencia < 200 µs (F9) |
| G | Sin reinicios en 1 h (G1) y matriz de acoplamiento registrada (G8) |
