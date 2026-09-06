# Calibración de E2E-1 · GAME

Una prueba no vale por su verde: vale por su capacidad de ponerse roja. Aquí
están las dos mutaciones que se aplicaron al **backend real**, la comprobación
de que entraron de verdad (en el código Y en el `dist` compilado dentro de la
imagen que se ejecutó) y el rojo que produjeron.

Ambas mutaciones se aplicaron sobre `server/backend/**`, se midieron, y se
**revirtieron**. No hay ni una línea de ellas en la rama: `git status` sólo
muestra `tests/e2e/game/` y el script añadido a `tests/e2e/package.json`.

Medido el 2026-09-06 sobre `lane/e2e-game`.

---

## Estado de partida (verde)

```
9 passed (8.3s)
```

---

## Mutación 1 — «el backend no procesa el hit»

**Qué se rompió.** `server/backend/src/modules/mqtt/ingest.service.ts:282`, el
punto exacto donde la ingesta desvía un `module-hit` a `ingestHit`:

```diff
-      return this.ingestHit(payload as unknown as HitEventPayload, receivedAt);
+      return { status: 'ignored' as const, kind: parsed.kind, message: 'MUTACION DE CALIBRACION E2E-1: el backend NO procesa el hit' };
```

**Prueba de que la mutación entró** (antes de medir nada):

```
$ grep -n "MUTACION DE CALIBRACION" server/backend/src/modules/mqtt/ingest.service.ts
282:      return { status: 'ignored' as const, ... }
$ grep -c "return this.ingestHit" server/backend/src/modules/mqtt/ingest.service.ts
0
$ docker run --rm --entrypoint grep diana/backend:e2egame-mutante \
    -c "MUTACION DE CALIBRACION" /app/dist/modules/mqtt/ingest.service.js
1
```

La última comprobación es la que importa: la mutación está en el **JavaScript
compilado dentro de la imagen que se ejecutó**, no sólo en el fuente. Sin ella,
un fallo de caché de construcción habría dado un rojo (o un verde) que no
correspondía al código medido.

**Resultado — ROJO, y en el sitio correcto:**

```
✓ 1..5  (preparación, partida, ronda, inicio, marcador a cero)
✘ 6     CAMINO FELIZ · un hit de module-01 puntúa para su jugador
        Error: el impacto publicado por MQTT no llegó a hit_events: o la ACL lo
               denegó (el broker lo descarta en silencio, rc=0), o el backend no
               lo ingirió
        Expected: "1"   Received: "0"
1 failed · 3 did not run · 5 passed
```

Los cinco pasos anteriores **siguen verdes**: la mutación es puntual y el
escenario la localiza donde está, en vez de tumbarse entero.

---

## Mutación 2 — «todo impacto puntúa»

Sirve para demostrar que el **control negativo B** no es decorativo.

**Qué se rompió.** `server/backend/src/domain/hits/hit-record.ts:46`, la regla
que decide si un impacto cuenta:

```diff
-  return classification === 'valid_hit';
+  return true; // MUTACION DE CALIBRACION E2E-1: todo impacto puntua
```

**Prueba de que la mutación entró.** El compilador se come el comentario, así
que no vale con buscarlo: hay que mirar el **efecto en el código emitido**.

```
$ grep -c "classification === 'valid_hit'" server/backend/src/domain/hits/hit-record.ts
0
$ docker run --rm --entrypoint grep diana/backend:e2egame-mutante2 \
    -A2 "function countsForScore" /app/dist/domain/hits/hit-record.js
function countsForScore(classification) {
    return true;
}
```

**Resultado — ROJO, sólo en el control negativo B:**

```
✓ 1..7  (incluido el CAMINO FELIZ y el CONTROL NEGATIVO A)
✘ 8     CONTROL NEGATIVO B · un hit que el módulo no clasifica como válido NO puntúa
        Error: está atribuido al jugador 1, pero no cuenta: 'hit_on_safe' no es 'valid_hit'
        Expected: "false|880cec5a-..."   Received: "true|880cec5a-..."
1 failed · 1 did not run · 7 passed
```

El camino feliz sigue verde (con esta mutación un `valid_hit` sigue contando) y
el control negativo A también (esa regla es de atribución, no de clasificación).
Es decir: la mutación distingue *exactamente* la aserción que le corresponde.

---

## Reversión, verificada

```
$ grep -n "classification === 'valid_hit'" server/backend/src/domain/hits/hit-record.ts
46:  return classification === 'valid_hit';
$ grep -c "return this.ingestHit" server/backend/src/modules/mqtt/ingest.service.ts
1
$ git status --short
 M tests/e2e/package.json      ← sólo el script "test:game"
?? tests/e2e/game/             ← este carril
```

Y la imagen limpia reconstruida vuelve a traer la regla buena:

```
$ docker run --rm --entrypoint grep diana/backend:e2egame \
    -A2 "function countsForScore" /app/dist/domain/hits/hit-record.js
function countsForScore(classification) {
    return classification === 'valid_hit';
}
```

Pasada final tras revertir: **9 passed**.

---

## Lo que la calibración NO cubre

- No se mutó la **ACL** para comprobar que una denegación de publicación pone
  roja la prueba. La aserción está escrita para detectarlo (se mide la fila en
  la base, nunca el `rc` de publicar, porque una denegación de ACL devuelve
  rc=0), pero **no se ha medido**. Habría exigido reescribir
  `infrastructure/mosquitto/acl`, que este carril no posee y monta en solo
  lectura a propósito.
- No se mutó el **marcador** (`domain/scoreboard`). Las dos mutaciones aplicadas
  ya recorren el camino hasta la puntuación leída por API, pero una regresión
  introducida sólo en el agregado del marcador no está calibrada.
