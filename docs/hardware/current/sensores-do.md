# Sensores DO y lectura 74HC165

## Perfil actual

El prototipo V1 usa sensores digitales DO-only. No usa AO, ADC, amplitud,
envolvente analogica, VREF_TH, ADS1115, ADS7953, MCP3208, MCP6004 externo ni
LM339 externo.

## Sensores

Tipo: modulo piezo comercial con pines:

```text
V
G
AO
DO
```

Uso:

```text
V  -> alimentacion sensor
G  -> GND comun
AO -> NO CONECTADO
DO -> impacto digital
```

D1-D3:

```text
reposo medido: 0 V
impacto medido: hasta 5 V
adaptacion: divisor resistivo
lectura firmware: active-high
```

D4-D9: pendientes de conectar con sensor real; en banco parcial se fijaron a
GND para que no floten.

## Conversor bidireccional MOSFET

No se usa para DO en este prototipo. Se probo y se descarto porque sus pull-ups
dejaban las lineas en alto en reposo.

## 74HC165

Cantidad: 2.

Alimentacion: 3.3 V.

Señales ESP32:

```text
GPIO38 <- DATA
GPIO47 -> LOAD
GPIO48 -> CLK
```

Mapa:

```text
bit 0 = D1
bit 1 = D2
bit 2 = D3
bit 3 = D4
bit 4 = D5
bit 5 = D6
bit 6 = D7
bit 7 = D8
bit 8 = D9
bits 9..15 = reserva
```

## Evidencia de banco

Monitor serie tras instalar divisores en D1-D3:

```text
reposo: raw=0x0000
D1:     raw=0x0001
D2:     raw=0x0002
D3:     raw=0x0004
```

Cada impacto volvio a `raw=0x0000`. Se observo una ventana de reposo sin falsos
positivos.

Prueba repetida 2026-08-24 con el firmware completo:

```text
D1: 5 golpes moderados + 3 fuertes, solo 0x0001
D2: 5 golpes moderados + 3 fuertes, solo 0x0002
D3: 5 golpes suaves + 5 fuertes, solo 0x0004
reposo sin tocar: 60 s en 0x0000
```

Antes de las rondas controladas aparecieron transitorios `0x0006` y `0x0007`
al manipular/golpear D3. Los LED de los modulos D1 y D2 no indicaron impacto y
el fenomeno no se reprodujo en las rondas posteriores, ni siquiera con golpes
fuertes. Se mantiene como observacion para la prueba larga y el ajuste fino de
los potenciometros de sensibilidad; no se modifico el cableado.

Con la imagen completa de operacion se repitieron multiples golpes rapidos en
D1-D3. Predominaron lecturas individuales `0x0001`, `0x0002` y `0x0004`; una
unica muestra `0x0003` aparecio durante la rafaga, indicando solape temporal de
D1 y D2. El firmware la conserva como lectura multicanal para que la logica de
agrupacion la clasifique, sin asignarla silenciosamente a una sola diana.

## Incidencias y limites

- Un primer 74HC165 se calento al recibir directamente el DO de 5 V mientras
  estaba alimentado a 3.3 V. Tras sustituirlo e instalar divisores resistivos
  en D1-D3, ambos 74HC165 mantienen temperatura normal.
- D4-D9 no estan validados con sensores reales.
- Debounce/refractory siguen como `PENDING_PHYSICAL_TUNING`.
- Vigilar si reaparecen snapshots multibit al ajustar los potenciometros.
- Las entradas libres no deben quedar flotantes.
