-- ADR-0007 · reconciliación del contrato DO-only (CONTRACT_GAP-DO-ONLY).
--
-- El esquema MQTT dejó de exigir `amplitude`/`threshold` porque el hardware
-- DO-only no tiene ADC, pero la tabla seguía declarándolos NOT NULL: un evento
-- DO-only válido según el contrato reventaba en la ingesta. Se relajan a NULL y
-- se añade el DISCRIMINADOR explícito, sin el cual un NULL sería ambiguo entre
-- "este hardware no mide" y "se perdió el dato".

CREATE TYPE "DetectionMethod" AS ENUM ('analog_envelope', 'digital_threshold');

ALTER TABLE "hit_events"
  ADD COLUMN "detection_method" "DetectionMethod" NOT NULL DEFAULT 'analog_envelope';

-- Las filas existentes son todas analógicas: se escribieron cuando el contrato
-- exigía amplitude y threshold, así que el DEFAULT las describe con exactitud.
ALTER TABLE "hit_events" ALTER COLUMN "amplitude" DROP NOT NULL;
ALTER TABLE "hit_events" ALTER COLUMN "threshold" DROP NOT NULL;

-- Regla de coherencia en la propia base: la ambigüedad no se cuela por escritura
-- directa, sólo por el ORM. Un analógico DEBE traer medida; un digital NO puede.
ALTER TABLE "hit_events"
  ADD CONSTRAINT "hit_events_detection_method_coherent" CHECK (
    ("detection_method" = 'analog_envelope'
       AND "amplitude" IS NOT NULL AND "threshold" IS NOT NULL)
    OR
    ("detection_method" = 'digital_threshold'
       AND "amplitude" IS NULL AND "threshold" IS NULL AND "noise_floor" IS NULL)
  );
