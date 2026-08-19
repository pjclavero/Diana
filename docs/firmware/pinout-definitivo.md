# Pinout definitivo del prototipo DO-only

Perfil de firmware:

```text
DIANA_BOARD_PROTO_DO_W5500
```

Header:

```text
firmware/esp32/boards/esp32s3_proto_do_w5500.h
```

## Pinout efectivo

| GPIO | Funcion | Direccion |
| --- | --- | --- |
| GPIO4 | LED_ROW_D1_D3 | Salida |
| GPIO5 | LED_ROW_D4_D6 | Salida |
| GPIO6 | LED_ROW_D7_D9 | Salida |
| GPIO8 | W5500_RST | Salida |
| GPIO9 | W5500_INT | Entrada |
| GPIO10 | W5500_CS | Salida |
| GPIO11 | W5500_MOSI | Salida |
| GPIO12 | W5500_SCK | Salida |
| GPIO13 | W5500_MISO | Entrada |
| GPIO15 | SELECTOR_1 | Entrada pull-up |
| GPIO16 | SELECTOR_2 | Entrada pull-up |
| GPIO17 | IDENTIFY_BUTTON | Entrada pull-up |
| GPIO38 | HC165_DATA | Entrada |
| GPIO47 | HC165_LOAD | Salida |
| GPIO48 | HC165_CLK | Salida |

## Arquitectura DO-only

```text
HC165 polling
  -> raw 16 bit
  -> DO polarity
  -> mask 0x01ff
  -> transition
  -> debounce/refractory
  -> diana_hit_group sin amplitud
  -> contrato hit-event digital sin amplitude/threshold
```

El perfil actual no compila `io_piezo.c` ni inicializa `piezo_amplitude`.

## LED

Los aros reales son de 24 LED por aro. Cada GPIO gobierna una fila de 3 aros:

```text
DIANA_LEDS_PER_TARGET = 24
DIANA_LEDS_PER_CHAIN  = 72
```

La prueba de banco de 2026-08-20 confirmo que, con 2 aros conectados en una
fila, ambos se encienden despues de configurar 72 LED por cadena.

## Bring-up serie

Al arrancar, antes de depender de MQTT o juego, el firmware imprime:

```text
DIANA HARDWARE BRING-UP
board: PROTO_DO_W5500
selector:
  GPIO15=x
  GPIO16=x
  mode=PRINCIPAL/SATELITE/INVALID_SELECTOR
identify: HIGH/LOW
HC165 RAW: 0bxxxxxxxxxxxxxxxx
D1: 0/1
...
D9: 0/1
Ethernet:
  W5500 SPI=OK
  LINK=UP/DOWN
  IP=x.x.x.x
LED:
  ROW1=OK/NOT_TESTED
  ROW2=OK/NOT_TESTED
  ROW3=OK/NOT_TESTED
```

## Validacion por fases

1. ESP32 arranca.
2. Monitor serie funciona.
3. Selector funciona.
4. IDENTIFY funciona.
5. HC165 #1 funciona.
6. HC165 #2 funciona.
7. D1-D9 tienen mapa correcto.
8. W5500 SPI funciona.
9. Enlace Ethernet funciona.
10. LEDs.
11. MQTT.
12. Juego.

Si una fase falla, no avanzar ocultando el fallo.

## Pendientes fisicos

| Pendiente | Motivo |
| --- | --- |
| Devboard exacta ESP32-S3 | No identificable desde el repo |
| GPIO48 vs RGB integrado | Posible conflicto segun revision de ESP32-S3-DevKitC-1 |
| Primer 74HC165 caliente | No alimentar de nuevo hasta revisar VCC/GND, cortos y nivel de `DO` |
| D1 activo permanente | Sospecha de cableado, entrada flotante, nivel incorrecto o 74HC165 danado |
| Polaridad DO | En banco 2026-08-20 se observo reposo alto; firmware en `DIANA_DO_ACTIVE_LOW` |
| Nivel DO HIGH | Sensores alimentados a 5 V; si `DO HIGH` es 5 V requiere adaptacion de nivel |
| Debounce/refractory | `PENDING_PHYSICAL_TUNING` |
| 74AHCT125 | Seleccionado para LED, pendiente de instalar |
