-- =============================================================================
-- Diana · fixture de ensayo para verify-restore.sh y gate-backup.sh
-- =============================================================================
-- NO es el esquema de producción: es un esquema reducido que reproduce los
-- rasgos que una restauración tiene que preservar y que una comprobación
-- superficial pasaría por alto:
--   - tipo enum
--   - claves primarias y ajenas (que deben quedar VIVAS, no sólo declaradas)
--   - restricción UNIQUE
--   - índice explícito
--   - columna jsonb
--   - CHECK
--   - datos con acentos y con comillas, para detectar problemas de codificación
--
-- Se usa para poder ejecutar el ensayo completo en cualquier máquina con
-- Docker, sin tocar la base real ni depender del volumen de producción.
-- =============================================================================

CREATE TYPE hit_classification AS ENUM ('valid_hit', 'rejected', 'unknown');

CREATE TABLE target_systems (
    id          uuid PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games (
    id               uuid PRIMARY KEY,
    target_system_id uuid NOT NULL REFERENCES target_systems(id),
    name             text NOT NULL,
    status           text NOT NULL DEFAULT 'draft',
    config           jsonb NOT NULL DEFAULT '{}'::jsonb,
    join_code        text NOT NULL UNIQUE,
    created_by       text NOT NULL,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT games_status_valido CHECK (status IN ('draft', 'active', 'finished'))
);

CREATE TABLE rounds (
    id          uuid PRIMARY KEY,
    game_id     uuid NOT NULL REFERENCES games(id),
    round_index integer NOT NULL,
    mode        text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rounds_game_index_unico UNIQUE (game_id, round_index)
);

CREATE TABLE participants (
    id         uuid PRIMARY KEY,
    game_id    uuid NOT NULL REFERENCES games(id),
    round_id   uuid NOT NULL REFERENCES rounds(id),
    slot       integer NOT NULL,
    guest_name text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hit_events (
    id              uuid PRIMARY KEY,
    event_id        text NOT NULL UNIQUE,
    game_id         uuid NOT NULL REFERENCES games(id),
    round_id        uuid NOT NULL REFERENCES rounds(id),
    participant_id  uuid NOT NULL REFERENCES participants(id),
    local_sequence  bigint NOT NULL,
    amplitude       integer NOT NULL,
    threshold       integer NOT NULL,
    classification  hit_classification NOT NULL DEFAULT 'unknown',
    counts_for_score boolean NOT NULL DEFAULT true,
    raw_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hit_events_game_idx ON hit_events (game_id, received_at);

CREATE TABLE shot_counts (
    id             uuid PRIMARY KEY,
    participant_id uuid NOT NULL REFERENCES participants(id),
    initial_ammo   integer NOT NULL,
    shots_fired    integer NOT NULL,
    recorded_by    text NOT NULL
);

-- Sustituto del catálogo de autoridad: interesa comprobar que un dump conserva
-- los hashes tal cual (no que sean válidos: aquí son literales de prueba).
CREATE TABLE users (
    id            uuid PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name  text NOT NULL
);

-- Datos base. Incluyen acentos y una comilla simple a propósito.
INSERT INTO target_systems (id, slug, name) VALUES
    ('00000000-0000-4000-8000-000000000001', 'sistema-base', 'Sistema de pruebas «básico»');

INSERT INTO games (id, target_system_id, name, status, config, join_code, created_by) VALUES
    ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
     'Partida de práctica O''Brien', 'active', '{"rondas": 3, "modo": "precisión"}'::jsonb,
     'BASE000000000001', 'fixture');

INSERT INTO rounds (id, game_id, round_index, mode) VALUES
    ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 1, 'precisión');

INSERT INTO participants (id, game_id, round_id, slot, guest_name) VALUES
    ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000002',
     '00000000-0000-4000-8000-000000000003', 1, 'Jugador Ñ');

INSERT INTO hit_events (id, event_id, game_id, round_id, participant_id, local_sequence,
                        amplitude, threshold, classification, raw_payload) VALUES
    ('00000000-0000-4000-8000-000000000005', 'fixture-event-1',
     '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
     '00000000-0000-4000-8000-000000000004', 1, 1500, 1000, 'valid_hit', '{"src": "fixture"}'::jsonb);

INSERT INTO shot_counts (id, participant_id, initial_ammo, shots_fired, recorded_by) VALUES
    ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', 10, 3, 'fixture');

INSERT INTO users (id, email, password_hash, display_name) VALUES
    ('00000000-0000-4000-8000-000000000007', 'operador@example.invalid',
     '$argon2id$v=19$m=65536,t=3,p=4$ZmljdGljaW8kZmljdGljaW8$0000000000000000000000000000000000000000000',
     'Operador de prueba');

-- Relleno: da al dump un tamaño realista y hace que un truncado a la mitad
-- caiga dentro de los datos, no en las cabeceras.
INSERT INTO hit_events (id, event_id, game_id, round_id, participant_id, local_sequence,
                        amplitude, threshold, classification, raw_payload)
SELECT ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
       'fill-' || g,
       '00000000-0000-4000-8000-000000000002',
       '00000000-0000-4000-8000-000000000003',
       '00000000-0000-4000-8000-000000000004',
       g, 1000 + g, 1000, 'valid_hit',
       jsonb_build_object('n', g, 'nota', 'relleno de ensayo')
FROM generate_series(1, 500) AS g;
