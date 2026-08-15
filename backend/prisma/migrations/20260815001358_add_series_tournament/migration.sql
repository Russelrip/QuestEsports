-- AlterTable
ALTER TABLE "quest_valorant_series" ADD COLUMN     "tournament_id" UUID;

-- CreateIndex
CREATE INDEX "quest_valorant_series_tournament_id_idx" ON "quest_valorant_series"("tournament_id");

-- AddForeignKey
ALTER TABLE "quest_valorant_series" ADD CONSTRAINT "quest_valorant_series_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
