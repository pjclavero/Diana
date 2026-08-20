# Puntos de prueba — tabla única

> ## ⚠ NO UTILIZADO EN PROTOTIPO V1 — TP40–TP44 (`VREF_TH`) y TP50 (`nCS_ADC`) y demás puntos de la cadena analógica
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

> **SIN VALIDAR.** Los criterios son objetivos de diseño calculados, **no
> medidas**. Ninguno se ha comprobado.

Todos los puntos de prueba son **pines de 1 mm THT** accesibles con la PCB
montada, agrupados por hoja y con serigrafía visible.

| TP | Hoja | Red | Qué se comprueba | Criterio de aceptación |
|---|---:|---|---|---|
| TP1 | 01 | `+12V_F` | Entrada tras protecciones | 11,4 – 12,6 V |
| TP2 | 01 | `+5V_LED` | Riel de LED | 4,90 – 5,10 V en vacío |
| TP3 | 01 | `+5V_LOG` | Riel de lógica | 4,90 – 5,10 V |
| TP4 | 01 | `+3V3` | Riel digital | 3,25 – 3,35 V |
| TP5 | 01 | `+3V3A` | Riel analógico | 3,25 – 3,35 V ; rizado < 10 mV_pp |
| TP6 | 01 | `GND_PWR` | Referencia de potencia | — |
| TP7 | 01 | `GND_LOG` | Referencia de lógica | diferencia con TP6 < 50 mV en carga |
| TP8 | 01 | `U1.SW` | Conmutación de U1 | **sólo con punta diferencial** |
| TP10 | 02 | `+3V3_ETH` | Alimentación del W5500 | 3,25 – 3,35 V ; rizado < 30 mV_pp |
| TP11 | 02 | `SPI_SCLK` | Reloj SPI | 20 MHz, sobreoscilación < 0,5 V |
| TP12 | 02 | `nCS_W5500` | Chip select | nivel alto ≥ 2,6 V |
| TP13 | 02 | `W5500_INTn` | Interrupción de Ethernet | alto en reposo |
| TP14 | 02 | `W5500_RSTn` | Reset | bajo ≥ 500 µs al arrancar |
| TP15 | 02 | Y1 | Cristal | 25,000 MHz ± 30 ppm |
| TP16–TP18 | 02 | IO40–IO42 | Reserva de GPIO | accesibles |
| TP19 | 02 | IO2 | Reserva de GPIO | accesible |
| **TP_PZ1..9** | 03 | Piezo crudo | Amplitud real del impacto | **Registrar. Sonda 10:1 obligatoria** |
| **TP_CLMP1..9** | 03 | Nodo recortado | **Que la protección protege** | **Nunca > +3,7 V ni < −0,4 V** |
| TP_ENV1..9 | 03 | Envolvente | Ataque y caída | τ_caída = 10,3 ms ±20 % ; sube en < 50 µs |
| TP_CMP1..9 | 03 | Salida digital | Umbral e histéresis | subida 120,7 mV ±15 % ; histéresis 33 mV ±30 % |
| TP40 | 04 | `IRQ_ANY` | OR cableado | alto ≥ 3,0 V en reposo ; bajo ≤ 0,60 V con 1 y con 9 canales |
| TP41 | 04 | `SR_LOAD` | Carga del registro | pulso bajo ≥ 100 ns |
| TP42 | 04 | `SR_CLK` | Reloj del registro | 16 pulsos por lectura |
| TP43 | 04 | `SR_DATA` | Trama de canales | coherente con el canal golpeado |
| TP44 | 04 | `VREF_TH` | Umbral | ajustable 0 – 3,3 V ; rizado < 5 mV_pp |
| TP50 | 05 | `nCS_ADC` | Chip select del ADC | nivel alto ≥ 3,0 V |
| TP51 | 05 | CH12 del ADC | Autocomprobación de masa | lectura < 5 LSB |
| TP52 | 05 | `ENV1` en el ADC | Coherencia de la cadena | coincide con TP_ENV1 dentro del 2 % |
| TP60 | 06 | `+5V_LED` | **Transitorio negro → blanco** | caída ≤ 0,25 V ; recuperación < 500 µs |
| TP61–TP63 | 06 | Datos de las 3 cadenas | Nivel y flancos | alto ≥ 4,0 V ; flancos < 100 ns |
| TP64–TP66 | 06 | `+5V_ROWn` extremo lejano | Caída en el cable | ≥ 4,80 V en blanco máximo |
| TP70 | 07 | `SEL_A` | Selector | 3 combinaciones válidas ; nunca (0,0) |
| TP71 | 07 | `SEL_B` | Selector | ídem |
| TP72 | 07 | `BTN_ID` | Botón | rebote extinguido en < 5 ms |
| TP73 | 07 | `ST_LED_G` | LED verde | conmuta 0 / 3,3 V |
| TP74 | 07 | `ST_LED_A` | LED ámbar | conmuta 0 / 3,3 V |

## Los tres puntos que deciden el proyecto

1. **TP_CLMP1..9** — si aquí se supera +3,7 V, el ESP32-S3 está en peligro y hay
   que rediseñar la protección **antes** de conectar ningún microcontrolador.
2. **TP60 con transición negro → blanco** — si la caída supera 0,25 V, el bulk es
   insuficiente y el módulo se reiniciará en partida.
3. **TP40 con los 9 canales activos** — si el nivel bajo supera 0,825 V, la
   interrupción no se detecta y no hay detección de impactos.
