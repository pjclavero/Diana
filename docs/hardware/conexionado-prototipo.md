# Conexionado del prototipo DO-only

Montaje valido para `DIANA_BOARD_PROTO_DO_W5500`.

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
