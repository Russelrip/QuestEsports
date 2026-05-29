ALTER TABLE "tournaments"
ADD COLUMN "registration_open_at" TIMESTAMP(3);

CREATE TABLE "tournament_brackets" (
  "id" UUID NOT NULL,
  "tournament_id" UUID NOT NULL,
  "format" TEXT NOT NULL DEFAULT 'double_elimination',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "seed_data" JSONB NOT NULL,
  "bracket_data" JSONB NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMP(3),
  "last_updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tournament_brackets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tournament_brackets_tournament_id_key"
ON "tournament_brackets"("tournament_id");

CREATE INDEX "tournament_brackets_status_idx"
ON "tournament_brackets"("status");

ALTER TABLE "tournament_brackets"
ADD CONSTRAINT "tournament_brackets_tournament_id_fkey"
FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
