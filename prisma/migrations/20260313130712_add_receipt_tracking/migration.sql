/*
  Warnings:

  - Added the required column `username` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingredientId" TEXT NOT NULL,
    "theoreticalStock" REAL NOT NULL,
    "actualStock" REAL NOT NULL,
    "difference" REAL NOT NULL,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockCount_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockCount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "hasSugarLevel" BOOLEAN NOT NULL DEFAULT false,
    "hasShotType" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Category" ("createdAt", "id", "name", "updatedAt") SELECT "createdAt", "id", "name", "updatedAt" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
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
    "cashReceived" REAL DEFAULT 0,
    "changeAmount" REAL DEFAULT 0,
    "isReportable" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "bankReference" TEXT,
    "paymentStatus" TEXT DEFAULT 'PENDING',
    "qrCodeData" TEXT,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("beeperNumber", "cancellationReason", "createdAt", "customerId", "discount", "id", "isReportable", "orderNumber", "paymentMethod", "pointsRedeemed", "promoId", "status", "subtotal", "tax", "taxAmount", "total", "updatedAt") SELECT "beeperNumber", "cancellationReason", "createdAt", "customerId", "discount", "id", "isReportable", "orderNumber", "paymentMethod", "pointsRedeemed", "promoId", "status", "subtotal", "tax", "taxAmount", "total", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_bankReference_key" ON "Order"("bankReference");
CREATE TABLE "new_OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "variationSizeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total" REAL NOT NULL,
    "sugarLevel" TEXT,
    "shotType" TEXT,
    "cupSize" TEXT,
    "isTakeaway" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "OrderItem_variationSizeId_fkey" FOREIGN KEY ("variationSizeId") REFERENCES "VariationSize" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("cupSize", "id", "name", "orderId", "price", "quantity", "shotType", "sugarLevel", "total", "variationSizeId") SELECT "cupSize", "id", "name", "orderId", "price", "quantity", "shotType", "sugarLevel", "total", "variationSizeId" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
CREATE TABLE "new_Shift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "startTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" DATETIME,
    "startCash" REAL NOT NULL DEFAULT 0,
    "endCash" REAL,
    "actualCash" REAL,
    "difference" REAL,
    "cashPayments" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "responsiblePerson" TEXT,
    CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Shift" ("actualCash", "cashPayments", "createdAt", "difference", "endCash", "endTime", "id", "responsiblePerson", "startCash", "startTime", "status", "updatedAt", "userId") SELECT "actualCash", "cashPayments", "createdAt", "difference", "endCash", "endTime", "id", "responsiblePerson", "startCash", "startTime", "status", "updatedAt", "userId" FROM "Shift";
DROP TABLE "Shift";
ALTER TABLE "new_Shift" RENAME TO "Shift";
CREATE TABLE "new_StockTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingredientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "fromStore" TEXT,
    "toStore" TEXT,
    "notes" TEXT,
    "reason" TEXT,
    "cost" REAL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockTransaction_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockTransaction" ("cost", "createdAt", "fromStore", "id", "ingredientId", "notes", "quantity", "reason", "toStore", "type", "userId") SELECT "cost", "createdAt", "fromStore", "id", "ingredientId", "notes", "quantity", "reason", "toStore", "type", "userId" FROM "StockTransaction";
DROP TABLE "StockTransaction";
ALTER TABLE "new_StockTransaction" RENAME TO "StockTransaction";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "id", "isActive", "name", "pin", "role", "updatedAt") SELECT "createdAt", "id", "isActive", "name", "pin", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
