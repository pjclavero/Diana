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

### H4 - W5500 `VERSIONR=0x00`

Estado: abierto.

Evidencia: con W5500 en switch LAN y alimentado, firmware con reset explicito y
SPI a 5 MHz sigue leyendo `0x00`; LEDs RJ45 apagados.

Accion: comprobar si se esta alimentando por el pin correcto del modulo
comercial. La documentacion local previa indica pines 5 V y 3.3 V; el chip
W5500 trabaja a 3.3 V, asi que el pin 5 V solo es valido si la placa portadora
tiene regulador. Confirmar GND comun, RST, CS, MOSI/MISO/SCK, modelo exacto del
modulo y puerto/cable/switch.

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
