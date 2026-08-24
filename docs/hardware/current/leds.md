# LED del prototipo V1

## Hardware real

```text
9 aros WS2812B
24 LED por aro
216 LED por modulo
5 V
```

Cada aro:

```text
5V
GND
DI
DO
```

## Cadenas

```text
ROW1: GPIO4 -> D1 -> D2 -> D3
ROW2: GPIO5 -> D4 -> D5 -> D6
ROW3: GPIO6 -> D7 -> D8 -> D9
```

Cada cadena tiene:

```text
3 aros x 24 LED = 72 LED
```

## Firmware

Constantes relevantes:

```text
DIANA_LEDS_PER_TARGET = 24
DIANA_LEDS_PER_CHAIN  = 72
DIANA_LED_CHAINS      = 3
```

Driver:

```text
firmware/esp32/components/diana_platform_esp/src/io_leds.c
firmware/esp32/components/diana_core/src/led.c
```

## Estado de validacion

CONFIRMADO EN HARDWARE REAL:

- 9 aros conectados.
- El firmware inicializa 3 cadenas de 72 LED.
- Mapeo individual de los nueve aros validado el 2026-08-24, uno por uno y con
  los otros ocho apagados: D1/D4/D7 rojos, D2/D5/D8 azules y D3/D6/D9 verdes.
- Cada aro encendio sus 24 LED y las tres filas siguieron el orden fisico
  D1-D2-D3, D4-D5-D6 y D7-D8-D9.
- La integracion D1-D3 se valido con la imagen de banco: cada impacto puso en
  verde solo su aro durante 1 s y despues lo devolvio al rojo activo. El monitor
  confirmo `0x0001`, `0x0002` y `0x0004`, siempre con un unico canal.
- IDENTIFY fisico en GPIO17 activa el barrido cian en los nueve aros mientras
  se mantiene pulsado y restaura los estados al soltar.

Pendiente:

- Medir consumo real.
- Confirmar caida de tension al final de cada fila.
- Instalar/adaptar 74AHCT125 para dato 5 V definitivo.

## 74AHCT125

Seleccionado para:

```text
GPIO4 -> CH1 -> ROW1
GPIO5 -> CH2 -> ROW2
GPIO6 -> CH3 -> ROW3
```

Estado: seleccionado, no instalado. El firmware no depende de su presencia.
