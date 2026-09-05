-- Undoing an exchange: the staff member tapped the wrong drink.
--
-- Kept as a reversal rather than a delete. A swap that happened and was undone
-- is two facts an audit wants to see; deleting the row would leave the stock
-- movement behind with nothing explaining it.
ALTER TABLE "PackageSwap" ADD COLUMN "chargeItemId" TEXT;
ALTER TABLE "PackageSwap" ADD COLUMN "reversedAt" DATETIME;
ALTER TABLE "PackageSwap" ADD COLUMN "reversedById" TEXT;
