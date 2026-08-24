# Firmware asociado al prototipo V1

El firmware que corresponde al prototipo fisico actual esta en:

```text
firmware/esp32/
```

Perfil de hardware:

```text
firmware/esp32/boards/esp32s3_proto_do_w5500.h
```

Entry point:

```text
firmware/esp32/main/app_main.c
```

## Archivos relevantes

| Archivo | Funcion |
| --- | --- |
| `firmware/esp32/boards/esp32s3_proto_do_w5500.h` | Board profile del prototipo DO-only |
| `firmware/esp32/main/app_main.c` | Arranque, bring-up y creacion de tareas |
| `firmware/esp32/main/app_tasks.c` | Tareas de entradas, sensores, LED, red y telemetria |
| `firmware/esp32/components/diana_platform_esp/src/io_hc165.c` | Lectura 2 x 74HC165 |
| `firmware/esp32/components/diana_core/src/sensors.c` | Decodificacion DO, debounce/refractory |
| `firmware/esp32/components/diana_platform_esp/src/io_leds.c` | Salida LED por RMT/led_strip |
| `firmware/esp32/components/diana_core/src/led.c` | Render de estados LED |
| `firmware/esp32/components/diana_platform_esp/src/net_w5500.c` | W5500, DHCP, SNTP |
| `firmware/esp32/components/diana_platform_esp/src/io_inputs.c` | Selector e IDENTIFY |
| `firmware/esp32/components/diana_platform_esp/src/mqtt_client.c` | Cliente MQTT |

## Constantes actuales

```text
DIANA_DO_POLARITY      = DIANA_DO_ACTIVE_HIGH
DIANA_HC165_POLL_MS    = 2
DIANA_LEDS_PER_TARGET  = 24
DIANA_LEDS_PER_CHAIN   = 72
DIANA_ETH_SPI_HZ       = 5 MHz
```

La tarea de entradas lee el selector y el pulsador cada 20 ms, acepta el cambio
tras 3 muestras estables y permite usar IDENTIFY sin red. La opcion Kconfig
`DIANA_BENCH_HIT_LED_TEST`, desactivada por defecto, arma D1-D3 para validar en
banco el recorrido impacto -> aro y rearma cada diana al segundo.

## Compilacion ESP-IDF

Entorno usado en banco:

```text
ESP-IDF v5.5
COM6
ESP32-S3 MAC 10:20:ba:4b:b7:04
```

Comando usado:

```cmd
idf.py -DCMAKE_MAKE_PROGRAM=C:/Espressif/tools/ninja/1.12.1/ninja.exe -p COM6 build flash monitor
```

## Limitaciones

Estado flasheado al cerrar la sesion del 2026-08-24: imagen completa de
operacion, con `DIANA_BENCH_HIT_LED_TEST` desactivado. Validada durante mas de
seis minutos con IDENTIFY y golpes D1-D3, sin reinicios ni watchdog.

- El modulo no esta aprovisionado en NVS: falta `module_id`.
- W5500 responde, enlaza y obtiene DHCP en imagen minima. El firmware completo
  ya queda estable con el driver activo; falta repetir DHCP con RJ45 conectado.
- MQTT sigue sin validar y requiere aprovisionar `module_id`.
- Host tests con `make -C firmware test` no se ejecutaron en este Windows por
  falta de `make`/`gcc`.
