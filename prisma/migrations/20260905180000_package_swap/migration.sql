-- Swapping what a package delivered (req #8), and the log of every swap (#9).
--
-- New tables only: nothing on an existing row changes, so a live database
-- takes this without a rebuild and without touching a single bill.
CREATE TABLE "PackageSwap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderItemId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "outValue" REAL NOT NULL,
    "inValue" REAL NOT NULL,
    "charged" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageSwap_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackageSwap_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TableSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PackageSwap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PackageSwap_sessionId_idx" ON "PackageSwap"("sessionId");
CREATE INDEX "PackageSwap_createdAt_idx" ON "PackageSwap"("createdAt");
CREATE INDEX "PackageSwap_orderItemId_idx" ON "PackageSwap"("orderItemId");

CREATE TABLE "PackageSwapLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "menuId" TEXT,
    "variationSizeId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    CONSTRAINT "PackageSwapLine_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "PackageSwap" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PackageSwapLine_swapId_idx" ON "PackageSwapLine"("swapId");
