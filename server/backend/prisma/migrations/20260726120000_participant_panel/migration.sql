-- G-I/deuda de atribución: panel en el que juega cada participante.
-- Permite atribuir un impacto a un jugador cuando cada uno tiene su panel
-- (duelo sobre una vista). Aditiva y reejecutable.
ALTER TABLE "public"."participants"
  ADD COLUMN IF NOT EXISTS "target_system_id" UUID;

CREATE INDEX IF NOT EXISTS "participants_target_system_id_idx"
  ON "public"."participants"("target_system_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'participants_target_system_id_fkey'
  ) THEN
    ALTER TABLE "public"."participants"
      ADD CONSTRAINT "participants_target_system_id_fkey"
      FOREIGN KEY ("target_system_id") REFERENCES "public"."target_systems"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
