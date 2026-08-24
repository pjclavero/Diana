# Estado de validacion fisica

## Tabla por subsistema

| Subsistema | Montado | Firmware | Hardware real | Estado | Evidencia |
| --- | ---: | ---: | ---: | --- | --- |
| ESP32-S3 | si | si | si | Arranca y flashea | COM6, MAC `10:20:ba:4b:b7:04` |
| W5500 | si | si | si, parcial | SPI/link/DHCP validados en imagen minima | `SPI=OK`, `LINK=UP`, DHCP `192.168.1.168` |
| HC165 #1 | si | si | si, D1-D3 | Temperatura normal con divisores | Incidencia de 5 V directo corregida |
| HC165 #2 | si | si | si, D1-D3 | Temperatura normal; cascada validada | `0x0001`, `0x0002`, `0x0004` |
| Sensores D1-D3 | si | si | si | Validados para el alcance montado | DO reposo 0 V, impacto hasta 5 V; raw correcto |
| Sensores D4-D9 | pendiente | si | no | Pendiente | Entradas fijadas a GND en banco parcial |
| Selector SPDT | si | si | si | PRINCIPAL y SATELITE validados | `0/1=PRINCIPAL`, `1/0=SATELITE` |
| IDENTIFY | si | si | si | Entrada y barrido cian validados | `HIGH/LOW`; nueve aros responden |
| WS2812B | si | si | si | D1-D9 validados individualmente | 9 aros de 24 LED; 3 cadenas de 72 LED |
| 74AHCT125 | no | no necesario | no | Pendiente de instalar | Seleccionado para dato LED |
| MQTT | no validado | si | no | Bloqueado por integracion/aprovisionamiento/servidor | Firmware sin `module_id`; servidor 1883 cerrado desde PC |

## Evidencia de sensores

```text
reposo: raw=0x0000
D1:     raw=0x0001
D2:     raw=0x0002
D3:     raw=0x0004
```

El 2026-08-24 se repitieron golpes moderados/fuertes: D1 y D2 quedaron siempre
en su bit, y D3 completo cinco golpes suaves y cinco fuertes como `0x0004`.
El reposo permanecio 60 s en `0x0000`. Hubo transitorios multibit `0x0006` y
`0x0007` antes de las rondas finales que no pudieron reproducirse; quedan bajo
observacion durante el ajuste de sensibilidad y la prueba larga.

## Evidencia LED

Prueba individual de las tres filas, 2026-08-24:

```text
D1/D4/D7: rojo, 24 LED por aro
D2/D5/D8: azul, 24 LED por aro
D3/D6/D9: verde, 24 LED por aro
solo un aro encendido en cada paso
LED TEST: fin
```

Prueba integrada sensor -> HC165 -> estado -> aro, 2026-08-24:

```text
D1: raw=0x0001 -> aro D1 verde -> rearmado a 1 s
D2: raw=0x0002 -> aro D2 verde -> rearmado a 1 s
D3: raw=0x0004 -> aro D3 verde -> rearmado a 1 s
```

Los tres casos llegaron con `count=1`; no se encendio un aro vecino. IDENTIFY
tambien se valido en ejecucion: `GPIO17=LOW` activa el barrido cian en los nueve
aros y `HIGH` restaura el estado anterior.

## Evidencia W5500

```text
W5500 DIAG OFICIAL: CS=10 MOSI=11 SCLK=12 MISO=13
RESET=NC INT=NC polling=10ms SPI mode=0 clock=1MHz
esp_eth_start: ESP_OK
LINK=UP
DHCP IP=192.168.1.168 MASK=255.255.255.0 GW=192.168.1.1
```

El firmware completo a 5 MHz muestra `W5500 SPI=OK`. El reinicio observado unos
2 s despues de arrancar el driver se aislo a un desbordamiento de pila en el
autodiagnostico, no al W5500. Tras mover los buffers JSON grandes al heap y
ampliar `app_main` a 8192 bytes, la imagen completa quedo estable mas de un
minuto con `LINK=DOWN`, resultado esperado porque el RJ45 estaba desconectado.

El 2026-08-24 se flasheo de nuevo la imagen completa de operacion, con
`DIANA_BENCH_HIT_LED_TEST` desactivado. Permanecio estable mas de seis minutos
con todas las tareas activas, secuencia D1-D9 completa, varias pulsaciones
IDENTIFY y multiples golpes en D1-D3. No hubo reinicios, watchdog, errores de
memoria ni fallos del W5500. `LINK=DOWN` y MQTT deshabilitado eran esperados por
no haber switch ni `module_id` aprovisionado.

## No validado

- 1 h con 9 sensores y 216 LED.
- Repetir durante 1 h la busqueda de snapshots multibit en D1-D3.
- D4-D9 con sensores reales.
- Corriente LED y caida de tension por fila.
- Diez arranques consecutivos del W5500 sin `VERSIONR=0x00`.
- Firmware completo estable con Ethernet durante al menos 1 h.
- DHCP/SNTP/MQTT en firmware completo; DHCP solo esta validado en imagen minima.
