-- Rename TableSession.payLaterCustomerId to customerId.
--
-- Written by hand rather than generated, because the generated version drops
-- the column and takes the ten live tabs with it. The rebuild below carries
-- the values across, so who owes what survives the rename.
--
-- The meaning widens as well as the name: a customer is now attached when a
-- regular sits down, not only when a bill goes on the slate, so the floor plan
-- can show that they already owe something while they are still in the room.

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
    "customerId" TEXT,
    "payLaterApprovedById" TEXT,
    "openedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TableSession_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TableSession_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TableSession_payLaterApprovedById_fkey" FOREIGN KEY ("payLaterApprovedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TableSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_TableSession" (
    "id", "tableId", "status", "openedAt", "closedAt", "fxRateLAK", "fxRateUSD",
    "discountType", "discountValue", "discountApprovedById", "isOwnerVip",
    "customerId", "payLaterApprovedById", "openedById", "createdAt", "updatedAt"
)
SELECT
    "id", "tableId", "status", "openedAt", "closedAt", "fxRateLAK", "fxRateUSD",
    "discountType", "discountValue", "discountApprovedById", "isOwnerVip",
    "payLaterCustomerId", "payLaterApprovedById", "openedById", "createdAt", "updatedAt"
FROM "TableSession";

DROP TABLE "TableSession";
ALTER TABLE "new_TableSession" RENAME TO "TableSession";

CREATE INDEX "TableSession_tableId_status_idx" ON "TableSession"("tableId", "status");
CREATE INDEX "TableSession_status_idx" ON "TableSession"("status");
CREATE INDEX "TableSession_customerId_idx" ON "TableSession"("customerId");

PRAGMA foreign_keys=ON;
