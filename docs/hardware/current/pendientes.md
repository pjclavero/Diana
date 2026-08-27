# Pendientes reales del prototipo V1

## P0 - Riesgo electrico / no alimentar sin revisar

### H1 - Incidencia termica 74HC165

Estado: parcialmente mitigada.

Evidencia: un primer 74HC165 se calento durante banco; se reemplazaron los
componentes antes de continuar. D1-D3 funcionan, pero falta prueba larga y D4-D9
con sensores reales.

Accion: verificar temperatura de ambos 74HC165 con todos los canales conectados.

### H2 - Nivel DO y divisores

Estado: D1-D3 medidos y validados con valores confirmados; D4-D9 pendientes.

Evidencia D1-D3: DO reposo 0 V, impacto hasta 5 V, divisor instalado y lectura
HC165 correcta.

Valores confirmados 2026-08-24: serie 10k al DO del sensor y 18k a masa, E12.
Nominal 3.214 V desde 5 V, es decir 86 mV POR DEBAJO de VCC=3.3 V, de modo que el
diodo de proteccion de entrada nunca se acerca a conducir. Peor caso con
tolerancia 5 % y rail de 5.25 V: 3.494 V frente a un maximo absoluto de 3.80 V, y
2.943 V frente a un VIH minimo de 2.31 V.

Se preveia 10k/20k para la version final, pero esa pareja queda 33 mV POR ENCIMA
de VCC y deja solo 190 mV de margen: se recomienda mantener 10k/18k tambien en la
version final, sobre todo con nueve canales y 216 LED cargando la fuente.

CAUSA RAIZ CONFIRMADA del sobrecalentamiento del primer 74HC165: el DO del sensor
entrega 5 V a logica alimentada a 3.3 V. Sin divisor, la corriente por el diodo de
proteccion solo la limita el propio diodo. Con divisor, la impedancia equivalente
de ~6.4 k la acota a ~390 uA incluso si el HC165 arranca sin alimentacion mientras
el sensor ya da 5 V.

Accion: repetir medida en D4-D9 antes de conectarlos al 74HC165. Cada canal DO
necesita SU PROPIO divisor: faltan 6 parejas (12 resistencias). Consumo ~180 uA
por canal y ~1.6 mA con los nueve.

### H3 - Entradas HC165 libres

Estado: documentadas como no flotantes.

Evidencia: D4-D9 se indicaron a GND en banco parcial.

Accion: verificar fisicamente cada entrada libre y SER_IN.

## P1 - Bring-up

### H4 - W5500 intermitente e integracion FreeRTOS

Estado: causa raiz encontrada y corregida. Queda la prueba larga.

CAUSA RAIZ CONFIRMADA 2026-08-28: RSTn del W5500 no lo conducia nadie. El
firmware solo configuraba CS, de modo que GPIO8 quedaba como entrada en alta
impedancia y RSTn -activo a nivel bajo- colgaba de una linea flotante. El
sintoma era `w5500_reset: reset timeout`: el bucle del driver sale en cuanto
lee el bit RST de MR a 0, asi que un timeout significa que MR se leia con ese
bit a 1 permanentemente, es decir MISO sin conducir y el chip fuera del bus.
Concuerda con que la unica recuperacion conocida fuese cortar la alimentacion
del modulo a mano.

Correccion: `diana_pf_net_init` configura GPIO8 como salida y lo pone alto
junto a CS, y pulsa RSTn bajo 5 ms antes del primer acceso SPI. El datasheet
del W5500 exige RSTn bajo >= 500 us. `phy_cfg.reset_gpio_num` se mantiene en
-1 a proposito: el `w5500_reset_hw` de ESP-IDF solo asierta 100 us y suelta el
reset sin margen para el PLL justo antes de `mac->init`.

Evidencia 2026-08-28: diez arranques consecutivos, con reset por RTS entre
cada uno, dieron 10/10 con `W5500 SPI=OK` y DHCP `192.168.1.168`. Ningun
`reset timeout` y ningun `StoreProhibited`: la asercion del temporizador de
FreeRTOS no se reprodujo en ninguno de los diez ciclos.

Pendiente: 3 de 60 pings perdidos (5 %) con latencia 1-11 ms; medir 3.3 V en
carga en VCC-GND del modulo; validar una hora continua. RST esta en GPIO8;
INT sigue NC y el firmware sondea cada 10 ms; CS/MOSI/SCK/MISO son GPIO10-13.

### H5 - Servidor LAN sin puertos TCP

Estado: abierto.

Evidencia: `192.168.1.209` responde a ping desde PC, pero no acepta TCP en
`1883`, `8080`, `80`, `22`, `443`, `8443`, `9001`.

Accion: levantar/exponer Mosquitto/panel o actualizar configuracion de destino.

### H6 - Selector invalido

Estado: abierto.

Evidencia: monitor `GPIO15=1 GPIO16=1`.

Accion: comprobar COM a GND y terminales a GPIO15/GPIO16.

### H7 - IDENTIFY LOW pendiente

Estado: abierto.

Evidencia: monitor `identify: HIGH`; no hay captura de pulsacion.

Accion: pulsar y capturar LOW en monitor.

## P2 - Integracion/mejora futura

### H8 - Instalar 74AHCT125

Estado: seleccionado, no instalado.

Accion: montar 74AHCT125/74AHCT125N para dato WS2812B a 5 V.

### H9 - Identificar devboard ESP32-S3

Estado: abierto.

Accion: documentar serigrafia/revision y verificar GPIO48.

### H10 - Selector ON-OFF-ON / AUTO

Estado: diseno futuro.

Accion: si se quiere recuperar AUTO, cambiar a selector de 3 posiciones y
actualizar firmware/documentacion.

### H11 - Completar D4-D9

Estado: abierto.

Accion: instalar divisores/sensores D4-D9, comprobar bit unico y ausencia de
falsos positivos.
