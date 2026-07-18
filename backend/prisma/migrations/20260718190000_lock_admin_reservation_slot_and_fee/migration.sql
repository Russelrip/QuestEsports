ALTER TABLE "admin_slot_reservations"
ADD COLUMN "assigned_slot_number" INTEGER,
ADD COLUMN "quoted_fee_amount" DECIMAL(12,2),
ADD COLUMN "quoted_fee_currency" TEXT;

-- Existing private holds predate numbered pricing. Assign each one the lowest
-- currently unused slot in creation order and snapshot the matching fee.
DO $$
DECLARE
  hold RECORD;
  chosen_slot INTEGER;
  chosen_fee DECIMAL(12,2);
BEGIN
  FOR hold IN
    SELECT reservation.id, reservation.tournament_id, tournament.max_teams,
           tournament.payment_method::text AS payment_method,
           tournament.registration_fee_amount,
           tournament.registration_fee_currency,
           tournament.registration_fee_tiers
    FROM admin_slot_reservations reservation
    JOIN tournaments tournament ON tournament.id = reservation.tournament_id
    ORDER BY reservation.created_at, reservation.id
    FOR UPDATE OF reservation
  LOOP
    chosen_slot := NULL;
    chosen_fee := NULL;
    SELECT slot_number INTO chosen_slot
    FROM generate_series(1, hold.max_teams) AS slot_number
    WHERE NOT EXISTS (
      SELECT 1 FROM team_registrations registration
      WHERE registration.tournament_id = hold.tournament_id
        AND registration.assigned_slot_number = slot_number
        AND registration.status <> 'rejected'
        AND (
          registration.payment_status = 'paid'
          OR (registration.payment_status = 'pending' AND registration.reserved_until > CURRENT_TIMESTAMP)
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM admin_slot_reservations existing_hold
      WHERE existing_hold.tournament_id = hold.tournament_id
        AND existing_hold.assigned_slot_number = slot_number
    )
    ORDER BY slot_number
    LIMIT 1;

    IF chosen_slot IS NULL THEN
      RAISE EXCEPTION 'Cannot assign a numbered slot to existing admin reservation %', hold.id;
    END IF;

    IF hold.payment_method = 'bank_transfer' THEN
      SELECT (tier->>'amount')::DECIMAL(12,2) INTO chosen_fee
      FROM jsonb_array_elements(COALESCE(hold.registration_fee_tiers, '[]'::jsonb)) AS tier
      WHERE chosen_slot BETWEEN (tier->>'startSlot')::INTEGER AND (tier->>'endSlot')::INTEGER
      LIMIT 1;
    END IF;
    chosen_fee := COALESCE(chosen_fee, hold.registration_fee_amount, 0);

    UPDATE admin_slot_reservations
    SET assigned_slot_number = chosen_slot,
        quoted_fee_amount = chosen_fee,
        quoted_fee_currency = hold.registration_fee_currency
    WHERE id = hold.id;
  END LOOP;
END $$;

ALTER TABLE "admin_slot_reservations"
ALTER COLUMN "assigned_slot_number" SET NOT NULL,
ALTER COLUMN "quoted_fee_amount" SET NOT NULL,
ALTER COLUMN "quoted_fee_currency" SET NOT NULL;

CREATE UNIQUE INDEX "admin_slot_reservations_tournament_id_assigned_slot_number_key"
ON "admin_slot_reservations"("tournament_id", "assigned_slot_number");
