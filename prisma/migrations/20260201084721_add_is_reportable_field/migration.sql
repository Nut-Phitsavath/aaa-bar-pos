/*
  Warnings:

  - You are about to drop the column `currentStock` on the `Ingredient` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingredientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "fromStore" TEXT,
    "toStore" TEXT,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockTransaction_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "dateOfBirth" DATETIME,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" REAL NOT NULL DEFAULT 0,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "lastVisit" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("createdAt", "dateOfBirth", "email", "id", "lastVisit", "loyaltyPoints", "name", "phone", "totalSpent", "updatedAt", "visitCount") SELECT "createdAt", "dateOfBirth", "email", "id", "lastVisit", "loyaltyPoints", "name", "phone", "totalSpent", "updatedAt", "visitCount" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE TABLE "new_Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "mainStock" REAL NOT NULL DEFAULT 0,
    "subStock" REAL NOT NULL DEFAULT 0,
    "minStock" REAL NOT NULL,
    "maxStock" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Ingredient" ("cost", "createdAt", "id", "maxStock", "minStock", "name", "unit", "updatedAt") SELECT "cost", "createdAt", "id", "maxStock", "minStock", "name", "unit", "updatedAt" FROM "Ingredient";
DROP TABLE "Ingredient";
ALTER TABLE "new_Ingredient" RENAME TO "Ingredient";
CREATE TABLE "new_MenuVariation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "menuId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MenuVariation_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MenuVariation" ("createdAt", "id", "isEnabled", "menuId", "type", "updatedAt") SELECT "createdAt", "id", "isEnabled", "menuId", "type", "updatedAt" FROM "MenuVariation";
DROP TABLE "MenuVariation";
ALTER TABLE "new_MenuVariation" RENAME TO "MenuVariation";
CREATE UNIQUE INDEX "MenuVariation_menuId_type_key" ON "MenuVariation"("menuId", "type");
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "total" REAL NOT NULL,
    "subtotal" REAL NOT NULL,
    "tax" REAL NOT NULL,
    "discount" REAL NOT NULL DEFAULT 0,
    "promoId" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "customerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cancellationReason" TEXT,
    "beeperNumber" TEXT,
    "pointsRedeemed" INTEGER DEFAULT 0,
    "taxAmount" REAL DEFAULT 0,
    "isReportable" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("beeperNumber", "cancellationReason", "createdAt", "customerId", "discount", "id", "orderNumber", "paymentMethod", "pointsRedeemed", "promoId", "status", "subtotal", "tax", "taxAmount", "total", "updatedAt") SELECT "beeperNumber", "cancellationReason", "createdAt", "customerId", "discount", "id", "orderNumber", "paymentMethod", "pointsRedeemed", "promoId", "status", "subtotal", "tax", "taxAmount", "total", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE TABLE "new_VariationSize" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variationId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "VariationSize_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "MenuVariation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VariationSize" ("createdAt", "id", "isAvailable", "price", "size", "updatedAt", "variationId") SELECT "createdAt", "id", "isAvailable", "price", "size", "updatedAt", "variationId" FROM "VariationSize";
DROP TABLE "VariationSize";
ALTER TABLE "new_VariationSize" RENAME TO "VariationSize";
CREATE UNIQUE INDEX "VariationSize_variationId_size_key" ON "VariationSize"("variationId", "size");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
