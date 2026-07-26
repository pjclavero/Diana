-- G-H · Matrices favoritas: instantáneas con nombre de la colocación de módulos.
-- Aditiva: no altera ni borra nada existente.
CREATE TABLE IF NOT EXISTS "public"."matrix_layouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "owner_id" UUID,
    "origin_system_id" UUID,
    "cells" JSONB NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "matrix_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "matrix_layouts_owner_id_name_key" ON "public"."matrix_layouts"("owner_id", "name");
CREATE INDEX IF NOT EXISTS "matrix_layouts_owner_id_idx" ON "public"."matrix_layouts"("owner_id");

-- Reejecutable: el despliegue de este proyecto ha reintentado migraciones ya
-- aplicadas más de una vez (incidencia del `migrate` one-shot en `up -d`).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matrix_layouts_owner_id_fkey'
  ) THEN
    ALTER TABLE "public"."matrix_layouts"
      ADD CONSTRAINT "matrix_layouts_owner_id_fkey"
      FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
