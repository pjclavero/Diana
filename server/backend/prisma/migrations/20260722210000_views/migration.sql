-- G-H · Vistas (Opción B): agrupan paneles para jugar una partida sobre varios a la
-- vez. Aditivo: la partida gana un `view_id` opcional; se añaden `views` y `view_panels`.

ALTER TABLE "public"."games" ADD COLUMN "view_id" UUID;
CREATE INDEX "games_view_id_idx" ON "public"."games"("view_id");

CREATE TABLE "public"."views" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "owner_id" UUID,
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "views_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "views_name_key" ON "public"."views"("name");
CREATE INDEX "views_owner_id_idx" ON "public"."views"("owner_id");

CREATE TABLE "public"."view_panels" (
    "id" UUID NOT NULL,
    "view_id" UUID NOT NULL,
    "target_system_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "view_panels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "view_panels_view_id_target_system_id_key" ON "public"."view_panels"("view_id", "target_system_id");
CREATE INDEX "view_panels_view_id_idx" ON "public"."view_panels"("view_id");

ALTER TABLE "public"."games" ADD CONSTRAINT "games_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "public"."views"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."views" ADD CONSTRAINT "views_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."view_panels" ADD CONSTRAINT "view_panels_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "public"."views"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."view_panels" ADD CONSTRAINT "view_panels_target_system_id_fkey" FOREIGN KEY ("target_system_id") REFERENCES "public"."target_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;
