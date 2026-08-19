# Calibracion fisica de sensores DO

Este prototipo usa modulos piezo comerciales con pines `V`, `G`, `AO`, `DO`.
Solo se usa `DO`. La sensibilidad se calibra con el potenciometro fisico de
cada modulo.

No existe calibracion software de amplitud. No hay `AO`, ADC, umbral digital
software ni lectura de envolvente.

## Bloqueo de seguridad 2026-08-20

Durante banco, el primer 74HC165 fue reportado muy caliente y D1 aparecia
activo de forma permanente. Se retiro alimentacion. No continuar la calibracion
hasta aislar la causa electrica.

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
   En la prueba de banco con alimentacion de 5 V corregida, D1-D9 quedan en
   `raw=1` en reposo, por lo que el perfil actual usa `DIANA_DO_ACTIVE_LOW`.

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

La prueba de banco actual puede montarse parcialmente con solo D1-D2 o D2-D3
para validar alimentacion, polaridad y mapa antes de completar las 9 entradas.
En ese caso, las entradas no instaladas del HC165 deben quedar a nivel fijo, no
flotando. No considerar validado el mapa de sensores mientras el primer 74HC165
se caliente.

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
