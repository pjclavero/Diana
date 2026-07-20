-- Rol de SÓLO LECTURA para consultas y cuadros de mando.
--
-- No contiene ninguna contraseña: se pasa como parámetro.
--   psql "$DATABASE_URL" -v clave="'<clave>'" -f readonly-role.sql
--
-- Motivo: nadie que sólo necesite leer debe usar el usuario propietario del
-- esquema, que puede borrar tablas.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diana_readonly') THEN
    EXECUTE format('CREATE ROLE diana_readonly LOGIN PASSWORD %L', :clave);
  END IF;
END
$$;

GRANT CONNECT ON DATABASE CURRENT_CATALOG TO diana_readonly;
GRANT USAGE ON SCHEMA public TO diana_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO diana_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO diana_readonly;

-- Nunca conceder acceso al hash de las contraseñas.
REVOKE SELECT ON TABLE users FROM diana_readonly;
