# Dictamen de calidad (WP-11)

Revisión independiente de calidad sobre `develop` a 2026-07-21. Sólo evidencia
ejecutada. La evidencia por suite está en `docs/quality/suites-evidence.md`.

## Dictamen

**CONFORME CON OBSERVACIONES.**

Fundamento: las cinco superficies que el proyecto declara verdes (contratos,
firmware host, simulador, backend unit, frontend) reproducen verde con salida
real, sin fallos ocultos ni discrepancias en contra. No puedo emitir NO
CONFORME porque nada declarado verde salió rojo. No puedo emitir CONFORME a
secas por las observaciones §3–§6: la única capa de prueba independiente (E2E de
WP-07) está sin implementar, la matriz apunta 46 veces a un directorio de
evidencia vacío, hay código de producto sin prueba, y en las tres suites verdes
implementación y prueba recaen en el mismo paquete.

## 1. Reproducción de líneas base (ejecutado)

Ver `docs/quality/suites-evidence.md`. Todas coinciden con lo declarado:
contratos 43/0; firmware 389/389; simulador 33/33; backend 157 pasados + 5
saltados (saltados por ausencia de `DATABASE_URL`, no por rotura, verificado);
frontend typecheck/build/lint limpios + 30/30.

Discrepancias con el STATUS, todas a favor:

- Las filas WP-04 (338/338, `CHANGES_REQUESTED`) y WP-05 (28/28,
  `CHANGES_REQUESTED`) del STATUS están por debajo de lo real en `develop`
  (389/389 y 33/33). El STATUS de esas filas va retrasado.
- El frontend no trae `node_modules`: la base sólo es reproducible tras `npm
  ci`. No es un fallo, pero la línea base no arranca "en frío".

## 2. Discrepancia material: los Dockerfile ya existen

`server/backend/Dockerfile` y `server/worker/Dockerfile` EXISTEN en `develop`.
El hallazgo X-10 / F-13 de WP-10 (STATUS) los declara ausentes ("Faltan los
`Dockerfile` de `server/backend` y `server/worker`") y ata a esa ausencia la
imposibilidad de arrancar el stack y de verificar F-02, F-03, F-05, F-06, F-08,
F-09, F-11 y F-12. Ese hallazgo está desactualizado: WP-08 ya los añadió. La
verificación de F-02 y compañía que WP-10 dejó bloqueada por F-13 debe reabrirse
contra el stack, no darse por imposible. Confirmar el arranque real queda fuera
de mi alcance (sin demonio Docker aquí); lo que sí está ejecutado es que los dos
ficheros existen.

## 3. Independencia (§2.4)

`docs/coordination/OWNERSHIP.md` asigna `server/backend/**` (código Y `test/`) a
WP-02, `firmware/**` (incluido `test_host/`) a WP-04 y `simulators/**` (incluido
`test/`) a WP-05. Es decir: **cada una de las tres suites unitarias verdes la
escribió el mismo paquete que escribió el código que prueba.** La cadena
implementa→prueba recae en un solo paquete en los tres casos.

La única capa de prueba de propietario distinto al implementador es WP-07
(`.github/**`, `tests/**`). Sus 16 escenarios E2E del §19 están **todos** como
`test.fixme` sin una sola aserción. Verificado: `grep 'test.fixme(' 
tests/e2e/scenarios.spec.ts` = 16; `grep -c expect` = 0. Por tanto la capa
independiente de cruce está al 0 % de implementación.

Revisión independiente registrada por encima de las suites: WP-10 (seguridad,
`READY_FOR_REVIEW`, con 8 de 18 hallazgos sin reproducir en ejecución), WP-11
(esta), WP-12 (supervisor, `NO CONFORME` en la Ola 0, re-revisión pendiente). La
independencia existe a nivel agregado, no por función.

Los cuatro módulos críticos SÍ tienen pruebas que ejercitan sus caminos límite
(ejecutadas, verdes), aunque las escribió el implementador:

- **Ingesta MQTT idempotente** (`test/ingest/idempotency.spec.ts`): duplicado
  por `event_id`; duplicado por `(module, boot_id, local_sequence)`; `boot_id`
  distinto con misma `local_sequence` = evento nuevo; `replay: true` no es
  duplicado; el duplicado cuenta como métrica y no altera la puntuación.
- **Cálculo temporal T1/T2** (`test/ingest/temporal-authority.spec.ts`): T1/T2
  copiados literalmente del payload; columnas separadas de T3; satélite sin
  coordinador deja T2 en null (no lo inventa); marcar fuera de ventana no toca
  T1/T2; rechazo de payload con T3 de servidor inyectada.
- **Precisión no calculable** (`test/accuracy/accuracy.spec.ts`): munición
  restante desconocida → disparos null y estado `not_computable` con motivo;
  prohibido sustituir disparos por munición inicial; prohibido derivar fallos de
  la diferencia; cero disparos no divide por cero; recuentos negativos = error.
- **Validación de comandos con nonce** (firmware
  `test_host/tests/test_command.c`): nonce no monotónico rechazado; nonce igual
  al último rechazado; nonce por emisor; nonce persistido en NVS sobrevive al
  reinicio; caducidad medida desde `issued_at_ms`; comando en el futuro
  rechazado por descuadre; sin reloj se acepta pero se marca; params
  obligatorios por acción. El backend sólo emite nonces monotónicos
  (`NonceSource`, `test/misc/support.spec.ts`); la validación de reenvío la hace
  el firmware.

Punto de independencia que SÍ funcionó: WP-10 detectó, de forma independiente al
firmware, que se aceptan comandos con `clock_ok == false` (F-16 / X-14). El test
del firmware lo confirma: "sin reloj sincronizado se acepta, pero se DICE". La
divergencia entre el requisito de seguridad (rechazar comandos con consecuencia
física sin hora) y la conducta actual (aceptar y marcar) sigue abierta en X-14.

Dónde la cadena implementa→prueba→revisa→aprueba recae en un solo paquete: en
backend, firmware y simulador, implementación y prueba son del mismo paquete, y
no consta revisión independiente por función; la aprobación depende del cruce
agregado de WP-10/WP-11/WP-12, aún no cerrado.

## 4. Cobertura real frente a la matriz

`docs/coordination/TEST_MATRIX.md` remite 46 veces a `` `docs/testing/` ``.
`docs/testing/` está **vacío**: sólo contiene `.gitkeep.md` con el texto
"Pendiente: lo rellena el paquete de trabajo propietario". Los 46 punteros de
evidencia de la matriz están colgados. La evidencia real de las filas verdes no
está en `docs/testing/` sino en las propias suites (que aquí se han ejecutado) y
en `docs/security/`.

- E2E §19 (E-01..E-16): la matriz los da con "ver `docs/testing/`". En realidad
  son placeholder (`test.fixme`, 0 aserciones). Marcados como cubiertos, son
  esqueletos vacíos. Coincide con lo que WP-07 documenta en
  `tests/e2e/README.md` ("Los 16 escenarios son PLACEHOLDER"): verificado,
  16 `test.fixme`, ninguno implementado.
- Infraestructura (I-01..I-09) y Carga (L-01..L-04): "ver `docs/testing/`", sin
  evidencia; requieren Docker vivo, no ejecutable aquí. No hay salida real que
  las respalde.
- Backend B-03/B-04/B-05 ("ver `docs/testing/`"): estas SÍ corresponden a tests
  verdes reales (idempotencia, temporal, precisión), aunque el puntero de la
  matriz siga apuntando al directorio vacío.

## 5. Huecos de cobertura de producto (ejecutado)

- **Worker** (`server/worker/src/`): `tasks.ts` y `main.ts` no tienen ninguna
  prueba. `find server/worker -name '*.spec.*'` = 0. Matiza X-16: la lógica pura
  de planificación (`worker/src/schedule.ts`) SÍ está cubierta, pero desde la
  suite del backend (`server/backend/test/worker/schedule.spec.ts`, verde). Lo
  que queda sin prueba es la ejecución de tareas y el arranque del worker, no la
  aritmética de planificación.
- **E2E de partida completa contra stack real**: 0 implementados (§4).
- **Integración backend contra PostgreSQL**: 2 suites, saltadas por falta de
  base viva. No se han ejecutado; su garantía (restricciones de BD, ADR-0003)
  queda sin demostrar aquí.

## 6. Trabajo no hecho o no verificable en este entorno

- Arranque real del stack y healthchecks (X-05): sin demonio Docker. No
  verificado.
- ACL de MQTT por `client_id` (F-02 / X-08): sin broker vivo. No reproducido.
- ERC/DRC de KiCad (WP-06): sin KiCad. 47 validaciones físicas pendientes.
- Compilación ESP-IDF del firmware (F-07): delegada a CI, no ejecutada aquí.
- E2E de frontend 18/18 (X-07): declarados por WP-03 contra adaptador mock; no
  re-ejecutados en esta revisión.

## Observaciones (lista)

1. La matriz apunta 46 veces a `docs/testing/`, que está vacío. Los punteros de
   evidencia están colgados.
2. Los 16 E2E del §19 (la única capa de prueba independiente del implementador)
   son placeholder al 100 %.
3. Implementación y prueba del mismo paquete en backend, firmware y simulador;
   sin revisión independiente por función.
4. X-10 / F-13 del STATUS está desactualizado: los Dockerfile ya existen; la
   verificación que WP-10 dejó bloqueada por eso debe reabrirse.
5. `server/worker/{tasks,main}.ts` sin prueba.
6. El frontend no reproduce en frío: exige `npm ci` previo.
7. Filas WP-04 y WP-05 del STATUS por debajo de lo real (389/389 y 33/33).
8. Integración backend contra PostgreSQL no ejecutada (saltada por diseño).

Ninguna de estas observaciones convierte en rojo una suite declarada verde. Por
eso el dictamen es CONFORME CON OBSERVACIONES y no NO CONFORME.
