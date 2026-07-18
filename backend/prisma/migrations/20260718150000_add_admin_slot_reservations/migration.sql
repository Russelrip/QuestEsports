CREATE TABLE "admin_slot_reservations" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_slot_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_slot_reservations_registration_id_key" ON "admin_slot_reservations"("registration_id");
CREATE INDEX "admin_slot_reservations_tournament_id_idx" ON "admin_slot_reservations"("tournament_id");
CREATE INDEX "admin_slot_reservations_created_by_id_idx" ON "admin_slot_reservations"("created_by_id");
ALTER TABLE "admin_slot_reservations" ADD CONSTRAINT "admin_slot_reservations_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_slot_reservations" ADD CONSTRAINT "admin_slot_reservations_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "team_registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_slot_reservations" ADD CONSTRAINT "admin_slot_reservations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
