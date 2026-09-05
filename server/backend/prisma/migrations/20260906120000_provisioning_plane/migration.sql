-- Plano DEVICE_MANAGEMENT (contrato MQTT v1.2, ADR-0008).
--
-- Tres tablas y una frontera. `provisioning_sequences` y `provisioning_orders`
-- son el lado de MANDO: lo que el backend EMITIÓ y desde dónde continúa la
-- secuencia. `provisioning_state_observations` es OBSERVACIONAL: lo que el
-- módulo REPORTÓ.
--
-- La separación no es organizativa, es de seguridad: si la secuencia de la
-- próxima orden se dedujese de `last_provisioning_sequence` reportado, quien
-- pudiera publicar en el tópico de un módulo elegiría la secuencia con la que
-- firma el backend. Por eso el contador vive en su propia tabla, del lado de
-- mando, y nada lo alimenta desde el estado reportado.

-- Contador monotónico por dispositivo. En la BASE, no en memoria: sin
-- persistencia, un reinicio del backend reemitiría secuencias ya consumidas,
-- el módulo las rechazaría (`provisioning_sequence_rejected`) y el
-- dispositivo quedaría inmanejable.
CREATE TABLE "provisioning_sequences" (
    "device_id"     VARCHAR(63)  NOT NULL,
    "last_sequence" BIGINT       NOT NULL DEFAULT 0,
    "updated_at"    TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "provisioning_sequences_pkey" PRIMARY KEY ("device_id")
);

-- La secuencia es un entero sin signo de 64 bits en el contrato, pero BIGINT
-- de PostgreSQL tiene signo: la restricción impide que un desbordamiento la
-- haga negativa y, con ello, que retroceda sin que nadie lo note.
ALTER TABLE "provisioning_sequences"
  ADD CONSTRAINT "provisioning_sequences_non_negative" CHECK ("last_sequence" >= 0);

CREATE TABLE "provisioning_orders" (
    "id"                    UUID         NOT NULL,
    "request_id"            UUID         NOT NULL,
    "device_id"             VARCHAR(63)  NOT NULL,
    "system_id"             VARCHAR(63)  NOT NULL,
    "action"                VARCHAR(16)  NOT NULL,
    "mode"                  VARCHAR(16),
    "provisioning_sequence" BIGINT       NOT NULL,
    "rotation_id"           UUID,
    "epoch"                 UUID,
    "current_epoch"         UUID,
    "next_epoch"            UUID,
    "provision_id"          UUID,
    "issued_at_ms"          BIGINT       NOT NULL,
    "actor_user_id"         UUID,
    "actor_username"        VARCHAR(64),
    "publish_outcome"       VARCHAR(16)  NOT NULL,
    "publish_reason_code"   INTEGER,
    "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provisioning_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provisioning_orders_request_id_key"
  ON "provisioning_orders"("request_id");

-- La barrera antirreplay, también en la base: dos órdenes distintas al mismo
-- dispositivo NO pueden compartir secuencia. El ORM ya reserva la secuencia de
-- forma atómica, pero una escritura directa no pasa por el ORM.
CREATE UNIQUE INDEX "provisioning_orders_device_id_provisioning_sequence_key"
  ON "provisioning_orders"("device_id", "provisioning_sequence");

CREATE INDEX "provisioning_orders_device_id_created_at_idx"
  ON "provisioning_orders"("device_id", "created_at");
CREATE INDEX "provisioning_orders_actor_user_id_created_at_idx"
  ON "provisioning_orders"("actor_user_id", "created_at");

-- El repertorio de acciones y modos es cerrado en el contrato. Se declara aquí
-- como CHECK y no como ENUM para no obligar a una migración de tipo cada vez
-- que el contrato añada una acción compatible.
ALTER TABLE "provisioning_orders"
  ADD CONSTRAINT "provisioning_orders_action_check"
  CHECK ("action" IN ('PROVISION', 'PREPARE', 'COMMIT'));
ALTER TABLE "provisioning_orders"
  ADD CONSTRAINT "provisioning_orders_mode_check"
  CHECK ("mode" IS NULL OR "mode" IN ('NORMAL', 'EMERGENCY'));
ALTER TABLE "provisioning_orders"
  ADD CONSTRAINT "provisioning_orders_outcome_check"
  CHECK ("publish_outcome" IN ('delivered', 'denied', 'timed_out', 'queued'));

-- NO_SECRET_IN_STATE: esta tabla no tiene ni puede tener una columna para
-- material secreto. `provisioning_key_fingerprint` es una HUELLA pública —un
-- identificador—, y su formato se acota aquí para que no pueda usarse como
-- campo libre donde colar otra cosa.
CREATE TABLE "provisioning_state_observations" (
    "device_id"                    VARCHAR(63)  NOT NULL,
    "system_id"                    VARCHAR(63)  NOT NULL,
    "request_id"                   UUID,
    "correlated"                   BOOLEAN      NOT NULL DEFAULT false,
    "result"                       VARCHAR(32)  NOT NULL,
    "state"                        VARCHAR(16)  NOT NULL,
    "active_epoch"                 UUID,
    "pending_epoch"                UUID,
    "rotation_id"                  UUID,
    "provision_id"                 UUID,
    "last_provisioning_sequence"   BIGINT       NOT NULL,
    "last_delegation_sequence"     BIGINT       NOT NULL,
    "provisioning_key_fingerprint" VARCHAR(64)  NOT NULL,
    "reason"                       VARCHAR(64),
    "received_at"                  TIMESTAMPTZ(6) NOT NULL,
    "updated_at"                   TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "provisioning_state_observations_pkey" PRIMARY KEY ("device_id")
);

CREATE INDEX "provisioning_state_observations_request_id_idx"
  ON "provisioning_state_observations"("request_id");

ALTER TABLE "provisioning_state_observations"
  ADD CONSTRAINT "provisioning_state_observations_fingerprint_check"
  CHECK ("provisioning_key_fingerprint" ~ '^([0-9a-f]{64})?$');

-- Los cinco estados del contrato. Ni uno más.
ALTER TABLE "provisioning_state_observations"
  ADD CONSTRAINT "provisioning_state_observations_state_check"
  CHECK ("state" IN ('UNPROVISIONED', 'READY', 'PREPARED', 'STALE', 'QUARANTINED'));

ALTER TABLE "provisioning_state_observations"
  ADD CONSTRAINT "provisioning_state_observations_result_check"
  CHECK ("result" IN ('PROVISIONED', 'PREPARED', 'COMMITTED',
                      'AUTHORITY_UNPROVISIONED', 'AUTHORITY_STALE', 'REJECTED'));

-- Un rechazo sin motivo exacto es un diagnóstico deshonesto (contrato §state).
ALTER TABLE "provisioning_state_observations"
  ADD CONSTRAINT "provisioning_state_observations_reason_required"
  CHECK ("result" <> 'REJECTED' OR "reason" IS NOT NULL);
