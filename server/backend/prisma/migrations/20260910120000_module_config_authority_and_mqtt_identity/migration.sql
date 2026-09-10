-- =============================================================================
-- T2 · `config_version` deja de ser UN entero ambiguo y pasa a ser DOS, con
--      estado explícito, y T4 · credencial MQTT individual por módulo.
-- =============================================================================
--
-- ── T2 ───────────────────────────────────────────────────────────────────────
-- `modules.config_version` mezclaba dos cosas incompatibles: lo que el sistema
-- QUIERE que corra el módulo y lo que el módulo dice que corre. `config/push`
-- escribía `config_version + 1` en esa misma columna sin haber recibido nada,
-- de modo que la base afirmaba «el módulo está en la versión 8» cuando lo único
-- cierto era «se publicó la versión 8 y nadie sabe si llegó». Con un módulo
-- físico que no aplique la configuración, esa columna miente en silencio.
--
-- La columna existente se RENOMBRA a `desired_config_version` en vez de
-- crearse otra: su contenido es, literalmente, la última deseada publicada.
-- Renombrar conserva el dato y hace imposible que quede una columna vieja
-- alimentando código antiguo.
--
-- `reported_config_version` nace NULL a propósito: NULL significa «el módulo
-- no ha reportado nunca», que es distinto de «reportó la 0». Con 0 dispositivos
-- conectados, ninguna fila puede tener una versión reportada — y esta migración
-- no fabrica ninguna.
--
-- El ORDEN entre versiones es el ENTERO, nunca el reloj. `config_applied_at` es
-- observacional y no participa en ninguna comparación: si un módulo con el
-- reloj adelantado reportase una versión menor, seguiría siendo menor.
--
-- ── T4 ───────────────────────────────────────────────────────────────────────
-- `module_mqtt_credentials` es el registro de la autoridad de credenciales del
-- servidor. NO_SECRET_AT_REST: no hay columna para la contraseña, ni la habrá.
-- Sólo un hash bcrypt (verificable, no reversible) y una huella pública.

-- ---------------------------------------------------------------------------
-- T2
-- ---------------------------------------------------------------------------
ALTER TABLE "modules" RENAME COLUMN "config_version" TO "desired_config_version";

ALTER TABLE "modules" ADD COLUMN "reported_config_version" INTEGER;
ALTER TABLE "modules" ADD COLUMN "config_state" VARCHAR(8) NOT NULL DEFAULT 'pending';
ALTER TABLE "modules" ADD COLUMN "config_applied_at" TIMESTAMPTZ(6);

-- Monotonía por construcción: una versión negativa no es «antigua», es un
-- desbordamiento o un error de cálculo, y la base no la acepta.
ALTER TABLE "modules"
  ADD CONSTRAINT "modules_desired_config_version_non_negative"
  CHECK ("desired_config_version" >= 0);
ALTER TABLE "modules"
  ADD CONSTRAINT "modules_reported_config_version_non_negative"
  CHECK ("reported_config_version" IS NULL OR "reported_config_version" >= 0);

-- El repertorio de estados es cerrado. Se declara como CHECK y no como ENUM por
-- coherencia con `provisioning_orders`, que ya lo hace así.
ALTER TABLE "modules"
  ADD CONSTRAINT "modules_config_state_check"
  CHECK ("config_state" IN ('pending', 'applied', 'failed'));

-- Un módulo no puede estar `applied` sin haber reportado, y no puede estar
-- `applied` con una versión reportada distinta de la deseada. Esto es lo que
-- impide que el backend se declare a sí mismo satisfecho: para llegar a
-- `applied` hace falta un `config/reported` REAL del dispositivo.
ALTER TABLE "modules"
  ADD CONSTRAINT "modules_config_applied_requires_report"
  CHECK (
    "config_state" <> 'applied'
    OR ("reported_config_version" IS NOT NULL
        AND "reported_config_version" = "desired_config_version")
  );

-- Igual con la marca observacional: no hay `applied_at` sin confirmación.
ALTER TABLE "modules"
  ADD CONSTRAINT "modules_config_applied_at_requires_report"
  CHECK ("config_applied_at" IS NULL OR "reported_config_version" IS NOT NULL);

-- Backfill honesto: nada ha sido reportado nunca, así que TODA fila existente
-- queda `pending`, que es el valor por defecto. No se toca la deseada.
UPDATE "modules"
   SET "config_state" = 'pending',
       "reported_config_version" = NULL,
       "config_applied_at" = NULL;

CREATE INDEX "modules_config_state_idx" ON "modules"("config_state");

-- ---------------------------------------------------------------------------
-- T4
-- ---------------------------------------------------------------------------
CREATE TABLE "module_mqtt_credentials" (
    "id"                 UUID           NOT NULL,
    "module_id"          UUID           NOT NULL,
    "username"           VARCHAR(63)    NOT NULL,
    "secret_hash"        VARCHAR(255)   NOT NULL,
    "fingerprint"        VARCHAR(16)    NOT NULL,
    "generation"         INTEGER        NOT NULL DEFAULT 1,
    "issued_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at"       TIMESTAMPTZ(6) NOT NULL,
    "revoked_at"         TIMESTAMPTZ(6),
    "issued_by_user_id"  UUID,
    "issued_by_username" VARCHAR(64),
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "module_mqtt_credentials_pkey" PRIMARY KEY ("id")
);

-- UNA identidad por dispositivo, en los dos sentidos: un módulo no puede tener
-- dos credenciales vivas, y un usuario del broker no puede pertenecer a dos
-- módulos. Sin estos dos índices, «compartir credencial» sería sólo un error de
-- código; con ellos es imposible de escribir.
CREATE UNIQUE INDEX "module_mqtt_credentials_module_id_key"
  ON "module_mqtt_credentials"("module_id");
CREATE UNIQUE INDEX "module_mqtt_credentials_username_key"
  ON "module_mqtt_credentials"("username");

ALTER TABLE "module_mqtt_credentials"
  ADD CONSTRAINT "module_mqtt_credentials_module_id_fkey"
  FOREIGN KEY ("module_id") REFERENCES "modules"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- La huella es pública y de formato fijo: acotarla impide usar la columna como
-- campo libre donde acabe colándose el propio secreto.
ALTER TABLE "module_mqtt_credentials"
  ADD CONSTRAINT "module_mqtt_credentials_fingerprint_check"
  CHECK ("fingerprint" ~ '^[0-9a-f]{16}$');

-- El hash tiene que SER un hash bcrypt. Un `secret_hash` que no empiece por
-- `$2a$`/`$2b$`/`$2y$` es, con toda probabilidad, una contraseña en claro que
-- alguien guardó por error en la columna equivocada; la base lo rechaza.
ALTER TABLE "module_mqtt_credentials"
  ADD CONSTRAINT "module_mqtt_credentials_secret_hash_is_bcrypt"
  CHECK ("secret_hash" ~ '^\$2[aby]\$[0-9]{2}\$.{53}$');

ALTER TABLE "module_mqtt_credentials"
  ADD CONSTRAINT "module_mqtt_credentials_generation_positive"
  CHECK ("generation" >= 1);
