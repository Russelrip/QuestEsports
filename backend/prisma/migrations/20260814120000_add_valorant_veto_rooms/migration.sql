CREATE TYPE "VetoRoomStatus" AS ENUM ('draft', 'open', 'toss_pending', 'toss_complete', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "VetoControlMode" AS ENUM ('captain_or_link', 'link_only', 'staff_only');
CREATE TYPE "VetoTeamOrderMethod" AS ENUM ('toss', 'slot_order', 'higher_seed', 'lower_seed', 'staff_assignment');
CREATE TYPE "VetoTossMethod" AS ENUM ('digital', 'manual');
CREATE TYPE "VetoAccessRole" AS ENUM ('team_1', 'team_2', 'viewer');

CREATE TABLE "veto_maps" (
  "id" UUID NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "game" TEXT NOT NULL DEFAULT 'valorant',
  "artwork_url" TEXT, "accent_color" TEXT NOT NULL DEFAULT '#8b5cf6', "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "veto_maps_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "veto_map_pools" (
  "id" UUID NOT NULL, "tournament_id" UUID, "name" TEXT NOT NULL, "game" TEXT NOT NULL DEFAULT 'valorant', "version" INTEGER NOT NULL DEFAULT 1,
  "is_built_in" BOOLEAN NOT NULL DEFAULT false, "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "veto_map_pools_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "veto_map_pool_maps" (
  "pool_id" UUID NOT NULL, "map_id" UUID NOT NULL, "display_order" INTEGER NOT NULL DEFAULT 100,
  CONSTRAINT "veto_map_pool_maps_pkey" PRIMARY KEY ("pool_id", "map_id")
);
CREATE TABLE "veto_rule_presets" (
  "id" UUID NOT NULL, "tournament_id" UUID, "name" TEXT NOT NULL, "game" TEXT NOT NULL DEFAULT 'valorant', "format" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "steps" JSONB NOT NULL, "is_built_in" BOOLEAN NOT NULL DEFAULT false, "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "veto_rule_presets_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "veto_room_templates" (
  "id" UUID NOT NULL, "tournament_id" UUID, "map_pool_id" UUID NOT NULL, "rule_preset_id" UUID NOT NULL,
  "name" TEXT NOT NULL, "format" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "settings" JSONB NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false, "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "veto_room_templates_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "tournament_veto_configs" (
  "tournament_id" UUID NOT NULL, "default_template_id" UUID, "settings" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tournament_veto_configs_pkey" PRIMARY KEY ("tournament_id")
);
CREATE TABLE "veto_rooms" (
  "id" UUID NOT NULL, "code" TEXT NOT NULL, "tournament_id" UUID, "match_id" UUID, "template_id" UUID,
  "map_pool_id" UUID NOT NULL, "rule_preset_id" UUID NOT NULL, "title" TEXT NOT NULL, "format" TEXT NOT NULL,
  "status" "VetoRoomStatus" NOT NULL DEFAULT 'draft', "control_mode" "VetoControlMode" NOT NULL DEFAULT 'captain_or_link',
  "team_order_method" "VetoTeamOrderMethod" NOT NULL DEFAULT 'toss', "toss_method" "VetoTossMethod" NOT NULL DEFAULT 'digital',
  "toss_caller_slot" INTEGER NOT NULL DEFAULT 2, "toss_call" TEXT, "toss_result" TEXT, "toss_winner_slot" INTEGER, "team_a_slot" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 0, "current_step" INTEGER NOT NULL DEFAULT 0, "turn_seconds" INTEGER, "turn_deadline" TIMESTAMP(3),
  "viewer_enabled" BOOLEAN NOT NULL DEFAULT false, "publish_result" BOOLEAN NOT NULL DEFAULT false, "config_snapshot" JSONB NOT NULL,
  "pre_veto_match_status" "MatchStatus", "created_by_id" UUID, "opened_at" TIMESTAMP(3), "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3), "cancelled_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "veto_rooms_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "veto_room_participants" (
  "id" UUID NOT NULL, "room_id" UUID NOT NULL, "slot" INTEGER NOT NULL, "registration_id" UUID, "display_name" TEXT NOT NULL,
  "seed" INTEGER, "accent_color" TEXT NOT NULL DEFAULT '#8b5cf6', "ready_at" TIMESTAMP(3), "joined_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "veto_room_participants_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "veto_room_actions" (
  "id" UUID NOT NULL, "room_id" UUID NOT NULL, "sequence" INTEGER NOT NULL, "kind" TEXT NOT NULL, "actor_slot" INTEGER,
  "map_slug" TEXT, "map_name" TEXT, "side" TEXT, "payload" JSONB NOT NULL DEFAULT '{}', "created_by_id" UUID,
  "invalidated_at" TIMESTAMP(3), "invalidated_by_id" UUID, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "veto_room_actions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "veto_access_grants" (
  "id" UUID NOT NULL, "room_id" UUID NOT NULL, "role" "VetoAccessRole" NOT NULL, "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3), "revoked_at" TIMESTAMP(3), "last_used_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "veto_access_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "veto_maps_slug_key" ON "veto_maps"("slug");
CREATE INDEX "veto_maps_game_is_active_idx" ON "veto_maps"("game", "is_active");
CREATE INDEX "veto_map_pools_game_is_archived_idx" ON "veto_map_pools"("game", "is_archived");
CREATE INDEX "veto_map_pools_tournament_id_is_archived_idx" ON "veto_map_pools"("tournament_id", "is_archived");
CREATE INDEX "veto_map_pool_maps_map_id_idx" ON "veto_map_pool_maps"("map_id");
CREATE INDEX "veto_rule_presets_game_format_is_archived_idx" ON "veto_rule_presets"("game", "format", "is_archived");
CREATE INDEX "veto_rule_presets_tournament_id_is_archived_idx" ON "veto_rule_presets"("tournament_id", "is_archived");
CREATE INDEX "veto_room_templates_tournament_id_format_is_archived_idx" ON "veto_room_templates"("tournament_id", "format", "is_archived");
CREATE INDEX "tournament_veto_configs_default_template_id_idx" ON "tournament_veto_configs"("default_template_id");
CREATE UNIQUE INDEX "veto_rooms_code_key" ON "veto_rooms"("code");
CREATE UNIQUE INDEX "veto_rooms_match_id_key" ON "veto_rooms"("match_id");
CREATE INDEX "veto_rooms_tournament_id_status_updated_at_idx" ON "veto_rooms"("tournament_id", "status", "updated_at");
CREATE INDEX "veto_rooms_status_updated_at_idx" ON "veto_rooms"("status", "updated_at");
CREATE UNIQUE INDEX "veto_room_participants_room_id_slot_key" ON "veto_room_participants"("room_id", "slot");
CREATE INDEX "veto_room_participants_registration_id_idx" ON "veto_room_participants"("registration_id");
CREATE INDEX "veto_room_actions_room_id_invalidated_at_sequence_idx" ON "veto_room_actions"("room_id", "invalidated_at", "sequence");
CREATE UNIQUE INDEX "veto_access_grants_token_hash_key" ON "veto_access_grants"("token_hash");
CREATE INDEX "veto_access_grants_room_id_role_revoked_at_idx" ON "veto_access_grants"("room_id", "role", "revoked_at");
CREATE INDEX "veto_access_grants_expires_at_idx" ON "veto_access_grants"("expires_at");

ALTER TABLE "veto_map_pools" ADD CONSTRAINT "veto_map_pools_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "veto_map_pool_maps" ADD CONSTRAINT "veto_map_pool_maps_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "veto_map_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "veto_map_pool_maps" ADD CONSTRAINT "veto_map_pool_maps_map_id_fkey" FOREIGN KEY ("map_id") REFERENCES "veto_maps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "veto_rule_presets" ADD CONSTRAINT "veto_rule_presets_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "veto_room_templates" ADD CONSTRAINT "veto_room_templates_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "veto_room_templates" ADD CONSTRAINT "veto_room_templates_map_pool_id_fkey" FOREIGN KEY ("map_pool_id") REFERENCES "veto_map_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "veto_room_templates" ADD CONSTRAINT "veto_room_templates_rule_preset_id_fkey" FOREIGN KEY ("rule_preset_id") REFERENCES "veto_rule_presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tournament_veto_configs" ADD CONSTRAINT "tournament_veto_configs_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tournament_veto_configs" ADD CONSTRAINT "tournament_veto_configs_default_template_id_fkey" FOREIGN KEY ("default_template_id") REFERENCES "veto_room_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veto_rooms" ADD CONSTRAINT "veto_rooms_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veto_rooms" ADD CONSTRAINT "veto_rooms_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veto_rooms" ADD CONSTRAINT "veto_rooms_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "veto_room_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veto_rooms" ADD CONSTRAINT "veto_rooms_map_pool_id_fkey" FOREIGN KEY ("map_pool_id") REFERENCES "veto_map_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "veto_rooms" ADD CONSTRAINT "veto_rooms_rule_preset_id_fkey" FOREIGN KEY ("rule_preset_id") REFERENCES "veto_rule_presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "veto_room_participants" ADD CONSTRAINT "veto_room_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "veto_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "veto_room_participants" ADD CONSTRAINT "veto_room_participants_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "team_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "veto_room_actions" ADD CONSTRAINT "veto_room_actions_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "veto_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "veto_access_grants" ADD CONSTRAINT "veto_access_grants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "veto_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "veto_maps" ("id", "slug", "name", "accent_color", "updated_at") VALUES
('00000000-0000-4000-8000-000000000101','ascent','Ascent','#d6a568',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000102','bind','Bind','#d88962',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000103','breeze','Breeze','#61c7c2',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000104','fracture','Fracture','#b98b6f',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000105','haven','Haven','#8bbd8b',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000106','icebox','Icebox','#80bfe8',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000107','lotus','Lotus','#c58bcf',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000108','pearl','Pearl','#739bd1',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000109','split','Split','#dd788c',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000110','sunset','Sunset','#e08370',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000111','abyss','Abyss','#6679c9',CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000112','corrode','Corrode','#9fa66b',CURRENT_TIMESTAMP);

INSERT INTO "veto_map_pools" ("id","name","version","is_built_in","updated_at") VALUES
('00000000-0000-4000-8000-000000000201','Quest Standard 7',1,true,CURRENT_TIMESTAMP);
INSERT INTO "veto_map_pool_maps" ("pool_id","map_id","display_order") VALUES
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101',1),
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000102',2),
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000105',3),
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000107',4),
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000108',5),
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000109',6),
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000110',7);

INSERT INTO "veto_rule_presets" ("id","name","format","version","steps","is_built_in","updated_at") VALUES
('00000000-0000-4000-8000-000000000301','Quest Standard BO1','bo1',1,'[{"kind":"ban","actor":"A"},{"kind":"ban","actor":"B"},{"kind":"ban","actor":"A"},{"kind":"ban","actor":"B"},{"kind":"ban","actor":"A"},{"kind":"ban","actor":"B"},{"kind":"decider","actor":null,"seriesIndex":1},{"kind":"side","actor":"A","seriesIndex":1}]',true,CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000302','Quest Standard BO3','bo3',1,'[{"kind":"ban","actor":"A"},{"kind":"ban","actor":"B"},{"kind":"pick","actor":"A","seriesIndex":1},{"kind":"side","actor":"B","seriesIndex":1},{"kind":"pick","actor":"B","seriesIndex":2},{"kind":"side","actor":"A","seriesIndex":2},{"kind":"ban","actor":"A"},{"kind":"ban","actor":"B"},{"kind":"decider","actor":null,"seriesIndex":3},{"kind":"side","actor":"A","seriesIndex":3}]',true,CURRENT_TIMESTAMP),
('00000000-0000-4000-8000-000000000303','Quest Standard BO5','bo5',1,'[{"kind":"ban","actor":"A"},{"kind":"ban","actor":"B"},{"kind":"pick","actor":"A","seriesIndex":1},{"kind":"side","actor":"B","seriesIndex":1},{"kind":"pick","actor":"B","seriesIndex":2},{"kind":"side","actor":"A","seriesIndex":2},{"kind":"pick","actor":"A","seriesIndex":3},{"kind":"side","actor":"B","seriesIndex":3},{"kind":"pick","actor":"B","seriesIndex":4},{"kind":"side","actor":"A","seriesIndex":4},{"kind":"decider","actor":null,"seriesIndex":5},{"kind":"side","actor":"A","seriesIndex":5}]',true,CURRENT_TIMESTAMP);

ALTER TABLE public."veto_maps", public."veto_map_pools", public."veto_map_pool_maps", public."veto_rule_presets", public."veto_room_templates", public."tournament_veto_configs", public."veto_rooms", public."veto_room_participants", public."veto_room_actions", public."veto_access_grants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."veto_maps", public."veto_map_pools", public."veto_map_pool_maps", public."veto_rule_presets", public."veto_room_templates", public."tournament_veto_configs", public."veto_rooms", public."veto_room_participants", public."veto_room_actions", public."veto_access_grants" FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."veto_maps", public."veto_map_pools", public."veto_map_pool_maps", public."veto_rule_presets", public."veto_room_templates", public."tournament_veto_configs", public."veto_rooms", public."veto_room_participants", public."veto_room_actions", public."veto_access_grants" FROM %I', role_name); END IF; END LOOP; END $$;
