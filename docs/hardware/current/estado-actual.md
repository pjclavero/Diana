# Estado actual y relevo del prototipo V1

Fecha de corte: 2026-08-24.

Este documento permite continuar el trabajo sin depender del historial de la
sesion. Para detalles electricos y evidencias, seguir los enlaces de
[README.md](README.md). Si un documento historico contradice esta carpeta,
prevalece `docs/hardware/current/`.

## Firmware actualmente flasheado

- Imagen completa de operacion ESP-IDF 5.5, no la imagen de diagnostico.
- `DIANA_BENCH_HIT_LED_TEST` desactivado.
- Puerto usado: COM6. MAC observada: `10:20:ba:4b:b7:04`.
- SHA-256 de la imagen flasheada:
  `5F1BF2DB93D63FE2AA3EF4821069F746C39EE5A4F3DAB11F512202FCBB8D5394`.
- Estabilidad observada durante mas de seis minutos con todas las tareas,
  golpes D1-D3 e IDENTIFY: sin reinicios, watchdog ni errores de memoria.

## Hardware montado

| Subsistema | Montaje actual |
| --- | --- |
| Control | 1 ESP32-S3 devboard; revision comercial exacta sin identificar |
| Ethernet | 1 modulo W5500 RJ45; SPI GPIO10-13; RST e INT sin conectar |
| Entradas | 2 x 74HC165 a 3.3 V |
| Sensores | Solo D1, D2 y D3, a 5 V; DO con 10k serie y 18k a GND |
| Entradas restantes | D4-D9 fijadas a GND; no hay sensores instalados |
| Iluminacion | 9 aros WS2812B de 24 LED, tres cadenas de 72 LED |
| Mandos | Selector SPDT en GPIO15/16 e IDENTIFY en GPIO17 |
| Adaptador LED | 74AHCT125 seleccionado, todavia no instalado |

## Validado fisicamente

- D1, D2 y D3 producen respectivamente `0x0001`, `0x0002` y `0x0004`; reposo
  estable en `0x0000`. Los dos 74HC165 mantienen temperatura normal con los
  divisores instalados.
- Los nueve aros, sus 24 LED y el orden D1-D9 fueron comprobados uno a uno.
  D1-D3 tambien completaron el recorrido sensor -> HC165 -> aro -> rearme.
- Selector: `0/1=PRINCIPAL` y `1/0=SATELITE`.
- IDENTIFY: LOW al pulsar, HIGH al soltar y barrido cian en los nueve aros.
- W5500: la imagen minima basada en el ejemplo oficial obtuvo enlace y DHCP
  `192.168.1.168`. La imagen completa reconoce SPI a 5 MHz y permanece estable;
  su prueba DHCP/MQTT sigue pendiente por falta de red y aprovisionamiento.

## No instalado o no validado

- Sensores, divisores y recorrido completo D4-D9.
- 74AHCT125 para elevar a 5 V las tres lineas de datos LED.
- Consumo maximo, caida de tension por fila y prueba de 216 LED en carga.
- Modelo/revision exactos de la devboard ESP32-S3 y del modulo W5500.
- DHCP, SNTP y MQTT con el firmware completo y el servidor real.
- Identidad `module_id` y credenciales MQTT provisionadas en NVS.
- Diez arranques consecutivos y una hora de funcionamiento continuo.
- OTA A/B firmada de extremo a extremo en hardware.

## Firmware terminado para el alcance montado

- Perfil DO-only, lectura en cascada de dos 74HC165 y polaridad active-high.
- Mapeo de tres cadenas LED y nueve dianas.
- Lectura en ejecucion del selector e IDENTIFY con antirrebote de 60 ms.
- Secuencia de arranque por aro y modo opcional de banco sensor -> LED.
- Driver W5500 por SPI, enlace/IP, SNTP, MQTT, cola persistente y logica OTA.
- Correccion del desbordamiento de pila del autodiagnostico: buffers grandes en
  heap y pila de `app_main` de 8192 bytes.
- Proyecto reutilizable de diagnostico W5500 en
  `firmware/esp32/diagnostics/w5500_minimal/`.

## Siguientes pasos recomendados

1. Aprovisionar `module_id`, URI y credenciales MQTT en NVS mediante un proceso
   repetible y documentado.
2. Conectar switch y servidor; validar DHCP, SNTP, MQTT, Last Will, comandos,
   eventos de impacto, ACK y vaciado de cola tras reconexion.
3. Ejecutar diez ciclos de alimentacion y una prueba continua de una hora con
   Ethernet, IDENTIFY y golpes D1-D3.
4. Instalar D4-D9 con sus divisores, medir cada DO y repetir bit unico,
   temperatura, falsos positivos y recorrido sensor -> aro.
5. Instalar el 74AHCT125 y medir alimentacion LED, consumo y caida de tension.
6. Ejecutar la suite host en Linux/WSL y ratificar con backend la divergencia de
   caducidad documentada en `firmware/esp32/README.md`.
7. Validar OTA firmada y rollback sobre las particiones A/B reales.
