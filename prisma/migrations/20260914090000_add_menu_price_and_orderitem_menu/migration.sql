-- AlterTable
ALTER TABLE "Menu" ADD COLUMN "price" REAL NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN "menuId" TEXT;

-- Backfill the price from each item's single size. ORDER BY price ASC mirrors
-- the Math.min the screens used, so an item that somehow carried two sizes
-- lands on the lower one rather than an arbitrary row.
UPDATE "Menu" SET "price" = COALESCE((
    SELECT vs."price" FROM "VariationSize" vs
    JOIN "MenuVariation" v ON v."id" = vs."variationId"
    WHERE v."menuId" = "Menu"."id"
    ORDER BY vs."price" ASC LIMIT 1
), 0);

-- Backfill the order line's menu item through the two tables being retired.
UPDATE "OrderItem" SET "menuId" = (
    SELECT v."menuId" FROM "VariationSize" vs
    JOIN "MenuVariation" v ON v."id" = vs."variationId"
    WHERE vs."id" = "OrderItem"."variationSizeId"
)
WHERE "variationSizeId" IS NOT NULL;

CREATE INDEX "OrderItem_menuId_idx" ON "OrderItem"("menuId");
