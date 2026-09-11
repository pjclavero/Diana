# Pendientes reales del prototipo V1

## P0 - Riesgo electrico / no alimentar sin revisar

### H1 - Incidencia termica 74HC165

Estado: parcialmente mitigada.

Evidencia: un primer 74HC165 se calento durante banco; se reemplazaron los
componentes antes de continuar. D1-D3 funcionan, pero falta prueba larga y D4-D9
con sensores reales.

Accion: verificar temperatura de ambos 74HC165 con todos los canales conectados.

### H2 - Nivel DO y divisores

Estado: SUPERADO el 2026-09-09 --- las nueve dianas responden con bit unico
(`0x001`..`0x100`, active-high) y 220 activaciones analizadas sin atribucion
cruzada. Falta unicamente confirmar con voltimetro los valores de divisor
montados en D4-D9. Evidencia: `docs/firmware/evidence/`
`2026-09-09-physical-3x3-f273ec0/`.

Evidencia D1-D3: DO reposo 0 V, impacto hasta 5 V, divisor instalado y lectura
HC165 correcta.

Accion residual: confirmar con voltimetro los valores de divisor realmente
montados en D4-D9. Ya estan conectadas y validadas por lectura; lo que falta
es cerrar la documentacion de fabricacion, no habilitarlas.

### H3 - Entradas HC165 libres

Estado: documentadas como no flotantes.

Evidencia: D4-D9 se indicaron a GND en banco parcial.

Accion: verificar fisicamente cada entrada libre y SER_IN.

### H12 - Fallo real de sensores no reproducido (SENSOR_POWER_RELIABILITY)

Estado formal:

```text
SENSOR_POWER_RELIABILITY = REAL_FAULT_CONFIRMED
ROOT_CAUSE               = UNKNOWN
REPRODUCED               = NO
RESIDUAL_RISK            = MONITORED
```

Evidencia: el 2026-09-09, antes de la prueba de crosstalk, los nueve sensores
dejaron de responder. El operador lo detecto por el indicador correcto --- el LED
del propio modulo sensor NO se encendia al golpear ---, de modo que no fue un
diagnostico erroneo del sintoma. Se recupero desconectando y reconectando la
alimentacion de 5 V. El log muestra que el ESP32 no se reinicio y que el HC165
siguio leyendo, luego el fallo vivio enteramente en el dominio de 5 V.

Descartado con evidencia: software (uptime continuo y tarea registrando), HC165
congelado (devolvia lecturas validas), ESP32 (sin reset ni panic), dominio de
3,3 V (3,27 V medidos en ambos registros), e infradimensionado del convertidor
(los aros estaban apagados: la carga era de ~200 mA, un buck de 3 A no protege
ahi). Son cuatro ramas eliminadas, no descartadas por correlacion.

**La causa raiz es DESCONOCIDA.** Lo que sigue son hipotesis no confirmadas, y
no deben citarse como causa en ningun informe posterior:

- contacto intermitente en el conector entre la fuente y el Mini-560;
- contacto intermitente en el ramal de 5 V de los sensores;
- fallo propio del Mini-560.

Las tres encajan con que el fallo ocurriera a carga baja y se resolviera
reasentando conectores, que es la firma clasica de un mal contacto. Encajar no
es demostrar: ninguna se ha reproducido ni medido. Cerrar este punto exige
reproduccion o medida en el estado de fallo, no plausibilidad.

No reproducido en ~9 min de pruebas posteriores (37 activaciones registradas el
2026-09-10 sin tocar nada). **Riesgo residual vigente.**

Accion: al reaparecer, NO reciclar la alimentacion. Capturar antes tension en el
conector del sensor, tension a la salida del Mini-560, tension de entrada de
12 V, y estado de LEDs y Ethernet. Revisar ademas el Mini-560 por fallo propio.

### H13 - Convertidor 12->5 V infradimensionado

Estado: **abierto, bloqueante para partida real**.

Evidencia: el banco monta un **Mini-560 declarado de 3 A** alimentando un rail de
5 V unico compartido por 216 WS2812B y 9 sensores.
`hardware/electronics/calculations/01-presupuesto-potencia-led.md` calcula
`I_total_pico = 4,320 A (LED) + 0,550 A (logica) = 4,870 A` y concluye
literalmente «Se exige 6 A como minimo».
`hardware/electronics/bom/bom-modulo-3x3-preliminar.csv:4` especifica «Buck
sincrono 12V->5V >=6 A» con «eff >= 0.93 OBLIGATORIO». En pico de diseno el
convertidor montado iria al 162 % de su regimen nominal.

Con el tope de brillo por defecto (`DIANA_DEFAULT_BRIGHTNESS_MAX = 120`), el
estado `safe` --- los nueve aros en azul a la vez --- ya estima ~2,7 A, al borde
de los 3 A. Es el riesgo `riesgos.md:21` («Sobreconsumo LED -> reset o calor»,
ALTO, marcado MITIGADO EN DISENO con la validacion C1 nunca ejecutada).

Este hallazgo es independiente de H12: no explica aquel fallo.

Decision del operador (2026-09-10): **partir cargas, no sumarlas**. Dos
convertidores de tension fija en paralelo no reparten corriente --- sin droop ni
current sharing, el de salida ligeramente mas alta se lleva toda la carga hasta
entrar en proteccion --- y anaden un modo de fallo nuevo. Se implementa en su
lugar la separacion que ya exige `riesgos.md` R-09:

```text
Mini-560 #1 -> +5V_LED  -> 216 WS2812B
Mini-560 #2 -> +5V_LOG  -> 9 sensores (y VIN del ESP32 en producto)
GND comun entre ambos y con el ESP32 (el dato WS2812B se referencia a esa masa)
```

**La separacion NO cierra este pendiente.** Dos Mini-560 en railes separados son
una **solucion de banco**: reducen el acoplamiento entre la carga conmutada de
los LED y la alimentacion de los sensores, y permiten seguir validando. No
sustituyen el requisito de potencia del producto:

```text
H13 = OPEN / BLOCKING para producto, tambien despues del cambio
BENCH_MITIGATION = dos Mini-560 en railes separados (+5V_LED / +5V_LOG)
FINAL_REQUIREMENT = sin satisfacer: BOM exige buck 12->5 V >= 6 A, eff >= 0.93
```

Motivo tecnico, no formalismo: la rama de LED por si sola puede acercarse o
superar los 3 A. El presupuesto de potencia atribuye **4,320 A solo a los LED**;
cuanto de eso se ve realmente depende de la politica de brillo y del estado de
partida, y **no esta medido**. Un Mini-560 de 3 A alimentando los 216 WS2812B
puede quedarse corto igual que antes, solo que ahora sin arrastrar consigo a los
sensores.

Accion: montar la separacion con GND comun, mantener el tope de brillo, y
**medir la corriente real de la rama +5V_LED** con los nueve aros en el estado
mas exigente que permita el firmware, antes de dimensionar la fuente definitiva.

Gate corto obligatorio tras el cambio, antes de tocar VERSIONR o iniciar
ENDURANCE:

```text
1. alimentacion  : tension en +5V_LED y en +5V_LOG, en reposo y con LED activos
2. INPUT_D1_D9   : las nueve entradas, bit unico
3. impactos      : sanity D1-D9 con correlacion activaciones/cola
4. crosstalk     : sanity corto sobre una diana central
```

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

Estado: SUPERADO el 2026-09-09 --- D4-D9 instaladas y validadas fisicamente
(bit unico y sin falsos positivos en ~341 s de reposo acumulado). Se conserva
la entrada por trazabilidad.

Accion: ninguna. Cumplido y verificado; ver H2 para el residual de
documentacion de valores de divisor.

### H14 - La topologia de alimentacion del banco no es representativa

Estado: abierto, no bloqueante para la validacion fisica en curso.

Evidencia: en banco el ESP32 se alimenta por USB, de modo que su LDO mantiene
vivos ESP32, HC165 y W5500 aunque el rail de 5 V se hunda. Demostrado el
2026-09-09: se reciclo el 5 V con el firmware corriendo y no hubo reinicio
(uptime continuo en `crosstalk-d5.log`). En el producto no hay USB y el ESP32
colgara del rail de 5 V por VIN.

Consecuencia: el banco es **mas tolerante que el producto**, y una ENDURANCE
ejecutada asi no ejercita el modo de fallo mas probable en campo --- colapso del
5 V arrastrando tambien la logica. Cualquier resultado de estabilidad obtenido
con USB conectado debe declarar este sesgo.

Accion: repetir la prueba de estabilidad con el ESP32 alimentado desde el rail,
sin USB, antes de declarar validacion representativa del producto.
