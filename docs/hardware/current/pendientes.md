# Pendientes reales del prototipo V1

## P0 - Riesgo electrico / no alimentar sin revisar

### H1 - Incidencia termica 74HC165

Estado: parcialmente mitigada.

Evidencia: un primer 74HC165 se calento durante banco; se reemplazaron los
componentes antes de continuar. D1-D3 funcionan, pero falta prueba larga y D4-D9
con sensores reales.

Accion: verificar temperatura de ambos 74HC165 con todos los canales conectados.

### H2 - Nivel DO y divisores

Estado: D1-D3 medidos y validados; D4-D9 pendientes.

Evidencia D1-D3: DO reposo 0 V, impacto hasta 5 V, divisor instalado y lectura
HC165 correcta.

Accion: repetir medida en D4-D9 antes de conectarlos al 74HC165.

### H3 - Entradas HC165 libres

Estado: documentadas como no flotantes.

Evidencia: D4-D9 se indicaron a GND en banco parcial.

Accion: verificar fisicamente cada entrada libre y SER_IN.

## P1 - Bring-up

### H4 - W5500 intermitente e integracion FreeRTOS

Estado: abierto.

Evidencia positiva: la imagen minima basada en el ejemplo ESP-IDF obtuvo
`SPI=OK`, `LINK=UP` y DHCP `192.168.1.168`. El firmware completo detecto el
W5500 a 5 MHz tras cortar su alimentacion.

Evidencia pendiente: despues de algunos reflasheos reaparecio `VERSIONR=0x00`.
Cuando el firmware completo arranca Ethernet, aproximadamente 2 s despues se
reproduce una asercion/`StoreProhibited` en el temporizador de FreeRTOS.

Accion: medir 3.3 V en carga, ejecutar diez ciclos de alimentacion, aislar la
interaccion del temporizador Ethernet con el resto de componentes y validar
una hora continua. RST e INT quedan NC; CS/MOSI/SCK/MISO son GPIO10-13.

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
