# Prototipo DO-only con W5500

Este documento describe el modulo Diana que esta montado ahora en banco. Es la
fuente de verdad para el perfil de firmware `DIANA_BOARD_PROTO_DO_W5500`.

## Alcance

Un modulo contiene 9 dianas en matriz 3 x 3:

```text
D1  D2  D3
D4  D5  D6
D7  D8  D9
```

Hardware efectivo:

| Bloque | Montaje actual |
| --- | --- |
| MCU | ESP32-S3, devboard exacta pendiente de identificar fisicamente |
| Red | W5500 comercial con RJ45, SPI a 3.3 V |
| Sensores | 9 modulos piezo comerciales alimentados a 5 V |
| Senal de impacto | DO exclusivamente |
| Lectura DO | 2 x SN74HC165 a 3.3 V |
| Selector | SPDT 2 posiciones, COM a GND |
| Identificacion | Pulsador NA a GND |
| LED | 9 aros WS2812B en 3 cadenas |
| Level shift LED | 74AHCT125 seleccionado, pendiente de instalar |

## Estado de banco 2026-08-20

Prueba parcial con hardware real, no validacion completa de las 9 dianas:

| Elemento | Observacion |
| --- | --- |
| ESP32-S3 | Compila, flashea y arranca por COM6 |
| Selector | Leido como `PRINCIPAL` (`GPIO15=0`, `GPIO16=1`) |
| W5500 | SPI no responde: `VERSIONR=0x00`; firmware continua sin red |
| HC165 | Con 5 V de sensores corregido, el reposo llego a `raw=0xffff` |
| Polaridad DO | Reposo alto; perfil configurado como `DIANA_DO_ACTIVE_LOW` |
| Sensores instalados | Banco parcial: solo 2 modulos; el usuario los reubico a D2 y D3 |
| D1 | Aparecio como activo permanente antes de reubicar; sospecha fisica, no software |
| Primer 74HC165 | Reportado muy caliente; alimentacion retirada por seguridad |
| LED | Dos aros de 24 LED por aro se encienden con firmware de 72 LED por fila |

**No volver a alimentar el banco con el primer 74HC165 caliente.** Un 74HC165
alimentado a 3.3 V no debe recibir entradas `DO` a 5 V. Antes de seguir, medir
`DO` de cada sensor en reposo y golpe, confirmar `VCC/GND` del 74HC165 y usar
adaptacion de nivel si `DO HIGH` supera 3.3 V.

## No usado en este prototipo

Los siguientes bloques pertenecen a disenos anteriores o a una futura PCB. En
el perfil `DIANA_BOARD_PROTO_DO_W5500` son **NO UTILIZADO EN EL PROTOTIPO
DO-ONLY**:

| Elemento | Estado |
| --- | --- |
| AO de los sensores piezo | No conectar al firmware |
| ADC de impacto del ESP32-S3 | No usado |
| ADS1115 / ADS7953 / MCP3208 | No usado |
| MCP6004 externo | No usado |
| LM339 externo | No usado |
| VREF_TH | No usado |
| `piezo_amplitude()` | No usado por el perfil actual |

La sensibilidad se calibra con el potenciometro fisico de cada modulo sensor.
No existe calibracion software de amplitud en este prototipo.

## Nivel de DO

Los sensores se alimentan a 5 V. No se debe asumir que `DO HIGH` sea seguro para
el ESP32-S3. La instalacion fisica debe medir `DO HIGH` y usar adaptacion de
nivel si resulta ser 5 V.

El firmware permite estas polaridades:

```text
DIANA_DO_ACTIVE_HIGH
DIANA_DO_ACTIVE_LOW
```

La prueba de banco de 2026-08-20 observo reposo alto en las entradas utiles, por
lo que el perfil queda en `DIANA_DO_ACTIVE_LOW`. Esta decision no valida el
nivel electrico: si `DO HIGH` mide 5 V, sigue siendo obligatorio adaptar nivel
antes del 74HC165/ESP32.

## Mapa logico

El driver DO-only produce un bitmap de 9 bits:

| Bit | Diana |
| --- | --- |
| 0 | D1 |
| 1 | D2 |
| 2 | D3 |
| 3 | D4 |
| 4 | D5 |
| 5 | D6 |
| 6 | D7 |
| 7 | D8 |
| 8 | D9 |

Bits 9..15 son reservados y no generan impactos.

## Algoritmo

```text
leer 2 x HC165
  -> obtener bitmap crudo de 16 bits
  -> aplicar polaridad DO
  -> ignorar bits 9..15
  -> detectar transicion
  -> debounce / refractory
  -> 1 bit activo: candidato D1-D9
  -> varios bits activos: MULTI_TRIGGER diagnostico/no puntuable
  -> validar estado de juego
  -> generar hit-event sin amplitud ni umbral analogico
```

Si aparecen varios sensores activos en la misma captura, el firmware registra
`MULTI_TRIGGER` con bitmap, timestamp y numero de canales. No elige el primer
bit, el bit menor ni el ultimo bit.

## Perfil de firmware

El perfil creado es:

```text
DIANA_BOARD_PROTO_DO_W5500
```

Representa:

```text
ESP32-S3
W5500
2 x 74HC165
9 x DO
selector SPDT 2 posiciones
pulsador IDENTIFY
3 cadenas WS2812B
sin ADC de impacto
```

Los aros reales probados son de 24 LED cada uno. El firmware usa:

```text
DIANA_LEDS_PER_TARGET = 24
DIANA_LEDS_PER_CHAIN  = 72   (3 aros por fila)
```

Archivo principal:

```text
firmware/esp32/boards/esp32s3_proto_do_w5500.h
```

## GPIO48

La devboard exacta no aparece identificada en el repo ni puede deducirse desde
software sin inspeccion fisica. Hay que leer la serigrafia/revision de la placa.

Advertencia: en documentacion oficial de Espressif, ESP32-S3-DevKitC-1 inicial
usa el LED RGB en GPIO48, mientras la revision v1.1 usa GPIO38. Como el
prototipo usa GPIO48 para `HC165_CLK` y GPIO38 para `HC165_DATA`, esta revision
fisica es obligatoria antes de congelar el cableado.

Si GPIO48 esta unido a un RGB integrado, no cambiar el pin arbitrariamente:
primero confirmar si el LED carga/interfiere el reloj HC165 con osciloscopio o
analizador logico, despues documentar el GPIO libre elegido y modificar firmware
y cableado juntos.
