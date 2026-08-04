-- F6 · Conserva la identidad MQTT y separa T1 de T3 en los diagnósticos.
--
-- `module_slug` impide que un diagnóstico recibido antes del alta del módulo
-- quede invisible para siempre. `device_occurred_at` sólo se rellena cuando el
-- módulo aporta `device.epoch_ms`; `device_event_us` se conserva como reloj
-- monotónico y jamás se convierte artificialmente en una fecha civil.
--
-- Cambio estrictamente aditivo y reejecutable: no altera datos existentes.
ALTER TABLE "public"."incidents"
  ADD COLUMN IF NOT EXISTS "module_slug" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "device_occurred_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "device_event_us" BIGINT,
  ADD COLUMN IF NOT EXISTS "device_epoch_ms" BIGINT,
  ADD COLUMN IF NOT EXISTS "device_boot_id" UUID;

CREATE INDEX IF NOT EXISTS "incidents_module_slug_occurred_at_idx"
  ON "public"."incidents"("module_slug", "occurred_at");
