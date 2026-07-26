-- G-I · D6: instante en que el módulo se dio por caído. Es el origen real de la
-- cuenta atrás de reconexión: `last_seen_at` no sirve, porque un LWT retenido
-- reentregado la reiniciaría. Aditiva y reejecutable.
ALTER TABLE "public"."modules"
  ADD COLUMN IF NOT EXISTS "offline_since" TIMESTAMPTZ(6);
