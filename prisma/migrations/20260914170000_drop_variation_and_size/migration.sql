-- Drop the variation/size tier. A bar item has one price, on the item itself.
--
-- Hand-written, not generated. `prisma migrate diff` wants to rebuild
-- Ingredient, OrderItem and PackageSwap and to drop the Payment indexes, almost
-- all of it from PRE-EXISTING drift unrelated to this refactor: no migration was
-- ever captured for Ingredient.measureType / baseUnit / purchaseUnit /
-- purchaseMultiplier. Applying that at a one-way door would rebuild unrelated
-- tables, so every statement below was written against the CREATE TABLE text
-- sqlite_master reports today.
--
-- Three different shapes of removal, because the three columns are not alike:
--
--   PackageSwapLine.variationSizeId  has no FK and no index -> drops in place.
--   OrderItem.variationSizeId        carries OrderItem_variationSizeId_fkey
--   Recipe.variationSizeId           carries Recipe_variationSizeId_fkey
--
-- SQLite (3.45.0 here, so DROP COLUMN exists) refuses to drop a column that a
-- surviving FOREIGN KEY clause still names: "error in table X after drop
-- column: unknown column". So OrderItem and Recipe are rebuilt
-- create-copy-drop-rename, omitting the column AND its FK clause and restating
-- everything else verbatim.
--
-- PRAGMA foreign_keys=OFF is load-bearing here, not ceremony. PackageSwap
-- .orderItemId references OrderItem ON DELETE CASCADE, and with foreign keys
-- enabled DROP TABLE performs an implicit DELETE that fires cascade actions --
-- which would silently take all 9 PackageSwap rows and, through them, all 16
-- PackageSwapLine rows with it. Verified against a VACUUM INTO copy before this
-- ran for real: all 23 table counts unchanged except the two tables dropped.

PRAGMA foreign_keys=OFF;

-- 1. PackageSwapLine: no FK, no index on the column, so it goes in place.
ALTER TABLE "PackageSwapLine" DROP COLUMN "variationSizeId";

-- 2. OrderItem: rebuild without the column and without OrderItem_variationSizeId_fkey.
--    Column order, types, defaults and the inline voidedById reference are
--    copied from the live DDL. menuId deliberately carries NO foreign key: the
--    live table has none (schema.prisma declares the relation, the database
--    never got the constraint), and adding one here would be an unrelated
--    schema change smuggled into the irreversible migration.
DROP INDEX "OrderItem_variationSizeId_idx";

CREATE TABLE "new_OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total" REAL NOT NULL,
    "sugarLevel" TEXT,
    "shotType" TEXT,
    "cupSize" TEXT,
    "isTakeaway" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "voidedAt" DATETIME,
    "voidedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "voidReason" TEXT,
    "voidNote" TEXT,
    "menuId" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_OrderItem" ("id", "orderId", "name", "price", "quantity", "total", "sugarLevel", "shotType", "cupSize", "isTakeaway", "note", "voidedAt", "voidedById", "voidReason", "voidNote", "menuId")
SELECT "id", "orderId", "name", "price", "quantity", "total", "sugarLevel", "shotType", "cupSize", "isTakeaway", "note", "voidedAt", "voidedById", "voidReason", "voidNote", "menuId"
FROM "OrderItem";

DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";

CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_menuId_idx" ON "OrderItem"("menuId");
CREATE INDEX "OrderItem_voidedAt_idx" ON "OrderItem"("voidedAt");

-- 3. Recipe: rebuild without the column and without Recipe_variationSizeId_fkey.
--    The old unique index spanned (menuId, variationSizeId, ingredientId). Every
--    row has variationSizeId NULL, and SQLite treats NULLs in a unique index as
--    distinct from one another, so that index never actually constrained
--    (menuId, ingredientId). Narrowing it therefore TIGHTENS the table; checked
--    for duplicate (menuId, ingredientId) pairs first and found 0 of 46.
CREATE TABLE "new_Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "menuId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recipe_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recipe_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Recipe" ("id", "menuId", "ingredientId", "quantity", "createdAt", "updatedAt")
SELECT "id", "menuId", "ingredientId", "quantity", "createdAt", "updatedAt"
FROM "Recipe";

DROP TABLE "Recipe";
ALTER TABLE "new_Recipe" RENAME TO "Recipe";

CREATE UNIQUE INDEX "Recipe_menuId_ingredientId_key" ON "Recipe"("menuId", "ingredientId");

-- 4. Nothing references them any more. VariationSize first: it is the child of
--    MenuVariation, so dropping the parent first would leave a dangling FK.
DROP TABLE "VariationSize";
DROP TABLE "MenuVariation";

PRAGMA foreign_keys=ON;
