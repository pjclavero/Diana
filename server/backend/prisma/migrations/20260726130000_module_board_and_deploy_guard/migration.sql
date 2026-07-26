-- F3 · D3: placa del módulo, para comparar compatibilidad con el firmware.
ALTER TABLE "public"."modules"
  ADD COLUMN IF NOT EXISTS "target_board" VARCHAR(64);

-- F3 · D2: como mucho UN despliegue en vuelo por módulo. Índice único parcial:
-- la garantía la da la base, no una comprobación previa con carrera.
CREATE UNIQUE INDEX IF NOT EXISTS "deployments_one_in_flight_per_module"
  ON "public"."deployments"("module_id")
  WHERE "status" IN ('pending', 'sent', 'downloading', 'installing');
