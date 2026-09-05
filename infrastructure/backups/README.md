# Backups de Diana

## El contrato

Un backup no se da por bueno porque el script devuelva `rc=0`:

```
BACKUP_SUCCESS = el proceso terminó correctamente
               + el artefacto existe
               + tamaño/plausibilidad mínima
               + contenido verificable (estructura de dump real)
               + la restauración/verificación pasa
```

El motivo es un fallo **medido en producción** (2026-08-09, VM109): sin
`pipefail`, un `pg_dump` fallido dejaba un `.sql.gz` perfectamente válido de
~20 bytes, se copiaba a `weekly/` y el script imprimía «finalizado
correctamente» con `rc=0`. Un backup que miente es peor que no tener backup.

## Qué hace el servicio `backup`

El contenedor `backup` (perfil por defecto, siempre presente salvo `test`)
ejecuta `backup.sh` según el cron definido en `BACKUP_CRON` (por defecto
`30 2 * * *`, las 02:30 UTC). Cada ejecución:

1. Genera un `pg_dump` en formato plano, comprimido con gzip nivel 9,
   **en `/backups/.staging/`** — con un nombre que todavía no es el definitivo.
2. **Verifica el artefacto antes de publicarlo**: `pg_dump` y `gzip` devolvieron
   0 (vía `PIPESTATUS`, no un `$?` implícito), el fichero existe, supera el
   tamaño mínimo comprimido y sin comprimir, `gzip -t` pasa, tiene la cabecera
   y el marcador de cierre de `pg_dump`, y contiene sentencias SQL reales.
3. **Publica atómicamente**: sólo entonces `mv` (rename(2)) a
   `daily/diana_YYYYMMDD-HHMMSS.sql.gz`, con permisos `600` y su `.sha256` al
   lado. Si el nombre ya estuviera ocupado, **aborta** en vez de sobrescribir.
4. Los domingos copia también a `weekly/`; el día 1 de cada mes, a `monthly/`
   (mismo patrón: fichero temporal, verificación de sha256 y `mv`).
5. Purga copias antiguas según `BACKUP_RETENTION_DAILY` / `_WEEKLY` / `_MONTHLY`.
   **La purga sólo corre si la copia nueva se publicó**: nunca se tira una copia
   buena a cambio de una mala.
6. Escribe `/backups/last-status` (`OK …` / `FAIL … <motivo>`). El fichero se
   deja en `FAIL` desde el principio, así que un proceso muerto a media
   ejecución no puede parecer un éxito.

Todo vive en el volumen nombrado `diana_backups`, montado en `/backups` dentro
del contenedor.

### Ajustes

| Variable | Por defecto | Para qué |
|---|---|---|
| `BACKUP_RETENTION_DAILY` / `_WEEKLY` / `_MONTHLY` | 7 / 4 / 6 | retención |
| `BACKUP_MIN_BYTES` | 512 | tamaño mínimo del `.gz` publicado |
| `BACKUP_MIN_PLAIN_BYTES` | 2048 | tamaño mínimo del SQL sin comprimir |
| `BACKUP_MIN_STATEMENTS` | 5 | sentencias SQL mínimas en el volcado |

Los umbrales son deliberadamente bajos: sirven para descartar basura, no para
adivinar el tamaño «correcto» del dump. Súbelos cuando se conozca el tamaño
real estable de la base en producción.

`backup.sh` y `restore.sh` requieren **bash** (por `pipefail` y `PIPESTATUS`).
La imagen `postgres:16.4-alpine` del servicio `backup` lo incluye — verificado.

## Restauración

```bash
# Dentro del contenedor backup:
./restore.sh /backups/daily/diana_20260720-023000.sql.gz
```

Esto **sobrescribe** la base de datos activa (`PGDATABASE`, típicamente `diana`).
No lo ejecutes contra producción sin confirmar antes con el operador.

`restore.sh` verifica el fichero **antes** de tocar ninguna base (tamaño,
`gzip -t`, `.sha256` acompañante si existe, cabecera y marcador de cierre) y el
resultado **después** (rc de `psql` capturado explícitamente, y la base destino
tiene que tener tablas). Un `.sql.gz` truncado ya no puede darse por bueno.

## Restauración de prueba aislada

```bash
./restore.sh /backups/daily/diana_20260720-023000.sql.gz --target-db diana_restore_test
```

Crea esa base si no existe y restaura ahí, sin tocar la base real. Elimínala al
terminar: `psql -c 'DROP DATABASE diana_restore_test'`.

## Ensayo completo: `verify-restore.sh`

Demuestra la cadena entera en contenedores desechables — **nunca contra la base
real**:

```
DATOS + MARCADORES → BACKUP REAL → RESTAURACIÓN AISLADA → DATOS VERIFICADOS
```

```bash
./verify-restore.sh                        # autocontenido, en cualquier máquina con Docker
VERIFY_SEED=prod ./verify-restore.sh       # en la VM de Diana: siembra con la última copia real (sólo lectura)
VERIFY_USE_SCHEDULER=1 ./verify-restore.sh # la copia la dispara el planificador real, no el operador
```

Comprueba marcadores, datos, esquema, índices, enums y que las constraints
(FK, UNIQUE, CHECK) están **vivas**, no sólo declaradas; compara la huella
completa origen/destino; y termina con un **control positivo**: repite la
verificación contra copias truncada, vacía y alterada, que *deben* fallar. Si
no fallan, el ensayo no vale nada y el script termina en error.

## Calibración del gate: `tests/gate-backup.sh`

Un gate que nunca se pone rojo no protege nada. Este arnés **provoca de verdad**
cada modo de fallo con un `pg_dump` postizo y comprueba que `backup.sh` lo
rechaza — sin tocar ninguna base real:

```bash
./tests/gate-backup.sh                    # negativos + control positivo completo
GATE_SKIP_POSITIVE=1 ./tests/gate-backup.sh   # sólo los negativos (rápido, sin PostgreSQL)
```

Resultados y calibración congelados en `docs/coordination/D5-BACKUP-EVIDENCIA.md`.

## Notas

- Los backups no contienen roles/permisos (`--no-owner --no-privileges`),
  para poder restaurarse en cualquier entorno con el usuario que sea.
- El volcado contiene hashes de contraseña: las copias publicadas se dejan en
  `600` y nunca se imprimen credenciales en el log ni en `argv`.
- El contenedor `backup` sólo tiene red hacia `postgres`; no publica ningún
  puerto.
- Los ficheros de backup (`*.sql`, `*.dump`, y todo `backups/*`) están
  excluidos de git (ver `.gitignore`).
