-- Ascenso de jugador a gestor por venta de módulo (F5, §3.1 pasos 3-5).
--
-- Hasta ahora vincular un módulo ascendía a gestor de inmediato: el código de
-- activación que exige el encargo no existía. Esta tabla guarda el código, su
-- caducidad y si se llegó a entregar, de modo que el admin pueda verlo y
-- regenerarlo aunque no haya SMTP configurado.
--
-- Aditiva y re-ejecutable: no toca datos existentes.
CREATE TABLE IF NOT EXISTS "manager_activations" (
    "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"          UUID NOT NULL,
    "module_id"        UUID,
    "code"             VARCHAR(16) NOT NULL,
    "status"           VARCHAR(16) NOT NULL DEFAULT 'pending',
    "dispatch_note"    VARCHAR(255),
    "last_dispatch_at" TIMESTAMPTZ(6),
    "expires_at"       TIMESTAMPTZ(6) NOT NULL,
    "activated_at"     TIMESTAMPTZ(6),
    "created_by"       VARCHAR(64),
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manager_activations_user_id_fkey') THEN
        ALTER TABLE "manager_activations"
            ADD CONSTRAINT "manager_activations_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manager_activations_module_id_fkey') THEN
        ALTER TABLE "manager_activations"
            ADD CONSTRAINT "manager_activations_module_id_fkey"
            FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE SET NULL;
    END IF;
END $$;

-- El código es la credencial: tiene que ser único.
CREATE UNIQUE INDEX IF NOT EXISTS "manager_activations_code_key"
    ON "manager_activations" ("code");
CREATE INDEX IF NOT EXISTS "manager_activations_user_id_status_idx"
    ON "manager_activations" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "manager_activations_status_idx"
    ON "manager_activations" ("status");
