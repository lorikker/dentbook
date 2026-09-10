-- A deposit hold must block its slot exactly like a booking does.
ALTER TABLE appointments DROP CONSTRAINT no_double_booking;
ALTER TABLE appointments ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (
    membership_id WITH =,
    tsrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED', 'AWAITING_PAYMENT'));

-- 24h reminders (spec §8): set when a reminder is claimed so no run sends it
-- twice; cleared on reschedule so the new time is reminded.
ALTER TABLE "appointments" ADD COLUMN "reminder_sent_at" TIMESTAMP(3);

-- Serves the reminder sweep (CONFIRMED, starting soon) and the hold sweep.
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");
