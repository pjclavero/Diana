-- G-D.2 · Jugadores temporales. Cambio aditivo: un participante puede ser una
-- identidad TEMPORAL por partida (nombre suelto, sin Player ni User, sin estadística
-- acumulada), excluyente con player_id. Sin pérdida de datos.

ALTER TABLE "public"."participants" ADD COLUMN "guest_name" VARCHAR(128);
