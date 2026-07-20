# Backups de Diana

## Qué hace el servicio `backup`

El contenedor `backup` (perfil por defecto, siempre presente salvo `test`)
ejecuta `backup.sh` según el cron definido en `BACKUP_CRON` (por defecto
`30 2 * * *`, las 02:30 UTC). Cada ejecución:

1. Genera un `pg_dump` en formato plano, comprimido con gzip nivel 9.
2. Lo guarda en `daily/`.
3. Los domingos, copia también a `weekly/`.
4. El día 1 de cada mes, copia también a `monthly/`.
5. Purga copias antiguas según `BACKUP_RETENTION_DAILY` / `_WEEKLY` / `_MONTHLY`.

Todo vive en el volumen nombrado `diana_backups`, montado en `/backups` dentro
del contenedor.

## Restauración

```bash
# Dentro del contenedor backup (o con `make restore`, ver Makefile):
./restore.sh /backups/daily/diana_20260720-023000.sql.gz
```

Esto **sobrescribe** la base de datos activa (`PGDATABASE`, típicamente `diana`).
No lo ejecutes contra producción sin confirmar antes con el operador —
ver la nota de memoria "No cambios en prod sin confirmar".

## Restauración de prueba aislada (recomendado antes de restaurar en real)

Restaura la copia en una base de datos temporal distinta, sin tocar la base
real, para verificar que el dump es válido y que la aplicación arranca sobre
esos datos:

```bash
./restore.sh /backups/daily/diana_20260720-023000.sql.gz --target-db diana_restore_test
```

Pasos sugeridos:

1. Ejecuta el restore anterior con `--target-db diana_restore_test`.
2. Apunta temporalmente un backend de prueba (otra instancia, o
   `DATABASE_URL` distinta en un shell) a `diana_restore_test`.
3. Verifica migraciones (`prisma migrate status` o equivalente) y una
   consulta de negocio simple (por ejemplo, contar partidas).
4. Si todo es correcto, decide si procede restaurar sobre la base real.
5. Elimina la base de prueba cuando termines:
   `psql -c 'DROP DATABASE diana_restore_test'`.

## Notas

- Los backups no contienen roles/permisos (`--no-owner --no-privileges`),
  para poder restaurarse en cualquier entorno con el usuario que sea.
- El contenedor `backup` sólo tiene red hacia `postgres`; no publica ningún
  puerto.
- Los ficheros de backup (`*.sql`, `*.dump`, y todo `backups/*`) están
  excluidos de git (ver `.gitignore`).
