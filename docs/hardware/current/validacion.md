# Estado de validacion fisica

## Tabla por subsistema

| Subsistema | Montado | Firmware | Hardware real | Estado | Evidencia |
| --- | ---: | ---: | ---: | --- | --- |
| ESP32-S3 | si | si | si | Arranca y flashea | COM6, MAC `10:20:ba:4b:b7:04` |
| W5500 | si | si | parcial | Bloqueado | `VERSIONR=0x00`, LEDs RJ45 apagados |
| HC165 #1 | si | si | parcial | Incidencia historica | Un primer modulo se calento; sustituido |
| HC165 #2 | si | si | parcial | D1-D3 validados por cascada | Lecturas `0x0001`, `0x0002`, `0x0004` |
| Sensores D1-D3 | si | si | si | Validados parcialmente | DO reposo 0 V, impacto hasta 5 V; raw correcto |
| Sensores D4-D9 | pendiente | si | no | Pendiente | Entradas fijadas a GND en banco parcial |
| Selector SPDT | si | si | parcial | Estado invalido actual | Monitor `GPIO15=1 GPIO16=1` |
| IDENTIFY | si | si | parcial | Libre observado | Monitor `HIGH`; pulsacion LOW pendiente |
| WS2812B | si | si | si | Test de bring-up ejecutado | 9 aros, 3 cadenas de 72 LED |
| 74AHCT125 | no | no necesario | no | Pendiente de instalar | Seleccionado para dato LED |
| MQTT | no validado | si | no | Bloqueado por W5500/servidor | No hay IP; servidor 1883 cerrado desde PC |

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
W5500 VERSIONR invalido: esperado 0x04, leido 0x00
Ethernet:
  W5500 SPI=FAIL
  LINK=DOWN
  IP=0.0.0.0
```

## No validado

- 1 h con 9 sensores y 216 LED.
- D4-D9 con sensores reales.
- Corriente LED y caida de tension por fila.
- W5500 con `VERSIONR=0x04`.
- DHCP/SNTP/MQTT.
- Selector en estado PRINCIPAL/SATELITE.
- Pulsacion IDENTIFY LOW.
