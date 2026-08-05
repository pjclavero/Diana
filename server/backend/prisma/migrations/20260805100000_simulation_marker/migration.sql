-- Marca de SIMULACIÓN en paneles y módulos.
--
-- Aditiva y reejecutable: sólo añade dos columnas con valor por defecto
-- `false`, de modo que todo lo que ya existe queda declarado como REAL, que es
-- lo que es. Ninguna fila cambia de significado.
--
-- El porqué de marcarlo en la base y no confiarlo a la propiedad del usuario:
-- la propiedad es una convención y se puede saltar por descuido; la marca
-- permite un invariante que hace IMPOSIBLE mezclar hardware real con módulos
-- inventados. Mismo criterio que con los jugadores temporales, que no pueden
-- acumular estadística porque carecen de ficha, no porque prometamos cuidado.
ALTER TABLE "target_systems" ADD COLUMN IF NOT EXISTS "simulated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "modules" ADD COLUMN IF NOT EXISTS "simulated" BOOLEAN NOT NULL DEFAULT false;

-- Consultar «lo simulado» es la operación habitual de la consola y de los
-- informes que quieran excluirlo.
CREATE INDEX IF NOT EXISTS "modules_simulated_idx" ON "modules" ("simulated");
CREATE INDEX IF NOT EXISTS "target_systems_simulated_idx" ON "target_systems" ("simulated");
