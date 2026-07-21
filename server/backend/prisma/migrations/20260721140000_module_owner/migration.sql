-- F2 · Propiedad de módulos (docs/product/alcance-panel-roles-firmware.md §0.b)
-- Cambio ADITIVO y no destructivo: nueva columna anulable + índice + FK con
-- ON DELETE SET NULL (si se borra el usuario dueño, el módulo queda libre, no
-- se borra). No toca datos existentes: todos los módulos quedan sin dueño.

-- AlterTable
ALTER TABLE "public"."modules" ADD COLUMN "owner_id" UUID;

-- CreateIndex
CREATE INDEX "modules_owner_id_idx" ON "public"."modules"("owner_id");

-- AddForeignKey
ALTER TABLE "public"."modules" ADD CONSTRAINT "modules_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
