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

Estados validados en banco el 2026-08-24:

```text
GPIO15=0 GPIO16=1 mode=PRINCIPAL
GPIO15=1 GPIO16=0 mode=SATELITE
```

El firmware actualiza selector y rol en ejecucion tras 3 muestras estables a
20 ms. El estado inicial `1/1` indicaba que, en aquella lectura, ninguna entrada
estaba siendo llevada a GND; no reaparecio al validar ambos extremos.

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

Estados validados en monitor:

```text
libre:   GPIO17=HIGH
pulsado: GPIO17=LOW
```

El pulsador se vigila en ejecucion con antirrebote de 3 muestras a 20 ms. Al
mantenerlo pulsado, los nueve aros muestran el barrido cian IDENTIFY; al soltar,
recuperan su estado anterior. Funcion validada en hardware real el 2026-08-24.
