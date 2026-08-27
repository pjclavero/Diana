# Estado de validacion fisica

## Tabla por subsistema

| Subsistema | Montado | Firmware | Hardware real | Estado | Evidencia |
| --- | ---: | ---: | ---: | --- | --- |
| ESP32-S3 | si | si | si | Arranca y flashea | COM6, MAC `10:20:ba:4b:b7:04` |
| W5500 | si | si | si | Arranque repetible tras cablear RSTn a GPIO8 | 10/10 arranques `SPI=OK` + DHCP `192.168.1.168` (2026-08-28) |
| HC165 #1 | si | si | parcial | Incidencia historica | Un primer modulo se calento; sustituido |
| HC165 #2 | si | si | parcial | D1-D3 validados por cascada | Lecturas `0x0001`, `0x0002`, `0x0004` |
| Sensores D1-D3 | si | si | si | Validados parcialmente | DO reposo 0 V, impacto hasta 5 V; raw correcto |
| Sensores D4-D9 | pendiente | si | no | Pendiente | Entradas fijadas a GND en banco parcial |
| Selector SPDT | si | si | parcial | Estado invalido actual | Monitor `GPIO15=1 GPIO16=1` |
| IDENTIFY | si | si | parcial | Libre observado | Monitor `HIGH`; pulsacion LOW pendiente |
| WS2812B | si | si | si | Test de bring-up ejecutado | 9 aros, 3 cadenas de 72 LED |
| 74AHCT125 | no | no necesario | no | Pendiente de instalar | Seleccionado para dato LED |
| MQTT | no validado | si | no | Bloqueado por integracion/aprovisionamiento/servidor | Firmware sin `module_id`; servidor 1883 cerrado desde PC |

## Evidencia de sensores

```text
reposo: raw=0x0000
D1:     raw=0x0001
D2:     raw=0x0002
D3:     raw=0x0004
```

## Evidencia LED

Bring-up:

```text
LED TEST: rojo
LED TEST: verde
LED TEST: azul
LED TEST: blanco tenue
LED TEST: aro 1
LED TEST: aro 2
LED TEST: aro 3
LED TEST: fin
```

## Evidencia W5500

```text
W5500 DIAG OFICIAL: CS=10 MOSI=11 SCLK=12 MISO=13
RESET=NC INT=NC polling=10ms SPI mode=0 clock=1MHz
esp_eth_start: ESP_OK
LINK=UP
DHCP IP=192.168.1.168 MASK=255.255.255.0 GW=192.168.1.1
```

Historico: en el firmware completo a 5 MHz se observo `W5500 SPI=OK` seguido
de un reinicio dentro del temporizador de FreeRTOS unos 2 s despues de arrancar
el driver, y se reprodujo `VERSIONR=0x00` tras reflasheos sin cortar la
alimentacion independiente del W5500.

Resuelto 2026-08-28 al cablear RSTn a GPIO8 y pulsarlo desde el firmware. Diez
arranques consecutivos con reset por RTS:

```text
ciclo  1..10: SPI=OK   IP=192.168.1.168
RESULTADO: 10/10 arranques con W5500 SPI=OK
```

Sin `reset timeout` y sin `StoreProhibited` en ninguno de los diez ciclos.
Desde el PC de banco, la MAC `10-20-ba-4b-b7-07` aparece en la tabla ARP y
coincide con la que reporta el netif del ESP32-S3.

## No validado

- 1 h con 9 sensores y 216 LED.
- D4-D9 con sensores reales.
- Corriente LED y caida de tension por fila.
- Firmware completo estable con Ethernet durante al menos 1 h.
- Perdida de paquetes: 3 de 60 pings (5 %) sin explicar.
- SNTP/MQTT; DHCP solo esta validado en imagen minima.
- Selector en estado PRINCIPAL/SATELITE.
- Pulsacion IDENTIFY LOW.
