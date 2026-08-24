# Pendientes reales del prototipo V1

## P0 - Riesgo electrico / no alimentar sin revisar

### H1 - Incidencia termica 74HC165

Estado: cerrada para el montaje D1-D3 el 2026-08-24.

Evidencia: el calentamiento aparecio cuando la salida DO de sensores alimentados
a 5 V llegaba directamente al 74HC165 alimentado a 3.3 V. Con los divisores
resistivos instalados en D1-D3, ambos 74HC165 mantienen temperatura normal y las
lecturas son correctas.

Accion restante: repetir la comprobacion termica al instalar D4-D9.

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

### H4 - W5500: repetibilidad de arranque y prueba de red completa

Estado: integracion FreeRTOS corregida; validacion larga abierta.

Evidencia positiva: la imagen minima basada en el ejemplo ESP-IDF obtuvo
`SPI=OK`, `LINK=UP` y DHCP `192.168.1.168`. El firmware completo detecto el
W5500 a 5 MHz tras cortar su alimentacion.

Evidencia 2026-08-24: el reinicio del firmware completo era un desbordamiento
de pila en el autodiagnostico. Corregido con buffers JSON en heap y pila de
`app_main` de 8192 bytes; el firmware completo queda estable y reconoce el
W5500 a 5 MHz con el RJ45 desconectado.

Accion: conectar RJ45, repetir DHCP con la imagen completa, medir 3.3 V en
carga, ejecutar diez ciclos de alimentacion y validar una hora continua. RST e
INT quedan NC; CS/MOSI/SCK/MISO son GPIO10-13.

### H5 - Servidor LAN sin puertos TCP

Estado: abierto.

Evidencia: `192.168.1.209` responde a ping desde PC, pero no acepta TCP en
`1883`, `8080`, `80`, `22`, `443`, `8443`, `9001`.

Accion: levantar/exponer Mosquitto/panel o actualizar configuracion de destino.

### H6 - Selector SPDT

Estado: cerrado el 2026-08-24.

Evidencia: ambas posiciones fisicas capturadas en monitor:
`GPIO15=0/GPIO16=1 = PRINCIPAL` y `GPIO15=1/GPIO16=0 = SATELITE`.

Accion restante: ninguna para el selector SPDT actual.

### H7 - IDENTIFY

Estado: cerrado el 2026-08-24.

Evidencia: `GPIO17=LOW` capturado al pulsar y `HIGH` al soltar. El pulsador
activa en ejecucion el barrido cian IDENTIFY en los nueve aros. Se anadio
antirrebote de 60 ms tras observar rebote mecanico en el primer registro.

Accion restante: ninguna.

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

## P3 - Firmware e integracion

### F1 - Aprovisionamiento

Estado: abierto. Falta cargar `module_id`, URI y credenciales MQTT en NVS con
un procedimiento repetible.

### F2 - Red completa y servidor

Estado: abierto. Validar en la imagen completa DHCP, SNTP, MQTT, Last Will,
comandos, eventos, ACK y vaciado de cola tras reconexion.

### F3 - Pruebas de duracion

Estado: abierto. Ejecutar diez ciclos de alimentacion y una hora continua con
Ethernet y actividad de entradas/LED.

### F4 - Suite host y contrato

Estado: abierto en este Windows. Ejecutar `make -C firmware test` en Linux/WSL
y ratificar el limite de `expires_in_ms` descrito en el README del firmware.

### F5 - OTA real

Estado: abierto. Validar descarga, firma, cambio A/B, confirmacion y rollback en
el hardware final.
