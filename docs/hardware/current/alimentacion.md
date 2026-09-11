# Alimentacion y niveles logicos

Este documento separa alimentacion de nivel logico. Un modulo alimentado a 5 V
no implica automaticamente que todas sus senales sean 5 V.

## Resumen

| Subsistema | Alimentacion | Nivel logico | Estado |
| --- | --- | --- | --- |
| ESP32-S3 devboard | USB/rail de placa | 3.3 V | Confirmado por uso |
| W5500 | Fuente externa de 3.3 V durante la prueba; chip 3.3 V | SPI 3.3 V | Funcionamiento parcial validado |
| 74HC165 | 3.3 V | 3.3 V | Confirmado por firmware/banco |
| Sensores piezo | 5 V en D1-D3 | DO medido 0-5 V antes de divisor | D1-D3 confirmado |
| Divisores DO | Pasivo desde DO | Salida a HC165 segura para 3.3 V | D1-D3 validado por lectura |
| WS2812B | 5 V | dato 5 V recomendado | 9 aros conectados |
| 74AHCT125 | 5 V lado salida | entrada 3.3 V, salida 5 V | Seleccionado, no instalado |

## ESP32-S3

El ESP32-S3 trabaja a 3.3 V logicos. Durante banco se programa y monitoriza por
USB en COM6.

## W5500

El chip W5500 trabaja alimentado a 3.3 V y con logica SPI a 3.3 V. La
documentacion local previa dice que el modulo fisico dispone de alimentacion
5 V y 3.3 V, pero el modulo comercial exacto sigue pendiente de identificar.

La documentacion generica de WIZnet para W5500/W5500-io indica alimentacion
3.3 V nominal. Si el modulo comprado acepta 5 V, esa entrada debe pertenecer a
la placa portadora/regulador, no al chip W5500 desnudo.

Regla de banco: no conectar 5 V y 3.3 V a la vez salvo confirmacion explicita
del datasheet/serigrafia del modulo comprado.

Prueba 2026-08-24: con alimentacion independiente y GND comun, el W5500 alcanzo
`LINK=UP` y obtuvo `192.168.1.168` por DHCP. El resultado confirma que el
modulo puede funcionar con el bus actual, pero no cierra el presupuesto de
potencia: tras reflasheos aparecio de nuevo `VERSIONR=0x00` hasta cortar la
alimentacion del modulo. Medir 3.3 V directamente en VCC-GND y repetir bajo
carga antes de decidir si puede alimentarse desde el regulador del ESP32.

Comprobaciones pendientes:

```text
VCC-GND del modulo
3V3-GND si se alimenta por 5V
RST-GND tras arranque
LED link RJ45 y LED del switch
```

## 74HC165

Los 74HC165 se alimentan a 3.3 V. No deben recibir DO de 5 V directamente.

## Sensores DO

Los sensores D1-D3 se probaron alimentados a 5 V. Se midio:

```text
reposo: 0 V
impacto: hasta 5 V
```

Por eso el firmware usa `DIANA_DO_ACTIVE_HIGH` y el camino fisico necesita
adaptacion a 3.3 V antes del 74HC165.

## Divisores resistivos

D1-D3 usan divisor resistivo por canal. El valor recomendado en banco fue
10 k / 18 k (E12), pero los valores fisicamente montados deben confirmarse
antes de cerrar documentacion de fabricacion.

## Aros WS2812B

Los aros se alimentan a 5 V por rail de potencia. Los GPIO4/5/6 solo entregan
dato; no alimentan aros.

## 74AHCT125

El 74AHCT125 esta seleccionado para adaptar dato LED:

```text
ESP32 3.3 V -> 74AHCT125 alimentado a 5 V -> WS2812B data 5 V
```

Estado: pendiente de instalar.

## Arquitectura de alimentacion MEDIDA en banco (2026-09-10)

Hasta esta fecha este documento y `componentes.md:19` decian «Separar railes;
pendientes de medicion». Esto es la medicion.

```text
transformador 12 V / 12 A
        |
        +--> Mini-560 (declarado 3 A) --> RAIL 5 V UNICO --+--> 9 aros WS2812B (216 LED)
                                                           +--> 9 sensores piezo DO
        (dominio ELECTRICAMENTE INDEPENDIENTE durante el banco)
USB del portatil --> ESP32-S3 --> LDO 3V3 --+--> 74HC165 #1 y #2
                                            +--> W5500
```

Medido con multimetro, modulo alimentado y en reposo:

| Punto | Esperado | Medido | Resultado |
|---|---|---|---|
| 74HC165 #1, VCC-GND | 3,20-3,40 V | **3,27 V** | OK |
| 74HC165 #2, VCC-GND | 3,20-3,40 V | **3,27 V** | OK |

Ambos registros comparten alimentacion desde el pin 3V3 de la placa ESP32, sin
caida apreciable entre uno y otro.

### Los dos dominios son independientes: demostrado, no supuesto

Durante la sesion del 2026-09-09 se reciclo la alimentacion de 5 V con el
firmware corriendo. El log de consola (`docs/firmware/evidence/`
`2026-09-09-physical-3x3-f273ec0/crosstalk-d5.log`) no contiene ningun reinicio
en ese momento: el uptime es continuo `8977 -> 52448 -> 55140 ms` y el HC165
siguio leyendo. El ESP32, el HC165 y el W5500 no se enteraron.

Efecto secundario util: al devolver el 5 V, los nueve comparadores arrancan y
sus salidas DO pasan brevemente a alto. Eso produce `raw=0x01ff` (nueve canales)
seguido de `raw=0x019f`. **No es diafonia**: un impacto doble real produce DOS
bits (`raw=0x0003` = D1+D2, observado el 2026-09-10). El firmware rechaza ambos
por MULTI_TRIGGER y no genera ningun evento, de modo que un transitorio de
alimentacion no inventa puntuaciones.

### Esta independencia es un artefacto del banco, NO del producto

En banco el ESP32 va por USB, asi que su LDO mantiene vivos ESP32, HC165 y W5500
pase lo que pase en el rail de 5 V. **En el producto no hay USB**: el ESP32 se
alimentara del rail de 5 V por VIN y su LDO colgara de ahi. Con esa topologia un
hundimiento del 5 V arrastra tambien la logica, y el sintoma deja de ser «los
sensores no responden» para pasar a «el modulo se reinicia».

Consecuencia directa: toda evidencia de estabilidad obtenida con USB conectado
--- incluida una futura ENDURANCE --- **no ejercita el modo de fallo mas probable
en campo**. Debe declararse al usarla. Ver `pendientes.md` H14.

### Punto ciego de diagnostico: `raw=0x0000` es ambiguo

Si el 74HC165 pierde alimentacion o muere, la linea DATA queda a nivel bajo y el
firmware lee `0x0000`, que es **identico** a «ninguna diana golpeada». No existe
bit canario: el `SER_IN` del primer HC165 esta a nivel fijo bajo
(`conexionado.md`), asi que no delata nada.

El indicador fiable en banco es el **LED del propio modulo sensor**: se alimenta
del VCC del sensor, de modo que encenderse demuestra a la vez que el sensor tiene
5 V y que ha disparado. Es el observable que hay que mirar, no los aros: golpear
NO enciende ningun aro en la imagen de operacion (requiere
`CONFIG_DIANA_BENCH_HIT_LED_TEST`, desactivado).
