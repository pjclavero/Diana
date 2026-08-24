# Selector e IDENTIFY

## Selector actual

Hardware real:

```text
SPDT
2 posiciones
3 terminales: 1 / COM / 2
```

Cableado esperado:

```text
1   -> GPIO15
COM -> GND
2   -> GPIO16
```

Firmware:

```text
GPIO15 INPUT_PULLUP
GPIO16 INPUT_PULLUP
DIANA_SELECTOR_PROFILE = DIANA_SELECTOR_2_POSITION
```

Estados:

| GPIO15 | GPIO16 | Estado |
| --- | --- | --- |
| LOW | HIGH | PRINCIPAL |
| HIGH | LOW | SATELITE |
| HIGH | HIGH | INVALID_SELECTOR |
| LOW | LOW | INVALID_SELECTOR |

Estado observado en banco:

```text
GPIO15=1
GPIO16=1
mode=INVALID_SELECTOR
```

AUTO no esta disponible con el selector fisico actual. El selector ON-OFF-ON es
un diseno futuro.

## IDENTIFY

Hardware real:

```text
pulsador momentaneo simple
GPIO17 -> pulsador -> GND
```

Firmware:

```text
GPIO17 INPUT_PULLUP
HIGH = libre
LOW  = pulsado
```

Estado observado:

```text
identify: HIGH
```

Pendiente: capturar pulsacion LOW en monitor.
