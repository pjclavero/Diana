-- G-D/F5 · Invitaciones de jugador por correo + configuración SMTP. Aditivo.

CREATE TABLE "public"."invitations" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(128),
    "code" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "invited_by" VARCHAR(64),
    "player_id" UUID,
    "dispatch_note" VARCHAR(255),
    "last_dispatch_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitations_code_key" ON "public"."invitations"("code");
CREATE INDEX "invitations_status_idx" ON "public"."invitations"("status");

ALTER TABLE "public"."invitations"
  ADD CONSTRAINT "invitations_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "public"."smtp_settings" (
    "id" TEXT NOT NULL,
    "host" VARCHAR(255),
    "port" INTEGER,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" VARCHAR(255),
    "password" VARCHAR(512),
    "from_address" VARCHAR(255),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "smtp_settings_pkey" PRIMARY KEY ("id")
);
