-- Catch the migration history up with the schema.
--
-- Some changes reached the schema through `prisma db push` and never became a
-- migration: the September base-units columns on Ingredient (measureType,
-- baseUnit, purchaseUnit, purchaseMultiplier), OrderItem's link to Menu, the
-- PackageSwap link to whoever reversed it, and six indexes. A database built
-- from the migrations alone - which is what a first install at the bar does -
-- was missing all of it, and the first stock screen would have failed.
--
-- This is `prisma migrate diff` from (all earlier migrations) to schema.prisma,
-- unedited below this header.
--
-- DO NOT RUN THIS on a database that already has those columns (any database
-- made with `db push`, e.g. a developer's dev.db): it rebuilds Ingredient from
-- the old columns only and would drop the base-unit values. Mark it as applied
-- instead:
--   npx prisma migrate resolve --applied 20261021120000_catch_up_with_db_push

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "measureType" TEXT NOT NULL DEFAULT 'EACH',
    "baseUnit" TEXT NOT NULL DEFAULT 'each',
    "purchaseUnit" TEXT NOT NULL DEFAULT 'each',
    "purchaseMultiplier" REAL NOT NULL DEFAULT 1,
    "mainStock" REAL NOT NULL DEFAULT 0,
    "subStock" REAL NOT NULL DEFAULT 0,
    "minStock" REAL NOT NULL,
    "maxStock" REAL NOT NULL,
    "minStockSub" REAL NOT NULL DEFAULT 0,
    "maxStockSub" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL,
    "categoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ingredient_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IngredientCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Ingredient" ("categoryId", "cost", "createdAt", "id", "mainStock", "maxStock", "maxStockSub", "minStock", "minStockSub", "name", "subStock", "unit", "updatedAt") SELECT "categoryId", "cost", "createdAt", "id", "mainStock", "maxStock", "maxStockSub", "minStock", "minStockSub", "name", "subStock", "unit", "updatedAt" FROM "Ingredient";
DROP TABLE "Ingredient";
ALTER TABLE "new_Ingredient" RENAME TO "Ingredient";
CREATE TABLE "new_OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "menuId" TEXT,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total" REAL NOT NULL,
    "note" TEXT,
    "voidedAt" DATETIME,
    "voidedById" TEXT,
    "voidReason" TEXT,
    "voidNote" TEXT,
    "sugarLevel" TEXT,
    "shotType" TEXT,
    "cupSize" TEXT,
    "isTakeaway" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "OrderItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("cupSize", "id", "isTakeaway", "menuId", "name", "note", "orderId", "price", "quantity", "shotType", "sugarLevel", "total", "voidNote", "voidReason", "voidedAt", "voidedById") SELECT "cupSize", "id", "isTakeaway", "menuId", "name", "note", "orderId", "price", "quantity", "shotType", "sugarLevel", "total", "voidNote", "voidReason", "voidedAt", "voidedById" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_menuId_idx" ON "OrderItem"("menuId");
CREATE INDEX "OrderItem_voidedAt_idx" ON "OrderItem"("voidedAt");
CREATE TABLE "new_PackageSwap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderItemId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "outValue" REAL NOT NULL,
    "inValue" REAL NOT NULL,
    "charged" REAL NOT NULL DEFAULT 0,
    "chargeItemId" TEXT,
    "reversedAt" DATETIME,
    "reversedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageSwap_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackageSwap_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TableSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PackageSwap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PackageSwap_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PackageSwap" ("chargeItemId", "charged", "createdAt", "id", "inValue", "orderItemId", "outValue", "reversedAt", "reversedById", "sessionId", "userId") SELECT "chargeItemId", "charged", "createdAt", "id", "inValue", "orderItemId", "outValue", "reversedAt", "reversedById", "sessionId", "userId" FROM "PackageSwap";
DROP TABLE "PackageSwap";
ALTER TABLE "new_PackageSwap" RENAME TO "PackageSwap";
CREATE INDEX "PackageSwap_sessionId_idx" ON "PackageSwap"("sessionId");
CREATE INDEX "PackageSwap_createdAt_idx" ON "PackageSwap"("createdAt");
CREATE INDEX "PackageSwap_orderItemId_idx" ON "PackageSwap"("orderItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

