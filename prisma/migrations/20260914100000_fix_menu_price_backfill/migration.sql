-- The first backfill took the lowest size price outright. The screens it was
-- mirroring filter zeros out first - Math.min(...filter(n => n > 0)) - because
-- 0 means "not priced yet", not "free". On an item carrying both an unpriced
-- size and a real one, the original picked the 0. Re-run with the filter so
-- every database lands where the screens would have.
-- A no-op where every item has one priced size, which is the case here.
UPDATE "Menu" SET "price" = COALESCE((
    SELECT vs."price" FROM "VariationSize" vs
    JOIN "MenuVariation" v ON v."id" = vs."variationId"
    WHERE v."menuId" = "Menu"."id" AND vs."price" > 0
    ORDER BY vs."price" ASC LIMIT 1
), "price")
WHERE EXISTS (
    SELECT 1 FROM "VariationSize" vs
    JOIN "MenuVariation" v ON v."id" = vs."variationId"
    WHERE v."menuId" = "Menu"."id" AND vs."price" > 0
);
