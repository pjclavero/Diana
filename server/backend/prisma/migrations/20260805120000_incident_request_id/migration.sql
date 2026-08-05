-- Ampliación v1.1 (mantenimiento) · correlación orden ⇄ resultado.
--
-- `request_id` es el identificador de la orden de mantenimiento
-- (`module/{id}/maintenance/command`) que el módulo repite en su respuesta
-- por `module/{id}/diagnostic` (contrato: request_id opcional en general,
-- obligatorio cuando kind="command_rejected"). Sin esta columna no hay forma
-- de saber qué diagnóstico responde a qué orden: dos pruebas de LED seguidas
-- sobre el mismo módulo eran indistinguibles en el historial.
--
-- Cambio estrictamente aditivo y reejecutable: no altera datos existentes.
ALTER TABLE "public"."incidents"
  ADD COLUMN IF NOT EXISTS "request_id" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "incidents_request_id_idx"
  ON "public"."incidents"("request_id");
