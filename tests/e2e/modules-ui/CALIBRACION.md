# Calibración · ¿puede esta prueba ponerse roja?

Una afirmación de seguridad no cuenta hasta que existe una prueba capaz de
ponerse roja. Aquí se rompe el producto a propósito, se comprueba que la rotura
está **en el artefacto efectivamente desplegado** —con `grep` **dentro de la
imagen**, sobre el `dist` compilado, nunca sobre el fuente—, se mide, y se
revierte.

Las mutaciones **no tocan el árbol de trabajo**: `harness/calibrate.sh` exporta
una copia limpia con `git archive HEAD` a `.tmp/mut/`, muta allí y construye
desde allí. Hay otro agente escribiendo en `server/frontend/src/**`, y una
medición sobre un árbol que otro proceso escribe no vale nada; además, revertir
es `rm -rf` y no un `git checkout` que podría llevarse trabajo ajeno.

## Orden de ejecución

```bash
./tests/e2e/modules-ui/harness/up.sh              # escenario limpio
./tests/e2e/modules-ui/harness/calibrate.sh mut1  # o mut2
./tests/e2e/modules-ui/harness/browser-up.sh      # después de up.sh
cd tests/e2e && npm run test:modules-ui           # debe salir ROJO
cd ../.. && ./tests/e2e/modules-ui/harness/calibrate.sh restore
```

---

## MUT-1 · «la UI cuenta como ONLINE un módulo que nunca ha conectado»

Es la mutación que exige el encargo. Se ataca `diagnosticarModulo`
(`server/frontend/src/utils/estadoModulo.ts`), la función que emite el veredicto
cuando no hay ninguna señal (`silencioMs === null` y `online` falso):

```diff
-      estado: "pendiente",
-      etiqueta: "pendiente",
-      motivo: "Registrado y todavía sin primera señal. No ha llegado a conectarse nunca.",
+      estado: "online",
+      etiqueta: "en línea",
+      motivo: "MUT1-CUENTA-ONLINE-SIN-SENAL",
```

**Verificación en el artefacto desplegado**, antes de medir:

```
docker run --rm --entrypoint grep diana/frontend:e2emodules-mut1 \
  -Rq -- 'MUT1-CUENTA-ONLINE-SIN-SENAL' /usr/share/nginx/html/assets
→ rc=0   ([calib] mut1 VERIFICADA dentro de la imagen (dist/assets))
```

**Resultado medido**: `1 failed, 6 passed`. Se pone rojo **exactamente** el paso
7 y **sólo** el 7 (diferencial limpio: los pasos 1-6 siguen verdes, y 8-10 no
llegan a correr por el modo serie):

```
✘ 7 · un módulo que nunca ha conectado NO aparece ONLINE: se ve como pendiente
  Expected pattern: /\b0 en línea\b/
  Received string:  "1 módulos 1 en línea 0 sin señal reciente 0 desconectados
                     0 pendientes de primera conexión 0 con actualización pendiente"
```

Es decir: con la mutación, el panel afirma que hay **1 módulo en línea** cuando
en la base `online = false` y `last_seen_at IS NULL`. La prueba lo detecta.

---

## MUT-2 · «el backend sube `config_version` de dos en dos»

La segunda mutación ataca **la otra capa de evidencia**, la base de datos, para
demostrar que la medición del paso 5 no es decorativa. En
`server/backend/src/modules/modules/module-config.service.ts`:

```diff
-        desiredConfigVersion: { increment: 1 },
+        desiredConfigVersion: { increment: 2 },
```

**Verificación en el artefacto desplegado** (el `dist` transpilado dentro de la
imagen del backend, no el `.ts`):

```
docker run --rm --entrypoint grep diana/backend:e2emodules-mut2 \
  -Rq -- 'increment: 2' /app/dist/modules/modules/module-config.service.js
→ rc=0   ([calib] mut2 VERIFICADA dentro de la imagen (/app/dist))
```

**Resultado medido**: `1 failed, 4 passed`. Se pone rojo el paso 5, en la
comprobación hecha **en PostgreSQL**:

```
✘ 5 · un empujón de configuración sube desired_config_version en EXACTAMENTE 1
  Expected: 1
  Received: 2
  > expect(filaEnBd(SLUG).desiredConfigVersion - virgen.desiredConfigVersion).toBe(1)
```

---

## Diferencial

Tras `calibrate.sh restore` y volver a levantar el escenario limpio:

```
10 passed (21,5 s)   ·   PW_RC=0
```

Las dos mutaciones se revirtieron y el verde volvió. Un rojo que no vuelve a
verde al revertir no sería una calibración: sería una avería.
