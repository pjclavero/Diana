# Alimentacion y niveles logicos

Este documento separa alimentacion de nivel logico. Un modulo alimentado a 5 V
no implica automaticamente que todas sus senales sean 5 V.

## Resumen

| Subsistema | Alimentacion | Nivel logico | Estado |
| --- | --- | --- | --- |
| ESP32-S3 devboard | USB/rail de placa | 3.3 V | Confirmado por uso |
| W5500 | 3.3 V chip; modulo con pines 5 V y 3.3 V segun doc local | SPI 3.3 V | No validado |
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
