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

## Incidencias y limites

- Un primer 74HC165 se calento en una prueba anterior. Fue sustituido.
- D4-D9 no estan validados con sensores reales.
- Debounce/refractory siguen como `PENDING_PHYSICAL_TUNING`.
- Las entradas libres no deben quedar flotantes.
