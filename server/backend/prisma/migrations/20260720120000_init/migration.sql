-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."SystemState" AS ENUM ('idle', 'configuring', 'ready', 'game_running', 'degraded', 'maintenance');

-- CreateEnum
CREATE TYPE "public"."ModuleRole" AS ENUM ('principal', 'satellite', 'auto');

-- CreateEnum
CREATE TYPE "public"."SelectorPosition" AS ENUM ('SATELITE', 'AUTO', 'PRINCIPAL');

-- CreateEnum
CREATE TYPE "public"."ModuleState" AS ENUM ('boot', 'selftest', 'network', 'registering', 'ready', 'calibration', 'maintenance', 'game_prepare', 'game_countdown', 'game_active', 'game_paused', 'game_finished', 'error');

-- CreateEnum
CREATE TYPE "public"."TargetState" AS ENUM ('off', 'safe', 'active', 'hit', 'countdown', 'penalty', 'error', 'calibration', 'locked', 'sensor_error', 'maintenance', 'disabled');

-- CreateEnum
CREATE TYPE "public"."CalibrationSource" AS ENUM ('manual', 'auto', 'reported', 'factory');

-- CreateEnum
CREATE TYPE "public"."GameStatus" AS ENUM ('draft', 'armed', 'running', 'paused', 'finished', 'aborted');

-- CreateEnum
CREATE TYPE "public"."RoundPhase" AS ENUM ('armed', 'countdown', 'running', 'paused', 'finished', 'aborted');

-- CreateEnum
CREATE TYPE "public"."HitClassification" AS ENUM ('valid_hit', 'hit_on_safe', 'hit_on_already_hit', 'out_of_order', 'crosstalk_rejected', 'ambiguous', 'during_pause', 'calibration_hit', 'early_shot');

-- CreateEnum
CREATE TYPE "public"."ShotCountSource" AS ENUM ('manual', 'auto_counter', 'full_magazine');

-- CreateEnum
CREATE TYPE "public"."PenaltyKind" AS ENUM ('wrong_target', 'hit_on_safe', 'hit_on_already_hit', 'out_of_order', 'early_shot', 'during_pause', 'manual');

-- CreateEnum
CREATE TYPE "public"."AccuracyStatus" AS ENUM ('computed', 'not_computable');

-- CreateEnum
CREATE TYPE "public"."StatisticScope" AS ENUM ('player', 'team', 'game', 'round', 'global');

-- CreateEnum
CREATE TYPE "public"."DeploymentStatus" AS ENUM ('pending', 'sent', 'downloading', 'installing', 'success', 'failed', 'rolled_back');

-- CreateEnum
CREATE TYPE "public"."IncidentSeverity" AS ENUM ('info', 'warning', 'error', 'critical');

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "description" VARCHAR(255),
    "permissions" TEXT[],
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "email" VARCHAR(255),
    "display_name" VARCHAR(128),
    "password_hash" VARCHAR(255) NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "role_id" UUID NOT NULL,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teams" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."players" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(128) NOT NULL,
    "first_name" VARCHAR(64),
    "last_name" VARCHAR(64),
    "birth_date" DATE,
    "licence" VARCHAR(64),
    "notes" VARCHAR(1024),
    "team_id" UUID,
    "user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."target_systems" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "state" "public"."SystemState" NOT NULL DEFAULT 'idle',
    "coordinator_module_id" UUID,
    "modules_expected" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "target_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."modules" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "target_system_id" UUID,
    "friendly_name" VARCHAR(128),
    "serial" VARCHAR(64),
    "mac" VARCHAR(17),
    "ip" VARCHAR(45),
    "hardware_revision" VARCHAR(32),
    "firmware_version" VARCHAR(32),
    "role" "public"."ModuleRole",
    "selector" "public"."SelectorPosition",
    "state" "public"."ModuleState",
    "online" BOOLEAN NOT NULL DEFAULT false,
    "boot_id" UUID,
    "queue_depth" INTEGER NOT NULL DEFAULT 0,
    "config_version" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(6),
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."module_positions" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "target_system_id" UUID NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" VARCHAR(64),

    CONSTRAINT "module_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."targets" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "target_index" SMALLINT NOT NULL,
    "label" VARCHAR(64),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "state" "public"."TargetState" NOT NULL DEFAULT 'off',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sensor_calibrations" (
    "id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "threshold" INTEGER NOT NULL,
    "hysteresis" INTEGER NOT NULL,
    "noise_floor" INTEGER,
    "blanking_us" INTEGER NOT NULL,
    "group_window_us" INTEGER NOT NULL,
    "neighbour_ratio" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "source" "public"."CalibrationSource" NOT NULL DEFAULT 'manual',
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "calibrated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calibrated_by" VARCHAR(64),

    CONSTRAINT "sensor_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."game_modes" (
    "id" UUID NOT NULL,
    "key" VARCHAR(48) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(1024),
    "params_schema" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "game_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."game_presets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "game_mode_id" UUID NOT NULL,
    "config" JSONB NOT NULL,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "game_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."games" (
    "id" UUID NOT NULL,
    "target_system_id" UUID NOT NULL,
    "game_mode_id" UUID NOT NULL,
    "game_preset_id" UUID,
    "name" VARCHAR(128),
    "status" "public"."GameStatus" NOT NULL DEFAULT 'draft',
    "seed" BIGINT,
    "config" JSONB NOT NULL,
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "armed_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rounds" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "round_index" INTEGER NOT NULL,
    "phase" "public"."RoundPhase" NOT NULL DEFAULT 'armed',
    "mode" VARCHAR(48) NOT NULL,
    "seed" BIGINT,
    "plan" JSONB,
    "countdown_ms" INTEGER NOT NULL DEFAULT 3000,
    "time_limit_ms" INTEGER,
    "penalty_ms" INTEGER NOT NULL DEFAULT 0,
    "strict_order" BOOLEAN NOT NULL DEFAULT false,
    "reaction_delay_min_ms" INTEGER,
    "reaction_delay_max_ms" INTEGER,
    "duration_us" BIGINT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."participants" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "round_id" UUID,
    "player_id" UUID,
    "team_id" UUID,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "lane" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hit_events" (
    "id" UUID NOT NULL,
    "event_id" VARCHAR(64) NOT NULL,
    "target_system_id" UUID,
    "system_slug" VARCHAR(63) NOT NULL,
    "module_id" UUID,
    "module_slug" VARCHAR(63) NOT NULL,
    "target_id" UUID,
    "target_index" SMALLINT NOT NULL,
    "game_id" UUID,
    "round_id" UUID,
    "participant_id" UUID,
    "module_position_x" SMALLINT,
    "module_position_y" SMALLINT,
    "module_rotation" SMALLINT,
    "local_sequence" BIGINT NOT NULL,
    "device_boot_id" UUID NOT NULL,
    "device_uptime_us" BIGINT NOT NULL,
    "device_event_us" BIGINT NOT NULL,
    "device_epoch_ms" BIGINT,
    "coordinator_recv_us" BIGINT,
    "coordinator_elapsed_us" BIGINT,
    "clock_offset_us" BIGINT,
    "offset_uncertainty_us" BIGINT,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "persisted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amplitude" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "noise_floor" INTEGER,
    "neighbours" JSONB,
    "target_state_before" "public"."TargetState" NOT NULL,
    "classification" "public"."HitClassification" NOT NULL,
    "classification_reason" VARCHAR(120),
    "firmware_version" VARCHAR(32) NOT NULL,
    "replay" BOOLEAN NOT NULL DEFAULT false,
    "out_of_window" BOOLEAN NOT NULL DEFAULT false,
    "out_of_window_reason" VARCHAR(255),
    "counts_for_score" BOOLEAN NOT NULL DEFAULT false,
    "raw_payload" JSONB NOT NULL,

    CONSTRAINT "hit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shot_counts" (
    "id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "source" "public"."ShotCountSource" NOT NULL DEFAULT 'manual',
    "initial_ammo" INTEGER NOT NULL,
    "remaining_ammo" INTEGER,
    "remaining_known" BOOLEAN NOT NULL DEFAULT false,
    "must_use_all_ammo" BOOLEAN NOT NULL DEFAULT false,
    "shots_fired" INTEGER,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" VARCHAR(64),

    CONSTRAINT "shot_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."penalties" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "participant_id" UUID,
    "hit_event_id" UUID,
    "kind" "public"."PenaltyKind" NOT NULL,
    "penalty_ms" INTEGER NOT NULL,
    "reason" VARCHAR(255),
    "applied_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."results" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "position" INTEGER,
    "score" INTEGER NOT NULL DEFAULT 0,
    "total_time_us" BIGINT,
    "first_hit_us" BIGINT,
    "detected_hits" INTEGER NOT NULL DEFAULT 0,
    "valid_hits" INTEGER NOT NULL DEFAULT 0,
    "invalid_hits" INTEGER NOT NULL DEFAULT 0,
    "penalties_count" INTEGER NOT NULL DEFAULT 0,
    "penalties_ms" INTEGER NOT NULL DEFAULT 0,
    "initial_ammo" INTEGER,
    "remaining_ammo" INTEGER,
    "shots_fired" INTEGER,
    "accuracy_total" DOUBLE PRECISION,
    "accuracy_valid" DOUBLE PRECISION,
    "accuracy_status" "public"."AccuracyStatus" NOT NULL DEFAULT 'not_computable',
    "accuracy_reason" VARCHAR(255),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."statistics" (
    "id" UUID NOT NULL,
    "scope" "public"."StatisticScope" NOT NULL,
    "metric" VARCHAR(64) NOT NULL,
    "player_id" UUID,
    "game_id" UUID,
    "round_id" UUID,
    "value" DOUBLE PRECISION,
    "value_json" JSONB,
    "period_start" TIMESTAMPTZ(6),
    "period_end" TIMESTAMPTZ(6),
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."firmware_versions" (
    "id" UUID NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "target_board" VARCHAR(64) NOT NULL,
    "url" VARCHAR(512) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "signature" VARCHAR(1024),
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(1024),
    "released_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" VARCHAR(64),

    CONSTRAINT "firmware_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deployments" (
    "id" UUID NOT NULL,
    "firmware_version_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "status" "public"."DeploymentStatus" NOT NULL DEFAULT 'pending',
    "command_id" UUID,
    "previous_version" VARCHAR(32),
    "error" VARCHAR(512),
    "requested_by" VARCHAR(64),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."incidents" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "severity" "public"."IncidentSeverity" NOT NULL DEFAULT 'warning',
    "source" VARCHAR(64) NOT NULL,
    "module_id" UUID,
    "target_system_id" UUID,
    "event_id" VARCHAR(64),
    "message" VARCHAR(1024) NOT NULL,
    "detail" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" VARCHAR(64),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_username" VARCHAR(64),
    "actor_role" VARCHAR(32),
    "action" VARCHAR(64) NOT NULL,
    "entity" VARCHAR(64) NOT NULL,
    "entity_id" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "public"."roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "public"."users"("role_id");

-- CreateIndex
CREATE INDEX "users_active_idx" ON "public"."users"("active");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "public"."teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "players_licence_key" ON "public"."players"("licence");

-- CreateIndex
CREATE INDEX "players_team_id_idx" ON "public"."players"("team_id");

-- CreateIndex
CREATE INDEX "players_display_name_idx" ON "public"."players"("display_name");

-- CreateIndex
CREATE UNIQUE INDEX "target_systems_slug_key" ON "public"."target_systems"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "modules_slug_key" ON "public"."modules"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "modules_serial_key" ON "public"."modules"("serial");

-- CreateIndex
CREATE INDEX "modules_target_system_id_idx" ON "public"."modules"("target_system_id");

-- CreateIndex
CREATE INDEX "modules_online_idx" ON "public"."modules"("online");

-- CreateIndex
CREATE UNIQUE INDEX "module_positions_module_id_key" ON "public"."module_positions"("module_id");

-- CreateIndex
CREATE INDEX "module_positions_target_system_id_idx" ON "public"."module_positions"("target_system_id");

-- CreateIndex
CREATE UNIQUE INDEX "module_positions_target_system_id_x_y_key" ON "public"."module_positions"("target_system_id", "x", "y");

-- CreateIndex
CREATE INDEX "targets_module_id_idx" ON "public"."targets"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "targets_module_id_target_index_key" ON "public"."targets"("module_id", "target_index");

-- CreateIndex
CREATE INDEX "sensor_calibrations_target_id_calibrated_at_idx" ON "public"."sensor_calibrations"("target_id", "calibrated_at");

-- CreateIndex
CREATE UNIQUE INDEX "game_modes_key_key" ON "public"."game_modes"("key");

-- CreateIndex
CREATE UNIQUE INDEX "game_presets_name_key" ON "public"."game_presets"("name");

-- CreateIndex
CREATE INDEX "game_presets_game_mode_id_idx" ON "public"."game_presets"("game_mode_id");

-- CreateIndex
CREATE INDEX "games_target_system_id_created_at_idx" ON "public"."games"("target_system_id", "created_at");

-- CreateIndex
CREATE INDEX "games_status_idx" ON "public"."games"("status");

-- CreateIndex
CREATE INDEX "games_created_at_idx" ON "public"."games"("created_at");

-- CreateIndex
CREATE INDEX "rounds_game_id_idx" ON "public"."rounds"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_game_id_round_index_key" ON "public"."rounds"("game_id", "round_index");

-- CreateIndex
CREATE INDEX "participants_player_id_idx" ON "public"."participants"("player_id");

-- CreateIndex
CREATE INDEX "participants_game_id_idx" ON "public"."participants"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_game_id_slot_round_id_key" ON "public"."participants"("game_id", "slot", "round_id");

-- CreateIndex
CREATE UNIQUE INDEX "hit_events_event_id_key" ON "public"."hit_events"("event_id");

-- CreateIndex
CREATE INDEX "hit_events_round_id_device_event_us_idx" ON "public"."hit_events"("round_id", "device_event_us");

-- CreateIndex
CREATE INDEX "hit_events_game_id_classification_idx" ON "public"."hit_events"("game_id", "classification");

-- CreateIndex
CREATE INDEX "hit_events_participant_id_idx" ON "public"."hit_events"("participant_id");

-- CreateIndex
CREATE INDEX "hit_events_module_slug_received_at_idx" ON "public"."hit_events"("module_slug", "received_at");

-- CreateIndex
CREATE INDEX "hit_events_received_at_idx" ON "public"."hit_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "hit_events_module_slug_device_boot_id_local_sequence_key" ON "public"."hit_events"("module_slug", "device_boot_id", "local_sequence");

-- CreateIndex
CREATE INDEX "shot_counts_participant_id_recorded_at_idx" ON "public"."shot_counts"("participant_id", "recorded_at");

-- CreateIndex
CREATE INDEX "penalties_round_id_idx" ON "public"."penalties"("round_id");

-- CreateIndex
CREATE INDEX "penalties_participant_id_idx" ON "public"."penalties"("participant_id");

-- CreateIndex
CREATE UNIQUE INDEX "penalties_hit_event_id_key" ON "public"."penalties"("hit_event_id");

-- CreateIndex
CREATE INDEX "results_participant_id_computed_at_idx" ON "public"."results"("participant_id", "computed_at");

-- CreateIndex
CREATE UNIQUE INDEX "results_round_id_participant_id_key" ON "public"."results"("round_id", "participant_id");

-- CreateIndex
CREATE INDEX "statistics_player_id_metric_idx" ON "public"."statistics"("player_id", "metric");

-- CreateIndex
CREATE INDEX "statistics_computed_at_idx" ON "public"."statistics"("computed_at");

-- CreateIndex
CREATE UNIQUE INDEX "statistics_scope_metric_player_id_game_id_round_id_period_s_key" ON "public"."statistics"("scope", "metric", "player_id", "game_id", "round_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "firmware_versions_version_target_board_key" ON "public"."firmware_versions"("version", "target_board");

-- CreateIndex
CREATE INDEX "deployments_module_id_started_at_idx" ON "public"."deployments"("module_id", "started_at");

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "public"."deployments"("status");

-- CreateIndex
CREATE INDEX "incidents_occurred_at_idx" ON "public"."incidents"("occurred_at");

-- CreateIndex
CREATE INDEX "incidents_severity_occurred_at_idx" ON "public"."incidents"("severity", "occurred_at");

-- CreateIndex
CREATE INDEX "incidents_module_id_occurred_at_idx" ON "public"."incidents"("module_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "public"."audit_log"("created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "public"."audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "public"."audit_log"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."players" ADD CONSTRAINT "players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."players" ADD CONSTRAINT "players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."modules" ADD CONSTRAINT "modules_target_system_id_fkey" FOREIGN KEY ("target_system_id") REFERENCES "public"."target_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."module_positions" ADD CONSTRAINT "module_positions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."module_positions" ADD CONSTRAINT "module_positions_target_system_id_fkey" FOREIGN KEY ("target_system_id") REFERENCES "public"."target_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."targets" ADD CONSTRAINT "targets_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sensor_calibrations" ADD CONSTRAINT "sensor_calibrations_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."game_presets" ADD CONSTRAINT "game_presets_game_mode_id_fkey" FOREIGN KEY ("game_mode_id") REFERENCES "public"."game_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."games" ADD CONSTRAINT "games_target_system_id_fkey" FOREIGN KEY ("target_system_id") REFERENCES "public"."target_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."games" ADD CONSTRAINT "games_game_mode_id_fkey" FOREIGN KEY ("game_mode_id") REFERENCES "public"."game_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."games" ADD CONSTRAINT "games_game_preset_id_fkey" FOREIGN KEY ("game_preset_id") REFERENCES "public"."game_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rounds" ADD CONSTRAINT "rounds_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."participants" ADD CONSTRAINT "participants_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."participants" ADD CONSTRAINT "participants_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."participants" ADD CONSTRAINT "participants_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."participants" ADD CONSTRAINT "participants_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hit_events" ADD CONSTRAINT "hit_events_target_system_id_fkey" FOREIGN KEY ("target_system_id") REFERENCES "public"."target_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hit_events" ADD CONSTRAINT "hit_events_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hit_events" ADD CONSTRAINT "hit_events_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hit_events" ADD CONSTRAINT "hit_events_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hit_events" ADD CONSTRAINT "hit_events_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hit_events" ADD CONSTRAINT "hit_events_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."shot_counts" ADD CONSTRAINT "shot_counts_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."penalties" ADD CONSTRAINT "penalties_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."penalties" ADD CONSTRAINT "penalties_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."penalties" ADD CONSTRAINT "penalties_hit_event_id_fkey" FOREIGN KEY ("hit_event_id") REFERENCES "public"."hit_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."results" ADD CONSTRAINT "results_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."results" ADD CONSTRAINT "results_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."statistics" ADD CONSTRAINT "statistics_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."statistics" ADD CONSTRAINT "statistics_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."statistics" ADD CONSTRAINT "statistics_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deployments" ADD CONSTRAINT "deployments_firmware_version_id_fkey" FOREIGN KEY ("firmware_version_id") REFERENCES "public"."firmware_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deployments" ADD CONSTRAINT "deployments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."incidents" ADD CONSTRAINT "incidents_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."incidents" ADD CONSTRAINT "incidents_target_system_id_fkey" FOREIGN KEY ("target_system_id") REFERENCES "public"."target_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

