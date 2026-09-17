-- A promotion can be applied to a table bill, and scoped to a shelf.
--
-- Written by hand rather than generated. `prisma migrate diff` against the
-- migration history wants to redefine a dozen unrelated tables - the history
-- and the datamodel have drifted apart over earlier work - and applying that
-- to add three nullable columns would be a large, unreviewed change to tables
-- this has nothing to do with. Every column here is nullable with no default,
-- which SQLite adds in place without rewriting the table.

-- Which shelf a deal is about. "15 Free 5" is a beer crate; counting every
-- line on the bill towards it let a round of snacks trigger it.
ALTER TABLE "Promotion" ADD COLUMN "categoryId" TEXT REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A bill can carry a promo the way it already carries a manual discount.
ALTER TABLE "TableSession" ADD COLUMN "promoId" TEXT REFERENCES "Promotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What the promo took off, worked out when it was applied and again whenever a
-- round is added or struck. Snapshotted for the same reason fxRate is: a deal
-- whose window closes at midnight must not re-price a bill quoted at 23:55.
ALTER TABLE "TableSession" ADD COLUMN "promoDiscount" REAL;

CREATE INDEX "Promotion_categoryId_idx" ON "Promotion" ("categoryId");
CREATE INDEX "TableSession_promoId_idx" ON "TableSession" ("promoId");
