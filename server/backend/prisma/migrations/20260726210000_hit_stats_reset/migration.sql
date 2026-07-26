-- Marca de reinicio de estadística sobre el impacto (F4, bloqueante B2).
--
-- Al reiniciar la estadística de un jugador los impactos se DESATRIBUYEN (son
-- telemetría inmutable, no se borran). Pero el marcador vuelve a adjudicar los
-- impactos sin dueño cuando hay un solo participante — que es el modo normal
-- del producto—, así que el reinicio se deshacía solo al recargar la pantalla:
-- el operador creía haber borrado y no había borrado.
--
-- Esta columna distingue «nunca se pudo atribuir» de «se apartó a propósito».
-- Aditiva y re-ejecutable.
ALTER TABLE "hit_events" ADD COLUMN IF NOT EXISTS "stats_reset_at" TIMESTAMPTZ(6);

-- Los que ya estaban desatribuidos por un reinicio anterior no se pueden
-- distinguir a posteriori: se dejan como están (NULL = nunca se pudo atribuir).
CREATE INDEX IF NOT EXISTS "hit_events_stats_reset_at_idx"
    ON "hit_events" ("stats_reset_at")
    WHERE "stats_reset_at" IS NOT NULL;
