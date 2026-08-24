# Componentes del prototipo V1 real

Este documento enumera los modulos y piezas del prototipo fisico actual. No es
la BOM de la PCB futura.

## Inventario resumido

| Ref. | Componente | Cantidad | Uso | Estado |
| --- | --- | ---: | --- | --- |
| U1 | ESP32-S3 devboard | 1 | Controlador | Montado; modelo exacto pendiente |
| U2 | Modulo W5500 con RJ45 | 1 | Ethernet | Imagen minima con SPI/link/DHCP; imagen completa estable con SPI |
| U3-U4 | Modulos SN74HC165 / 74HC165 | 2 | Lectura DO por registro paralelo-serie | Montados; D1-D3 validados |
| S1-S9 | Modulos piezo comerciales V/G/AO/DO | 9 objetivo; D1-D3 conectados | Impacto DO-only | D1-D3 validados con divisor; D4-D9 pendientes |
| L1-L9 | Aro WS2812B 24 LED | 9 | Senalizacion luminosa | Conectados; test de slots ejecutado |
| SW1 | Selector SPDT 2 posiciones | 1 | Modo principal/satelite | PRINCIPAL y SATELITE validados |
| SW2 | Pulsador momentaneo | 1 | IDENTIFY | LOW/HIGH y barrido cian validados |
| U5 | 74AHCT125 / 74AHCT125N | 1 | Adaptacion dato LED 3.3 V -> 5 V | Seleccionado, no instalado |
| R-D1..R-D3 | Divisor resistivo DO | 3 instalados; faltan 6 para D4-D9 | Adaptar DO de sensor a 3.3 V | 10k + 18k E12 confirmados 2026-08-24; D1-D3 validados |
| PSU/DC | Alimentacion externa | segun banco | Energia ESP32/sensores/LED/W5500 | Separar railes; pendientes de medicion |

## U1 - ESP32-S3 devboard

Nombre funcional: controlador del modulo Diana.

Modelo/chip conocido: ESP32-S3.

Tipo de modulo comercial: devboard, revision exacta pendiente de identificar.

Cantidad: 1.

Alimentacion: por USB durante flash/monitor; resto de alimentacion del banco
segun montaje. No usar esta nota para dimensionar la fuente final.

Nivel logico: 3.3 V.

Interfaces usadas: GPIO, SPI2, RMT/LED strip, USB serie.

Estado de validacion: arranca, flashea por COM6 y ejecuta firmware; MAC
observada `10:20:ba:4b:b7:04`.

Pendiente: identificar devboard exacta y revisar posible conflicto GPIO48/RGB.

## U2 - Modulo W5500 RJ45

Nombre funcional: Ethernet.

Modelo/chip conocido: W5500.

Tipo de modulo comercial: modulo W5500 preensamblado con RJ45.

Cantidad: 1.

Alimentacion: la documentacion local previa indica que el modulo fisico expone
pines 5 V y 3.3 V. El chip/modulo WIZnet trabaja a 3.3 V; si se usa el pin 5 V
de un modulo comercial debe confirmarse que esa entrada pasa por regulador. No
alimentar 5 V y 3.3 V a la vez salvo que la serigrafia/datasheet exacta lo
confirme.

Nivel logico SPI: 3.3 V.

Interfaces: SPI, RST, INT, RJ45.

Pines usados: ver [ethernet-w5500.md](ethernet-w5500.md).

Estado de validacion: la imagen minima basada en el ejemplo oficial de ESP-IDF
valido SPI, enlace y DHCP `192.168.1.168`. La imagen completa reconoce el W5500
a 5 MHz y permanece estable con `LINK=DOWN` cuando no hay RJ45. En algun
arranque anterior se observo `VERSIONR=0x00`, recuperado tras cortar y restaurar
la alimentacion del modulo; falta probar repetibilidad, DHCP y MQTT con la
imagen completa.

Referencia comercial: PENDIENTE. No se ha localizado URL de tienda ni item ID en
el repo. Referencia tecnica generica: WIZnet W5500/W5500-io, no equivalente a
variante comercial comprada.

## U3-U4 - 2 x 74HC165

Nombre funcional: lectura de sensores DO.

Chip conocido: SN74HC165 / 74HC165.

Cantidad: 2 modulos.

Alimentacion: 3.3 V.

Nivel logico: 3.3 V.

Interfaces: DATA, LOAD, CLK; cascada entre modulos.

Estado de validacion: D1, D2 y D3 se capturaron como `0x0001`, `0x0002` y
`0x0004`, volviendo a `0x0000`. D4-D9 pendientes con sensores reales.

Incidencia historica: un primer 74HC165 se calento al recibir directamente el
DO de 5 V con el integrado alimentado a 3.3 V. Se sustituyo y se instalaron
divisores resistivos en D1-D3; ambos integrados mantienen temperatura normal.

## S1-S9 - Sensores piezo comerciales

Tipo: modulo piezo comercial con pines `V`, `G`, `AO`, `DO`.

Uso en Diana: `DO` exclusivamente.

AO: NO CONECTADO.

Alimentacion: 5 V en la prueba de banco de D1-D3.

DO medido: reposo 0 V; impacto hasta 5 V en la evidencia de banco disponible.

Adaptacion: divisor resistivo en D1-D3. El conversor bidireccional MOSFET se
descarto para DO porque sus pull-ups dejaban la linea alta en reposo.

Estado: D1-D3 validados; D4-D9 pendientes.

## L1-L9 - Aros WS2812B

Cantidad: 9 aros.

LED por aro: 24.

Total por modulo: 216 LED.

Alimentacion: 5 V.

Dato: WS2812B, nivel logico 5 V recomendado. El 74AHCT125 esta seleccionado
para adaptar desde 3.3 V, pero no instalado.

Estado: los 9 aros estan conectados; el firmware inicializa 3 cadenas de 72 LED
y ejecuta test RGB/slots.

## SW1 - Selector SPDT

Tipo: SPDT de 2 posiciones, 3 terminales: `1 / COM / 2`.

Cableado esperado: `1 -> GPIO15`, `COM -> GND`, `2 -> GPIO16`.

Firmware: entradas con pull-up.

Estado validado: `GPIO15=0/GPIO16=1` selecciona PRINCIPAL y
`GPIO15=1/GPIO16=0` selecciona SATELITE.

AUTO: no disponible en este selector.

## SW2 - IDENTIFY

Tipo: pulsador momentaneo simple.

Cableado esperado: `GPIO17 -> pulsador -> GND`.

Firmware: input pull-up.

Estados: HIGH libre, LOW pulsado.

Estado: LOW/HIGH y activacion del barrido cian en los nueve aros validados.

## U5 - 74AHCT125

Funcion: adaptar dato LED de 3.3 V del ESP32 a 5 V para WS2812B.

Estado: seleccionado, no instalado.

Asignacion prevista: GPIO4, GPIO5 y GPIO6 por tres canales del 74AHCT125.

El firmware no debe depender de su presencia.
