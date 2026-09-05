-- Voiding recorded on the line (req #5), so the void audit report (req #24)
-- has a single source: "all cancelled/voided items", with who and when.
--
-- Plain ADD COLUMNs rather than the table rebuild SQLite usually needs for a
-- schema change: every column is nullable with no default, so no existing
-- OrderItem row has to be touched and no live order can be lost rewriting it.
ALTER TABLE "OrderItem" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "OrderItem" ADD COLUMN "voidedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "voidNote" TEXT;

CREATE INDEX "OrderItem_voidedAt_idx" ON "OrderItem"("voidedAt");
