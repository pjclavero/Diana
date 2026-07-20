-- Verificación de las restricciones críticas de Diana.
--
-- Uso:  psql "$DATABASE_URL" -f server/database/sql/verify-constraints.sql
--
-- Sirve para comprobar en una instalación real que el esquema aplicado tiene
-- lo que exigen los ADR. Es de SÓLO LECTURA: no modifica nada.

\echo '== 1. Tablas del dosier 21.1 (deben ser 23) =='
SELECT count(*) AS tablas
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name <> '_prisma_migrations';

\echo '== 2. Idempotencia (ADR-0003): ambos índices únicos deben existir =='
SELECT indexname
FROM pg_indexes
WHERE tablename = 'hit_events'
  AND indexdef ILIKE '%UNIQUE%'
ORDER BY indexname;

\echo '== 3. Modelo temporal (ADR-0002): las cuatro marcas en columnas distintas =='
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'hit_events'
  AND column_name IN (
    'device_boot_id', 'device_uptime_us', 'device_event_us', 'device_epoch_ms',
    'coordinator_recv_us', 'coordinator_elapsed_us', 'clock_offset_us',
    'offset_uncertainty_us', 'received_at', 'persisted_at'
  )
ORDER BY column_name;

\echo '== 4. Microsegundos en BIGINT (no en double) =='
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hit_events' AND column_name LIKE '%_us'
ORDER BY column_name;

\echo '== 5. Precisión anulable (ADR-0006) =='
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'results'
  AND column_name IN ('shots_fired', 'accuracy_total', 'accuracy_valid', 'accuracy_status')
ORDER BY column_name;

\echo '== 6. Todas las marcas de tiempo son timestamptz =='
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND data_type = 'timestamp without time zone'
ORDER BY table_name, column_name;
-- La consulta anterior NO debe devolver ninguna fila.
