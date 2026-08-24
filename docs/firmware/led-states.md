# Estados y señalización LED

Referencia normativa: dosier §10.5 y `common.schema.json#/$defs/targetState`.
Implementación: `firmware/esp32/components/diana_core/src/led.c`.
Comprobado en `test_led.c`.

## 1. Regla de accesibilidad

> "No se dependerá exclusivamente del color." — dosier §10.5

Cada estado tiene **color y patrón**. La suite comprueba automáticamente que
ningún par (color, patrón) se repite entre estados: un operario con daltonismo
puede distinguirlos todos por el movimiento.

## 2. Tabla

| Estado (`targetState`) | Color | RGB | Patrón | Periodo | Origen |
|---|---|---|---|---:|---|
| `off` | apagado | 0,0,0 | — | — | |
| `safe` | azul | 0,0,255 | fijo | — | dosier §10.5 |
| `active` | rojo | 255,0,0 | pulso lento | 1200 ms | dosier §10.5 |
| `hit` | verde | 0,255,0 | destello y fundido | 600 ms | dosier §10.5 |
| `countdown` | amarillo | 255,200,0 | cuenta atrás | 1000 ms | dosier §10.5 |
| `penalty` | magenta | 255,0,255 | parpadeo rápido | 200 ms | dosier §10.5 |
| `error` | rojo/blanco | alterna | alternancia | 400 ms | dosier §10.5 |
| `calibration` | cian | 0,255,255 | pulso lento | 1600 ms | añadido |
| `locked` | naranja | 255,110,0 | fijo | — | añadido |
| `sensor_error` | rojo/blanco | 255,0,0 | parpadeo rápido | 300 ms | añadido |
| `maintenance` | blanco tenue | 60,60,60 | fijo | — | dosier §10.5 |
| `disabled` | blanco muy tenue | 25,25,25 | pulso lento | 2400 ms | añadido |
| *identificación* | cian | 0,255,255 | barrido | 800 ms | dosier §10.5 |

Los marcados "añadido" no están en la tabla del dosier, que sólo cubre 8 casos,
pero el contrato define 12 estados de diana. Se han elegido de modo que **no
colisionen** con los normativos: `error` y `sensor_error` comparten color pero
se distinguen por patrón (alternancia lenta frente a parpadeo rápido).

`calibration` e *identificación* comparten el cian, pero la identificación es un
modo de módulo completo y temporal, no un estado de diana, así que no coinciden
en pantalla.

## 3. Patrones

| Patrón | Comportamiento |
|---|---|
| `solid` | intensidad constante |
| `slow_pulse` | rampa triangular entre el 23 % y el 100 % |
| `flash_fade` | arranca al 100 % y decae linealmente hasta apagarse |
| `countdown` | los 24 LED de la diana se apagan uno a uno según avanza la fase |
| `fast_blink` | 50 % de ciclo de trabajo |
| `alternate` | alterna el color base y blanco cada medio periodo |
| `sweep` | un LED al 100 %, el resto al 12 %, girando alrededor de la diana |
| `dim_solid` | constante, intensidad reducida |

## 4. Distribución física

216 LED, 24 por diana, en 3 cadenas de 72 (una por fila de 3 dianas). La cadena
`c` cubre las dianas `3c+1 .. 3c+3`; dentro de la cadena, cada diana ocupa 24
LED consecutivos.

Banco 2026-08-20: con 2 aros reales conectados en serie, ambos se encienden al
configurar `DIANA_LEDS_PER_TARGET=24` y `DIANA_LEDS_PER_CHAIN=72`.

## 5. Presupuesto de potencia

Con 216 LED, el blanco máximo teórico a 60 mA/LED seria **12960 mA**. El
firmware aplica dos límites:

1. **Brillo global** (`led_brightness_max`, 120/255 por defecto), configurable
   desde el backend por `config/desired`.
2. **Presupuesto de corriente** (`DIANA_LED_BUDGET_MA`, 3000 mA): antes de
   escribir cada fotograma se estima el consumo y, si excede, se escalan todos
   los píxeles por igual. Así el recorte no altera qué diana se ve más brillante
   que otra.

El modelo de consumo es **20 mA por canal a plena escala, lineal**. Es un
modelo, no una medida: la curva real de un WS2812 no es lineal y depende del
lote. **Debe contrastarse con pinza amperimétrica** antes de fiarse del
presupuesto (ver `validacion-fisica-pendiente.md`).

El blanco máximo simultáneo queda restringido a diagnóstico, como pide el
dosier.
