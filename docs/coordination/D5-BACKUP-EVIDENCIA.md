# D5 · Backup/Restore — evidencia congelada

Carril **D5**. Rama `lane/d5-backup`, base `origin/mp0/integration`.

| | |
|---|---|
| Repo | `https://github.com/pjclavero/Diana` |
| Rama | `lane/d5-backup` |
| BASE_SHA | `ac2b6db5c335d9656f407b00b03b54ffb1000ece` (`origin/mp0/integration`) |
| Ficheros tocados | `infrastructure/backups/**`, `infrastructure/backups/tests/**` (nuevo), este documento |
| Producción / VM109 | **NO tocada**. Toda la medición corre en contenedores efímeros locales. |

Este documento existe para que el carril **D1** pueda portar esta versión
sabiendo exactamente qué se probó, cómo, y qué quedó fuera.

---

## 1. Punto de partida: se toma la versión del hotfix, con evidencia

Se compararon las dos versiones antes de decidir. La evidencia es de historia
de git, no de impresión:

```
$ git log --oneline origin/mp0/integration -- infrastructure/backups/
71f2cbe feat(infra): añade la infraestructura Docker completa de WP-01
484edd0 feat(w0): fundación del repositorio y contratos MQTT v1 congelados

$ git log --oneline origin/hotfix/p02-tls-6da16d4 -- infrastructure/backups/
2586dbc infra(P0-2): estado real del arbol de trabajo de produccion, hecho explicito
71f2cbe feat(infra): añade la infraestructura Docker completa de WP-01
484edd0 feat(w0): fundación del repositorio y contratos MQTT v1 congelados

$ git merge-base origin/mp0/integration origin/hotfix/p02-tls-6da16d4
6da16d431556fae2f50a81d89e90225364063dc4

$ git diff 71f2cbe origin/mp0/integration -- infrastructure/backups/
(vacío)
```

Lectura, sin suponer nada por las fechas de rama:

- Ambas ramas comparten el commit `71f2cbe`, que es donde nacieron estos scripts.
- `mp0/integration` **no ha modificado** `infrastructure/backups/` desde
  entonces: el diff contra `71f2cbe` está vacío. Es el estado original.
- `hotfix/p02-tls-6da16d4` tiene además `2586dbc`, que es exactamente el commit
  que corrige el fallo medido en producción y que añade `verify-restore.sh`.
- El árbol del hotfix es un **superconjunto estricto** del de mp0 en este
  directorio (`git diff` entre ramas: `+272 / -2` líneas, ningún borrado
  sustantivo). `README.md` es **idéntico** en ambas.

**Decisión: el punto de partida es la versión de `origin/hotfix/p02-tls-6da16d4`.**
No porque sea «más nueva» —el HEAD del hotfix es de agosto y el de mp0 de
septiembre—, sino porque en *este directorio* mp0 no aporta ningún cambio y el
hotfix aporta la corrección del defecto medido más el ensayo de restauración.
Portar lo de mp0 habría sido reintroducir el bug del `.sql.gz` de 20 bytes.

### Qué se conservó del hotfix y qué se cambió

| Del hotfix | Estado |
|---|---|
| Propagación del rc de `pg_dump` por fichero de estado (truco POSIX) | **Sustituido** por `set -Eeuo pipefail` + `PIPESTATUS`. La imagen `postgres:16.4-alpine` del servicio `backup` **sí tiene `/bin/bash`** (verificado ejecutándolo), así que el rodeo ya no hace falta y el código queda legible. |
| `gzip -t` + marcador `PostgreSQL database dump complete` | Conservado, y ampliado |
| `last-status` en FAIL desde el principio | Conservado |
| `chmod 600` sobre la copia publicada | Conservado |
| `verify-restore.sh` atado al volumen `diana_backups` y a `/opt/diana` | **Reescrito**: modo autocontenido por defecto (fixture propio), modo `prod` opcional, `REPO_DIR` derivado de la ruta del script. Antes no era ejecutable fuera de la VM de Diana; ahora sí, y por eso se ha podido *ejecutar de verdad*. |

### Qué faltaba en ambas versiones y se ha añadido

1. **Tamaño mínimo plausible** (comprimido y sin comprimir). El hotfix detectaba
   el dump vacío por el marcador de cierre; ahora también por tamaño, que es la
   comprobación que no depende del formato de salida de `pg_dump`.
2. **Estructura de dump real**: un fichero con las dos cabeceras y nada útil en
   medio pasaba todas las comprobaciones del hotfix. Ahora se exige un mínimo de
   sentencias `CREATE|ALTER|COPY|INSERT|SET`.
3. **Publicación atómica de verdad**: el hotfix escribía `${DAILY_PATH}.tmp`
   *dentro de* `daily/`. Ahora el trabajo ocurre en `/backups/.staging/` y el
   artefacto sólo entra en `daily/` con su nombre definitivo tras pasar todo.
4. **No sobrescribir nunca**: si el nombre destino ya existe, se aborta.
5. **`.sha256` acompañante** en cada copia publicada, verificado en `restore.sh`.
6. **Copias weekly/monthly atómicas y verificadas** (antes: `cp` a pelo).
7. **Retención que no puede canibalizar**: `prune` sólo corre tras publicar, y
   nunca borra la copia recién creada.
8. **`restore.sh` con efecto observable**: además del rc de `psql`, exige que la
   base destino tenga tablas. Restaurar «con éxito» una base vacía ya no cuela.
9. **`tests/gate-backup.sh`**: la calibración, que no existía en ninguna versión.

---

## 2. Contrato implementado

```
BACKUP_SUCCESS = el proceso terminó correctamente
               + el artefacto existe
               + tamaño/plausibilidad mínima
               + contenido verificable
               + la restauración/verificación pasa
```

Traducción a comprobaciones, en orden, en `backup.sh`:

| # | Comprobación | Falla si |
|---|---|---|
| 1 | `PIPESTATUS[0]` de `pg_dump` | el volcado falló, aunque `gzip` devolviera 0 |
| 2 | `PIPESTATUS[1]` de `gzip` | la compresión falló |
| 3 | el artefacto existe | no se escribió nada |
| 4 | `bytes >= BACKUP_MIN_BYTES` (512) | gzip del vacío (~20 B) o truncado |
| 5 | `gzip -t` | corrupto |
| 6 | `bytes_sin_comprimir >= BACKUP_MIN_PLAIN_BYTES` (2048) | dump inverosímil |
| 7 | cabecera `PostgreSQL database dump` | no es un dump |
| 8 | marcador `PostgreSQL database dump complete` | truncado |
| 9 | `>= BACKUP_MIN_STATEMENTS` (5) sentencias SQL | cascarón sin contenido |
| 10 | el nombre destino **no** existe | pisaría una copia buena |
| 11 | `mv` desde `.staging/` (rename(2)) | — publicación atómica |
| 12 | sha256 de las copias weekly/monthly | copia corrupta |

Y sólo entonces `last-status` pasa a `OK`. Arranca en `FAIL`, así que un proceso
muerto a mitad **no** puede parecer un éxito.

Detalle no obvio, encontrado midiendo: en bash el **trap `ERR` salta aunque
`errexit` esté apagado**. Con `set +e` alrededor de la tubería, el trap se
adelantaba y escribía «orden fallida en la línea 103» en lugar del motivo real.
Se desarma el trap sólo en ese tramo y se rearma justo después. El fallo se
detectaba igual (el gate estaba rojo en ambos casos), pero el *motivo* que
quedaba registrado era inútil para un operador a las 3 de la mañana. Corregido
y vuelto a medir.

---

## 3. Calibración ejecutada

`infrastructure/backups/tests/gate-backup.sh`. Los negativos se provocan con un
`pg_dump` postizo delante del `PATH` dentro de un contenedor efímero: **no se
conecta a ninguna base de datos**. Cada caso arranca con una copia buena previa
ya publicada en `daily/`, para poder demostrar que un fallo no la toca.

Ejecutado el 2026-09-05 en esta máquina, imagen `postgres:16.4-alpine`.

### Negativos — cada uno se puso ROJO

Para cada caso se comprueban **cinco efectos observables**: `rc != 0`, ningún
artefacto nuevo publicado, la copia buena anterior con el sha256 intacto,
`last-status` en `FAIL`, y `staging` sin restos publicables.

| Caso | Fallo inyectado | Resultado | Motivo registrado |
|---|---|---|---|
| `rc_inmediato` | `pg_dump` falla al arrancar (rc=1) | **ROJO**, 5/5 | `pg_dump devolvió 1; no se publica la copia` |
| `vacio_rc0` | sin salida, rc=0 → gzip válido de 20 B — **el fallo medido en producción** | **ROJO**, 5/5 | `artefacto inverosímil: 20 bytes < 512 mínimos` |
| `truncado_rc0` | dump creíble sin marcador de cierre, rc=0 | **ROJO**, 5/5 | `el volcado no contiene el marcador de fin de pg_dump (truncado)` |
| `falla_a_mitad` | escribe 300 filas y muere (rc=2) — **el caso que la tubería enmascaraba** | **ROJO**, 5/5 | `pg_dump devolvió 2; no se publica la copia` |
| `cascaron` | gzip válido, ambos marcadores, cero sentencias | **ROJO**, 5/5 | `el volcado sólo tiene 0 sentencias SQL: no es un dump utilizable` |
| `minusculo` | dump formalmente completo de 78 B | **ROJO**, 5/5 | `artefacto inverosímil: 78 bytes < 512 mínimos` |
| `colision_nombre` | volcado **válido** contra un nombre ya ocupado | **ROJO**, 3/3 | `ya existe …/diana_20260905-172910.sql.gz; no se sobrescribe una copia previa` |

Sobre `colision_nombre`: se ocupan los 181 nombres posibles de los próximos
180 s con contenido reconocible y se sube la retención a 10000 para que la purga
no borre lo que se está midiendo. Tras la ejecución, **las 181 copias conservan
su contenido byte a byte**. Primer intento con una ventana de 10 s dio un falso
rojo (el backup eligió un nombre fuera de la ventana): se corrigió el arnés, no
el script.

### Control positivo — verde

Sin él, los negativos pasarían trivialmente aunque el script no hiciera nada.

**a) Arnés de negativos, con un `pg_dump` postizo que funciona:** `rc=0`,
exactamente 1 artefacto nuevo publicado, gzip íntegro, marcador de cierre
presente, `.sha256` acompañante correcto, permisos `600`, copia anterior
intacta, `last-status` en `OK`. 8/8.

**b) Cadena completa (`verify-restore.sh`), con PostgreSQL real efímero:**

```
fixture + marcadores → backup.sh real → restore.sh real en OTRO PostgreSQL → verificación
```

- 7 marcadores recuperados (incluidos `jsonb` y un entero concreto)
- datos: 502 `hit_events`, hashes de usuario, texto con `Ñ` intacto
- estructura: 7 tablas, 13 índices, 7 PK, 8 FK, 1 CHECK, 3 valores de enum
- **constraints vivas**, no sólo declaradas: un `INSERT` huérfano da
  `violates foreign key constraint`, uno duplicado da `duplicate key`, uno con
  estado inválido da `violates check constraint`
- **huella completa de esquema/constraints/índices IDÉNTICA** origen vs destino
- controles positivos internos: las copias **truncada**, **vacía** y
  **alterada** (mismo `.sha256`, un byte de más) son **rechazadas**

**Total de la corrida completa: 42 comprobaciones en verde, 0 en rojo, `rc=0`.**

### Cómo reproducirlo

```bash
cd <repo>/infrastructure/backups
GATE_SKIP_POSITIVE=1 ./tests/gate-backup.sh   # negativos, ~1 min, sin PostgreSQL
./tests/gate-backup.sh                        # todo, incluye PostgreSQL efímero
./verify-restore.sh                           # sólo la cadena completa
```

Requiere Docker y poder descargar `postgres:16.4-alpine`. No requiere
producción, ni la VM109, ni credenciales reales.

---

## 4. Qué NO se ha medido

| Sin medir | Por qué | Cómo medirlo cuando proceda |
|---|---|---|
| Ensayo contra el **esquema real** de Diana | Exige el volumen `diana_backups` de la VM109, y este carril tiene prohibido tocar producción. El fixture reproduce los *rasgos* (enum, FK, UNIQUE, CHECK, jsonb, acentos), no el esquema. | En la VM de Diana: `VERIFY_SEED=prod ./verify-restore.sh` — lee el volumen en **sólo lectura** y restaura en contenedores desechables. Sigue sin tocar la base real. |
| Disparo por el **planificador real** (`cron-loop-entrypoint.sh`) | Añade ~3 min de espera por corrida; se dejó fuera del camino rápido. El código está y es el mismo del hotfix. | `VERIFY_USE_SCHEDULER=1 ./verify-restore.sh` |
| Rama **weekly/monthly** de `publish_copy` | Sólo se ejecuta en domingo / día 1. La corrida fue en viernes 5. | Fijar `TZ`/fecha del contenedor a un domingo, o exponer `BACKUP_FORCE_WEEKLY` si se quiere cubrir en CI. |
| **Purga** por retención (`prune`) | Cubierta indirectamente (subir la retención evitó que interfiriera), pero no hay un caso que verifique *qué* borra y *qué* conserva. | Caso nuevo en `gate-backup.sh`: sembrar N+3 copias con timestamps ordenados, correr con `BACKUP_RETENTION_DAILY=N`, comprobar que sobreviven exactamente las N más recientes + la nueva. |
| Comportamiento con **disco lleno** | No reproducido. La detección es genérica (tamaño y marcador de cierre). | `--tmpfs /backups:size=1m` en el `docker run` del arnés. |
| **Cifrado y copia off-host** del backup | Fuera del alcance de D5 tal como se encargó. Hoy el backup vive en el mismo host que la base: un fallo físico se los lleva a los dos. | Decisión del operador. |
| **Umbrales calibrados al tamaño real** | 512 B / 2048 B / 5 sentencias son mínimos para descartar basura, no un rango esperado. Un dump que encoja al 10% de lo normal pasaría. | Medir el tamaño estable en VM109 y subir `BACKUP_MIN_BYTES`; opcionalmente comparar contra la copia anterior. |

---

## 5. Nota para el carril D1

Lo que hay que portar es el directorio `infrastructure/backups/` completo,
incluido `tests/`. Los cuatro ficheros ejecutables dependen entre sí:
`gate-backup.sh` invoca `verify-restore.sh`, que invoca `backup.sh` y
`restore.sh` **reales** montados desde el repo — no copias.

- `backup.sh` y `restore.sh` pasaron de `#!/usr/bin/env sh` a **bash**. El
  servicio `backup` de `compose.yml` usa `postgres:16.4-alpine`, que lo trae.
  Si alguien cambia esa imagen por una sin bash, los scripts dejan de arrancar
  — es un fallo ruidoso, no silencioso, pero conviene saberlo.
- No se ha tocado `compose.yml`: no hace falta ningún cambio para que esto
  funcione. `BACKUP_MIN_BYTES`, `BACKUP_MIN_PLAIN_BYTES` y
  `BACKUP_MIN_STATEMENTS` tienen valores por defecto y sólo hay que declararlos
  si se quieren ajustar.
- Antes de dar por buena la portabilidad tras el merge, volver a correr
  `./tests/gate-backup.sh` sobre el árbol ya fusionado. La corrida de este
  documento vale para `lane/d5-backup`, no para el resultado del merge.
