-- Refunding a single tender, and knowing which shift took it.
--
-- Recorded on the payment rather than as a negative one: the original tender
-- stays legible on the bill, and a reversal can never be mistaken for a second
-- sale. Same shape as a voided OrderItem, so both read through one audit trail.
--
-- Plain ADD COLUMNs, not a table rebuild: every column is nullable with no
-- default, so no existing Payment row is touched and no live bill can be lost.
ALTER TABLE "Payment" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "voidedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "Payment" ADD COLUMN "shiftId" TEXT REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Payment_voidedAt_idx" ON "Payment"("voidedAt");
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");

-- Existing payments predate the column. Attribute each to the shift its own
-- order was linked to, so historical refunds are refused for the right reason
-- (a closed shift) rather than because the field happens to be empty.
UPDATE "Payment"
SET "shiftId" = (
    SELECT o."shiftId" FROM "Order" o
    WHERE o."sessionId" = "Payment"."sessionId" AND o."shiftId" IS NOT NULL
    LIMIT 1
)
WHERE "shiftId" IS NULL;
