-- G-F · Presets por gestor. Cambio aditivo: el preset gana un dueño (gestor).
-- El nombre pasa a ser único POR DUEÑO (no global), para que dos gestores puedan
-- reutilizar el mismo nombre. Los presets de muestra existentes quedan con
-- owner_id NULL (visibles a todos), sin pérdida de datos.

ALTER TABLE "public"."game_presets" ADD COLUMN "owner_id" UUID;

-- El nombre ya no es único global.
DROP INDEX "public"."game_presets_name_key";

-- Único por (dueño, nombre). Con owner_id NULL, Postgres trata los NULL como
-- distintos: la unicidad de los presets de muestra se refuerza en el servicio.
CREATE UNIQUE INDEX "game_presets_owner_id_name_key" ON "public"."game_presets"("owner_id", "name");
CREATE INDEX "game_presets_owner_id_idx" ON "public"."game_presets"("owner_id");

ALTER TABLE "public"."game_presets"
  ADD CONSTRAINT "game_presets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
