-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "mainStock" REAL NOT NULL DEFAULT 0,
    "subStock" REAL NOT NULL DEFAULT 0,
    "minStock" REAL NOT NULL,
    "maxStock" REAL NOT NULL,
    "minStockSub" REAL NOT NULL DEFAULT 0,
    "maxStockSub" REAL NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Ingredient" ("cost", "createdAt", "id", "mainStock", "maxStock", "minStock", "name", "subStock", "unit", "updatedAt") SELECT "cost", "createdAt", "id", "mainStock", "maxStock", "minStock", "name", "subStock", "unit", "updatedAt" FROM "Ingredient";
DROP TABLE "Ingredient";
ALTER TABLE "new_Ingredient" RENAME TO "Ingredient";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
