-- G-D · Unirse a una partida por QR. Cambio aditivo: la partida gana un código de
-- unión corto y único (regenerable). Sin pérdida de datos.

ALTER TABLE "public"."games" ADD COLUMN "join_code" VARCHAR(16);
CREATE UNIQUE INDEX "games_join_code_key" ON "public"."games"("join_code");
