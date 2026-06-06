CREATE TABLE "rulebooks" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rulebooks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tournaments" ADD COLUMN "rulebook_id" UUID;

CREATE UNIQUE INDEX "rulebooks_slug_key" ON "rulebooks"("slug");
CREATE INDEX "rulebooks_game_idx" ON "rulebooks"("game");
CREATE INDEX "rulebooks_created_at_idx" ON "rulebooks"("created_at");
CREATE INDEX "tournaments_rulebook_id_idx" ON "tournaments"("rulebook_id");

ALTER TABLE "tournaments"
ADD CONSTRAINT "tournaments_rulebook_id_fkey"
FOREIGN KEY ("rulebook_id") REFERENCES "rulebooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
