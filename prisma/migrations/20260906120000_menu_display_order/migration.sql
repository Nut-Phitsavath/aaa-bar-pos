-- Staff-controlled order for the till's category chips and its menu grid.
--
-- Neither table had a sort column, so both were served alphabetically and the
-- order could not be changed at all. Nullable-with-default ADD COLUMNs, so a
-- live database takes this without the table rebuild that would drop rows.
ALTER TABLE "Category" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Menu" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- Seed the order from what the till already showed, so nothing moves on the
-- night this ships. A default of 0 everywhere would have left SQLite free to
-- return them in any order it liked, which reads as the menu shuffling itself.
UPDATE "Category"
SET "displayOrder" = (
    SELECT COUNT(*) FROM "Category" AS earlier
    WHERE earlier."name" < "Category"."name"
);

UPDATE "Menu"
SET "displayOrder" = (
    SELECT COUNT(*) FROM "Menu" AS earlier
    WHERE earlier."categoryId" = "Menu"."categoryId"
      AND earlier."name" < "Menu"."name"
);

CREATE INDEX "Category_displayOrder_idx" ON "Category"("displayOrder");
CREATE INDEX "Menu_categoryId_displayOrder_idx" ON "Menu"("categoryId", "displayOrder");
