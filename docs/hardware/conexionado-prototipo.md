# Conexionado del prototipo DO-only

Montaje valido para `DIANA_BOARD_PROTO_DO_W5500`.

Los datos medidos de este documento vienen del banco 2026-08-20 sobre el
ESP32-S3 real. La regla de decision de nivel, la numeracion DIP-16 y la lista
de comprobacion previa se rescataron de la rama `hw/do-only-v1` (MP0-S): son
razonamiento, no medidas, y no sustituyen a nada observado.

## ANTES DE DAR TENSION: regla de decision del nivel de `DO`

El 74HC165 que se calento el 2026-08-20 obliga a tomarse esto en serio. Los
modulos piezo comerciales se anuncian como «TTL 5 V»; el ESP32-S3 y los 74HC165
de este montaje trabajan a **3.3 V**.

Medir sobre **un** sensor, antes de fijar el conexionado:

| Medida | Como | Por que decide el montaje |
| --- | --- | --- |
| `V_DO_IDLE` | multimetro, sensor en reposo | si en reposo hay ~5 V, hay 5 V permanentes contra la entrada del 74HC165 |
| `V_DO_TRIGGER` | osciloscopio, golpeando la diana | dice el nivel real del pulso |
| Polaridad | ¿el impacto lleva `DO` a alto o a bajo? | en banco se observo reposo ALTO; el firmware esta en `DIANA_DO_ACTIVE_LOW` |
| Duracion minima del pulso | osciloscopio, >= 20 impactos | si el pulso es mas corto que el periodo de sondeo (`DIANA_HC165_POLL_MS = 2`), se pierden impactos |

```text
   ¿Cuanto vale DO en su nivel ALTO, medido?
        |
        +-- ~3.3 V  --> conexion directa DO -> entrada del 74HC165. OK
        |
        +-- ~5.0 V  --> ADAPTACION DE NIVEL en CADA UNA de las nueve lineas DO,
                        antes del 74HC165. Nueve canales, nueve adaptaciones.
                        Ninguna se salta.
```

Muchos de estos modulos aceptan alimentarse a 3.3 V en `V`, y entonces su `DO`
sale a 3.3 V y el problema desaparece. Comprobarlo **midiendo**, no por lo que
diga el anuncio: hay que verificar que a 3.3 V el comparador del modulo sigue
disparando de forma fiable.

Nada de lo anterior esta medido todavia: `PENDING_PHYSICAL_VALIDATION`.

## ESP32 a W5500

| ESP32-S3 | W5500 | Direccion |
| --- | --- | --- |
| GPIO8 | RST | ESP32 -> W5500 |
| GPIO9 | INT | W5500 -> ESP32 |
| GPIO10 | CS | ESP32 -> W5500 |
| GPIO11 | MOSI | ESP32 -> W5500 |
| GPIO12 | SCK | ESP32 -> W5500 |
| GPIO13 | MISO | W5500 -> ESP32 |
| GND | GND | comun |

```text
ESP32 GPIO11 MOSI -> W5500 MOSI
ESP32 GPIO12 SCK  -> W5500 SCK
ESP32 GPIO13 MISO <- W5500 MISO
ESP32 GPIO10 CS   -> W5500 CS
ESP32 GPIO8  RST  -> W5500 RST
ESP32 GPIO9  INT  <- W5500 INT
GND <----------------------> GND
```

El modulo W5500 comercial puede tener entrada 5 V y 3.3 V. Usar la entrada de
alimentacion adecuada del propio modulo y conservar SPI a nivel logico 3.3 V.

## ESP32 a HC165

| ESP32-S3 | HC165 #1 | HC165 #2 | Nota |
| --- | --- | --- | --- |
| GPIO38 | - | QH/SER_OUT | Datos hacia ESP32 |
| GPIO47 | SH/LD | SH/LD | Carga paralela compartida |
| GPIO48 | CLK | CLK | Reloj compartido |
| GND | CE/CLK_INH | CE/CLK_INH | Habilitado permanente |
| GND/3.3 V fijo | SER_IN | - | Nivel conocido |
| QH/SER_OUT #1 | - | SER_IN | Cascada |
| 3.3 V | VCC | VCC | Alimentacion logica |
| GND | GND | GND | Comun |

```text
HC165 #1 QH/SER_OUT -> HC165 #2 SER_IN
HC165 #2 QH/SER_OUT -> ESP32 GPIO38

ESP32 GPIO47 -> HC165 #1 SH/LD
             -> HC165 #2 SH/LD

ESP32 GPIO48 -> HC165 #1 CLK
             -> HC165 #2 CLK

CE / CLK_INH de ambos -> GND
SER_IN de HC165 #1 -> nivel fijo conocido
```

No dejar entradas digitales flotando.

Advertencia de banco 2026-08-20: el primer 74HC165 fue reportado muy caliente y
se corto alimentacion. Eso no es normal. Antes de alimentar de nuevo:

- verificar `VCC=3.3 V` y `GND` en cada 74HC165;
- medir continuidad entre `3.3 V` y `GND`;
- desconectar los `DO` de sensores y comprobar si el 74HC165 se calienta solo;
- medir `DO HIGH` de cada sensor alimentado a 5 V;
- no conectar `DO=5 V` a entradas de un 74HC165 alimentado a 3.3 V sin
  adaptacion de nivel.

### Numeracion de pines del 74HC165 (DIP-16 / SOIC-16)

| Pin | Senal | Pin | Senal |
| ---: | --- | ---: | --- |
| 1 | `SH/LD` | 16 | `VCC` (**3.3 V**) |
| 2 | `CLK` | 15 | `CLK INH` (`CE`) |
| 3 | entrada `E` | 14 | entrada `D` |
| 4 | entrada `F` | 13 | entrada `C` |
| 5 | entrada `G` | 12 | entrada `B` |
| 6 | entrada `H` | 11 | entrada `A` |
| 7 | `QH` negada | 10 | `SER` (entrada serie) |
| 8 | `GND` | 9 | `QH` (salida serie) |

Coincide con `hardware/electronics/schematics/04-piezo-array-9ch.md` seccion 3.3.

Desacoplo: 100 nF entre pin 16 y pin 8, **uno por integrado y pegado al chip**.

## HC165 a sensores D1-D9

Los 9 sensores usan la salida `DO`. `AO` no se usa.

| Sensor | HC165 | Entrada |
| --- | --- | --- |
| D1 DO | #1 | A |
| D2 DO | #1 | B |
| D3 DO | #1 | C |
| D4 DO | #1 | D |
| D5 DO | #1 | E |
| D6 DO | #1 | F |
| D7 DO | #1 | G |
| D8 DO | #1 | H |
| D9 DO | #2 | A |
| Reserva | #2 | B-H a nivel fijo conocido |

```text
D1 DO -> HC165 #1 A      D5 DO -> HC165 #1 E      D9 DO -> HC165 #2 A
D2 DO -> HC165 #1 B      D6 DO -> HC165 #1 F      #2 B-H -> nivel fijo
D3 DO -> HC165 #1 C      D7 DO -> HC165 #1 G
D4 DO -> HC165 #1 D      D8 DO -> HC165 #1 H
```

Si `DO HIGH` mide 5 V, insertar adaptacion de nivel antes del HC165/ESP32. Los
HC165 estan alimentados a 3.3 V. Las entradas sin sensor instalado deben quedar
a nivel fijo conocido; no dejarlas al aire.

Estado parcial visto en banco: solo habia 2 sensores instalados. Primero se
observo D1 aparentemente activo permanente y D2 respondiendo al golpe; despues
el usuario indico que los sensores estaban realmente en D2 y D3. No declarar
validado el mapa D1-D9 hasta repetir la prueba con el 74HC165 frio y entradas
no usadas fijadas.

## ESP32 a selector

Selector actual: SPDT, 2 posiciones, 3 terminales.

| Terminal | Conexion |
| --- | --- |
| 1 | ESP32 GPIO15 |
| COM | GND |
| 2 | ESP32 GPIO16 |

GPIO15 y GPIO16 se configuran como `INPUT_PULLUP`.

| GPIO15 | GPIO16 | Modo actual |
| --- | --- | --- |
| LOW | HIGH | PRINCIPAL |
| HIGH | LOW | SATELITE |
| HIGH | HIGH | INVALID_SELECTOR |
| LOW | LOW | INVALID_SELECTOR |

Futuro selector ON-OFF-ON con los mismos cables:

| GPIO15 | GPIO16 | Modo futuro |
| --- | --- | --- |
| LOW | HIGH | PRINCIPAL |
| HIGH | HIGH | AUTO |
| HIGH | LOW | SATELITE |
| LOW | LOW | ERROR |

## ESP32 a IDENTIFY

| ESP32-S3 | Pulsador |
| --- | --- |
| GPIO17 | Terminal 1 |
| GND | Terminal 2 |

```text
ESP32 GPIO17 -- pulsador NA -- GND
```

GPIO17 se configura como `INPUT_PULLUP`.

| Estado | Lectura |
| --- | --- |
| Sin pulsar | HIGH |
| Pulsado | LOW |

El firmware aplica debounce software.

## ESP32 a LED

| ESP32-S3 | Cadena | Dianas |
| --- | --- | --- |
| GPIO4 | LED_ROW_D1_D3 | D1 -> D2 -> D3 |
| GPIO5 | LED_ROW_D4_D6 | D4 -> D5 -> D6 |
| GPIO6 | LED_ROW_D7_D9 | D7 -> D8 -> D9 |

```text
GPIO4 -> D1 DI ; D1 DO -> D2 DI ; D2 DO -> D3 DI
GPIO5 -> D4 DI ; D4 DO -> D5 DI ; D5 DO -> D6 DI
GPIO6 -> D7 DI ; D7 DO -> D8 DI ; D8 DO -> D9 DI
```

Los aros WS2812B se alimentan desde 5 V del sistema. No alimentarlos desde GPIO.
Todos los GND deben ser comunes.

Cada aro real probado tiene 24 LED. Cada fila completa tiene 3 aros en serie,
por tanto 72 LED por cadena:

```text
D1 = pixels 0..23
D2 = pixels 24..47
D3 = pixels 48..71
```

En la prueba de 2026-08-20 se corrigio el firmware de 24 LED/fila a 72 LED/fila;
con 2 aros conectados, ambos se encendieron. Si solo se enciende el primer aro,
revisar `DO` del primer aro hacia `DI` del segundo, 5 V/GND del segundo aro y el
futuro nivelador 74AHCT125.

Cuando se instale el 74AHCT125:

```text
GPIO4 -> 74AHCT125 -> fila D1-D3
GPIO5 -> 74AHCT125 -> fila D4-D6
GPIO6 -> 74AHCT125 -> fila D7-D9
```

## Comprobacion antes de dar tension

Lista rescatada de `hw/do-only-v1`. Es la que habria que haber pasado antes del
banco 2026-08-20; el primer 74HC165 se calento y hubo que cortar alimentacion.

1. Continuidad de masa entre ESP32, ambos 74HC165, los nueve sensores y el W5500.
2. `VCC` de los 74HC165 medido a **3.3 V**, no a 5 V.
3. `CLK INH` (pin 15) de ambos registros a masa.
4. `SER_IN` (pin 10) del **#1** atado a nivel fijo, no al aire.
5. `QH` de **#1** a `SER` de **#2**; `QH` de **#2** a GPIO38. **En ese orden.**
6. Ningun `AO` conectado.
7. Nivel real de `DO` medido y, si es de 5 V, adaptacion de nivel montada en
   **las nueve** lineas.
8. Alimentacion de los LED separada de la del ESP32, con masa comun.
9. Tension del modulo W5500 confirmada contra el modelo real.
10. Ningun condensador electrolitico con la polaridad invertida.
11. Con los `DO` desconectados, dar tension solo a los 74HC165 y comprobar que
    **no se calientan solos**. Si se calientan, el fallo no esta en los
    sensores.

Solo despues: dar tension y pasar a
[`calibracion-sensores-do.md`](calibracion-sensores-do.md).

Aviso GPIO48: algunas revisiones del DevKit ESP32-S3 usan GPIO48 para su LED RGB
integrado (`PENDING_PHYSICAL_VALIDATION`). Si la placa comprada lo ocupa,
`HC165_CLK` se mueve a GPIO14 o GPIO21, ambos libres, y se actualiza el header
`esp32s3_proto_do_w5500.h` y `docs/firmware/pinout-definitivo.md` a la vez.

Pines que NO se cablean en V1: GPIO7 (`IRQ_ANY`), GPIO14 y GPIO21. Ver
`docs/firmware/pinout-definitivo.md`.
