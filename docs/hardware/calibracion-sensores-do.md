# Calibracion fisica de sensores DO

> STATUS: LEGACY PARCIAL. Para el montaje actual usar
> [`docs/hardware/current/sensores-do.md`](current/sensores-do.md) y
> [`docs/hardware/current/validacion.md`](current/validacion.md).

Este prototipo usa modulos piezo comerciales con pines `V`, `G`, `AO`, `DO`.
Solo se usa `DO`. La sensibilidad se calibra con el potenciometro fisico de
cada modulo.

No existe calibracion software de amplitud. No hay `AO`, ADC, umbral digital
software ni lectura de envolvente.

## Incidencia de seguridad 2026-08-20, revisada 2026-08-23

Durante banco, el primer 74HC165 fue reportado muy caliente y D1 aparecia
activo de forma permanente. Se retiro alimentacion.

El 2026-08-23 se reemplazaron los 74HC165 y se reanudo la prueba con el ESP32
por USB. Los sensores medidos entregan `DO=0 V` en reposo y hasta `DO=5 V` al
impacto, por lo que el perfil actual usa `DIANA_DO_ACTIVE_HIGH`. El conversor
bidireccional MOSFET 3.3 V/5 V se descarto para DO porque sus pull-ups dejaban
las lineas altas en reposo; D1-D3 quedan con divisor resistivo por sensor.

Comprobaciones antes de volver a alimentar:

1. Desconectar `DO` de sensores del primer 74HC165.
2. Verificar que el 74HC165 no se calienta alimentado solo a 3.3 V.
3. Medir `DO` de cada sensor en reposo y con golpe.
4. Si `DO HIGH` llega a 5 V, instalar adaptacion de nivel antes del 74HC165.
5. Fijar a nivel conocido toda entrada sin sensor instalado.
6. Repetir prueba D1/D2/D3 con el chip frio.

## Preparacion

1. Montar los 9 sensores.
2. Alimentar los sensores segun el modulo comercial, normalmente 5 V.
3. Unir GND de sensores, ESP32, HC165, W5500 y LED.
4. Medir `DO HIGH` de un sensor alimentado a 5 V.
5. Si `DO HIGH` es 5 V, instalar adaptacion de nivel antes de entrar a logica
   de 3.3 V.
6. Arrancar firmware en modo bring-up serie.
7. Confirmar polaridad real: `DIANA_DO_ACTIVE_HIGH` o `DIANA_DO_ACTIVE_LOW`.
   En la prueba de banco 2026-08-23, D1-D3 quedan en `raw=0` en reposo y suben
   a `raw=1` solo durante el impacto, por lo que el perfil actual usa
   `DIANA_DO_ACTIVE_HIGH`.

## Procedimiento

1. Ajustar inicialmente la sensibilidad baja en los 9 potenciometros.
2. Golpear o disparar sobre D1.
3. Aumentar sensibilidad de D1 hasta detectar consistentemente D1.
4. Comprobar que impactos en D2-D9 no activan D1.
5. Repetir el proceso para D2.
6. Repetir hasta D9.
7. Medir falsos positivos durante reposo.
8. Medir falsos negativos con impactos reales.
9. Ajustar sensibilidad.
10. Repetir el lote completo.

## Observacion en monitor serie

En bring-up se debe comprobar:

```text
selector cambia entre PRINCIPAL/SATELITE/INVALID_SELECTOR
IDENTIFY cambia HIGH/LOW
D1 activa bit 0
D2 activa bit 1
D3 activa bit 2
D4 activa bit 3
D5 activa bit 4
D6 activa bit 5
D7 activa bit 6
D8 activa bit 7
D9 activa bit 8
bits 9-15 no generan impactos
MULTI_TRIGGER aparece cuando hay varios DO activos simultaneos
```

## Valores de desarrollo

La prueba de banco 2026-08-23 esta montada parcialmente con sensores solo en
D1, D2 y D3. D4-D9 quedan fijadas a GND, correcto para `DIANA_DO_ACTIVE_HIGH`.
No considerar validado el mapa completo hasta probar impactos reales en D4-D9.

Con el conversor bidireccional MOSFET, un canal sin sensor puede quedar tirado a
HV=5 V y LV=3.3 V por las resistencias de pull-up del propio modulo. No usarlo
para estos DO activo-alto. Con divisor resistivo, la prueba de monitor capturo:
D1=`0x0001`, D2=`0x0002`, D3=`0x0004`, todos volviendo a reposo `0x0000`.

Los tiempos de debounce y refractory del firmware son valores de desarrollo
`PENDING_PHYSICAL_TUNING`. Deben medirse en banco:

| Parametro | Que medir |
| --- | --- |
| Debounce | Duracion real de rebotes o pulsos repetidos de DO |
| Refractory | Tiempo minimo entre impactos reales separados en la misma diana |
| Polling HC165 | Latencia aceptable entre DO y evento |

No cerrar estos valores sin captura fisica.

## Criterios iniciales

| Resultado | Accion |
| --- | --- |
| Dn no detecta | Subir sensibilidad de Dn o revisar cableado DO |
| Dn detecta al golpear otra diana | Bajar sensibilidad o mejorar aislamiento mecanico |
| Varios bits en un golpe | Registrar MULTI_TRIGGER y revisar sensibilidad/mecanica |
| Bit incorrecto | Revisar orden HC165 A-H y cascada |
| Reservas activas | Fijar B-H de HC165 #2 a nivel conocido |

## Hoja de registro por diana

Rescatada de `hw/do-only-v1`. Se rellena en banco, una fila por diana y vuelta.
Los contadores de calibracion del firmware (`diana_sensor_state.diag`) dan
`trigger_count` por diana, `multi_trigger_count` y `capture_count` como
denominador honesto.

| Diana | Vuelta | Impactos | Detecciones | Falsos negativos | Disparos multiples (¿que diana?) | Accion |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| D1 | | 20 | | | | |
| D2 | | 20 | | | | |
| D3 | | 20 | | | | |
| D4 | | 20 | | | | |
| D5 | | 20 | | | | |
| D6 | | 20 | | | | |
| D7 | | 20 | | | | |
| D8 | | 20 | | | | |
| D9 | | 20 | | | | |

El criterio numerico de aceptacion **no esta fijado** y no se inventa aqui: sale
del protocolo de ensayo mecanico
(`hardware/mechanical/tests/protocolo-impacto.md`). Exigible de partida: cero
falsos negativos en la tanda final y disparos multiples excepcionales, no
habituales.

## Lo que esta calibracion NO puede arreglar

- **Aislamiento mecanico insuficiente.** Si la estructura transmite el golpe, se
  nota en varios canales a la vez y ningun ajuste de umbral lo separa. Es
  mecanica: material, fijacion, desacoplo. El firmware solo lo MIDE
  (`multi_trigger_count`).
- **Un pulso `DO` mas corto que el periodo de sondeo.** Si el pulso desaparece
  entre dos lecturas del 74HC165, el impacto se pierde por muy bien ajustado que
  este el potenciometro. Se corrige midiendo el pulso y ajustando
  `DIANA_HC165_POLL_MS`, no girando nada.
- **Polaridad equivocada.** Si `DIANA_DO_POLARITY` no corresponde a la polaridad
  real medida, el sistema detecta exactamente al reves y la calibracion no
  significa nada.
- **Diferencias de intensidad entre impactos.** Sin amplitud solo hay «paso el
  umbral» o «no paso». No se puede distinguir un roce fuerte de un impacto flojo.

## Pendiente de validacion fisica

`PENDING_PHYSICAL_VALIDATION`; no convertir en constante hasta medirlo sobre las
piezas compradas:

- `V_DO_IDLE`, `V_DO_TRIGGER` y polaridad reales.
- Duracion minima del pulso `DO`.
- Debounce/refractario definitivos.
- Si hace falta `IRQ_ANY` (GPIO7, sin cablear) o basta el sondeo.
- Criterio numerico de aceptacion de disparos multiples.
