# ADR-0006 · Precisión no calculable

**Estado:** aceptado · 2026-07-20

## Contexto

El dosier §17.2-17.3 y el encargo §11 son explícitos: si sólo se conoce la munición
inicial y el jugador puede terminar con bolas sin disparar, no se puede saber cuántos
disparos hizo.

## Decisión

El sistema almacena por separado: munición inicial, munición restante, disparos
realizados, impactos detectados, impactos válidos e impactos incorrectos.

```
disparos_realizados = municion_inicial - municion_restante   (si se conoce la restante)
precision_total     = impactos_detectados / disparos_realizados * 100
precision_valida    = impactos_validos    / disparos_realizados * 100
```

Cuando `municion_restante` es desconocida y no se ha exigido consumir toda la munición:

- `disparos_realizados` es `null`.
- Las dos precisiones son `null`.
- La API devuelve `accuracy_status: "not_computable"` con el motivo.
- El panel muestra "Precisión no calculable: se desconoce el número real de disparos".

## Prohibido

Sustituir los disparos desconocidos por la munición inicial, o derivar "fallos" de la
diferencia entre munición e impactos. Sería inventar disparos fallidos.

## Consecuencias

- Los tipos de la API hacen anulables estos campos, lo que obliga al frontend a tratar
  el caso explícitamente en vez de mostrar un 0 % engañoso.
- Hay una prueba de backend dedicada a este caso.
