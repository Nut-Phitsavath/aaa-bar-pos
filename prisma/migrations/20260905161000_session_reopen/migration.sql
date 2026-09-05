-- Reopening a settled bill leaves a mark. Kept as a fact rather than a flag
-- that gets cleared on re-close: a bill that was reopened once stays one, which
-- is what an audit is asking about.
ALTER TABLE "TableSession" ADD COLUMN "reopenedAt" DATETIME;
ALTER TABLE "TableSession" ADD COLUMN "reopenedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TableSession" ADD COLUMN "reopenReason" TEXT;
