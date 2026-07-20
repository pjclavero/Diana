# ADR-0002 · Modelo temporal de cuatro marcas

**Estado:** aceptado · 2026-07-20

## Contexto

El requisito más delicado del proyecto: el dosier §14.2 y §20.3 exigen que el tiempo del
impacto proceda del ESP32 y que la llegada al servidor **no** lo sustituya. El ejemplo de
payload del propio dosier (§15.3) traía un `elapsed_us` plano sin indicar quién lo produjo,
lo que permitiría que el backend lo rellenase silenciosamente.

## Decisión

Se distinguen cuatro marcas con propietario único:

| Marca | Propietario | Dónde vive |
|---|---|---|
| T1 captura | ESP32 detector | `device.event_us` en el payload |
| T2 consolidación | módulo principal | `coordinator.elapsed_us` en el payload |
| T3 recepción MQTT | backend | columna `received_at`, **nunca** en el payload |
| T4 persistencia | backend | columna `persisted_at` |

Reglas normativas:

1. Un evento sin T1 es inválido y se rechaza en el esquema.
2. `elapsed_us` (lo que ve el jugador) lo calcula el coordinador.
3. El backend puede marcar un evento como fuera de ventana, pero no reescribe T1 ni T2.
4. Los esquemas usan `additionalProperties: false`, de modo que inyectar `received_at` en
   un payload MQTT es un error detectable. Hay un ejemplo inválido que lo comprueba.

## Consecuencias

- El backend deja de poder "arreglar" tiempos, que es exactamente lo que se busca.
- Se transporta `clock_offset_us` y su incertidumbre para poder auditar la sincronización
  entre módulos y fijar el presupuesto de error del dosier §29.7.
- Si el coordinador cae a mitad de ronda, los eventos crudos conservan T1 y la ronda puede
  reconstruirse; sin T2 no se muestran tiempos de juego consolidados.
