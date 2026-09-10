-- Deposit holds (spec §8 booking flow: "if service has deposit: mock checkout
-- → appointment created"). An appointment for a deposit service holds its slot
-- while the patient pays, without yet being a confirmed booking or a request
-- the clinic could accept.
--
-- Its own migration: a new enum value cannot be used in the transaction that
-- adds it, and the next migration puts it in the double-booking constraint.
ALTER TYPE "AppointmentStatus" ADD VALUE 'AWAITING_PAYMENT';
