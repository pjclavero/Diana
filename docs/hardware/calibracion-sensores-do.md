# Calibracion fisica de sensores DO

Este prototipo usa modulos piezo comerciales con pines `V`, `G`, `AO`, `DO`.
Solo se usa `DO`. La sensibilidad se calibra con el potenciometro fisico de
cada modulo.

No existe calibracion software de amplitud. No hay `AO`, ADC, umbral digital
software ni lectura de envolvente.

## Incidencia de seguridad 2026-08-20, revisada 2026-08-23

Durante banco, el primer 74HC165 fue reportado muy caliente y D1 aparecia
activo de forma permanente. Se retiro alimentacion.

El 2026-08-23 se reemplazaron los 74HC165, se instalo un conversor de nivel
bidireccional MOSFET 3.3 V/5 V para D1-D3 y se reanudo la prueba con el ESP32
por USB. Los sensores medidos entregan `DO=0 V` en reposo y hasta `DO=5 V` al
impacto, por lo que el perfil actual usa `DIANA_DO_ACTIVE_HIGH`.

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
HV=5 V y LV=3.3 V por las resistencias de pull-up del propio modulo. El sensor
DO conectado debe poder llevar la linea a 0 V en reposo; si el LED del modulo
sensor queda encendido permanente, medir la linea DO cargada antes de continuar.

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
