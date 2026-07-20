-- ==============================================================================
-- Diana · inicialización de PostgreSQL
-- ==============================================================================
-- Se ejecuta automáticamente una única vez, en el primer arranque del volumen
-- de datos, por la imagen oficial de postgres (docker-entrypoint-initdb.d).
-- Las migraciones de esquema (tablas, entidades del dosier §21.1) las aplica
-- el servicio `migrate` (Prisma, propiedad de WP-02), NO este fichero.
-- Este init sólo fija invariantes de la instancia: zona horaria y extensiones
-- base que el ORM pueda necesitar.
-- ==============================================================================

-- Todo el sistema opera en UTC (contracts/mqtt/README.md sección 4: el
-- backend nunca sustituye las marcas de tiempo del dispositivo/coordinador).
-- Se usa SQL dinámico porque ALTER DATABASE exige el nombre literal y el
-- entrypoint oficial de postgres no expone POSTGRES_DB como variable psql.
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END
$$;

-- Extensiones habituales para claves UUID (event_id, command_id son UUID/ULID
-- según contracts/mqtt/README.md secciones 5 y 6).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
