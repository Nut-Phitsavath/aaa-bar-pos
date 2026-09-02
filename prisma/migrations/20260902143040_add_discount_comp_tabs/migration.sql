-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TableSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tableId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "fxRateLAK" REAL,
    "fxRateUSD" REAL,
    "discountType" TEXT,
    "discountValue" REAL,
    "discountApprovedById" TEXT,
    "isOwnerVip" BOOLEAN NOT NULL DEFAULT false,
    "payLaterCustomerId" TEXT,
    "payLaterApprovedById" TEXT,
    "openedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TableSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TableSession_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TableSession_payLaterApprovedById_fkey" FOREIGN KEY ("payLaterApprovedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TableSession_payLaterCustomerId_fkey" FOREIGN KEY ("payLaterCustomerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TableSession" ("closedAt", "createdAt", "fxRateLAK", "fxRateUSD", "id", "openedAt", "openedById", "status", "tableId", "updatedAt") SELECT "closedAt", "createdAt", "fxRateLAK", "fxRateUSD", "id", "openedAt", "openedById", "status", "tableId", "updatedAt" FROM "TableSession";
DROP TABLE "TableSession";
ALTER TABLE "new_TableSession" RENAME TO "TableSession";
CREATE INDEX "TableSession_tableId_status_idx" ON "TableSession"("tableId", "status");
CREATE INDEX "TableSession_status_idx" ON "TableSession"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
