-- Moving, merging and splitting tables (req #2).
--
-- One nullable column and one new table, so a live database takes this without
-- the rebuild that would drop rows from a bill mid-service.
ALTER TABLE "TableSession" ADD COLUMN "mergedIntoId" TEXT;

-- None of the three operations asks for a manager PIN, by decision - they
-- happen constantly on a busy floor. This is the only record that a bill
-- changed shape, so it is written before anything moves.
CREATE TABLE "TableSessionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    -- Table NAMES, not ids: a table can be renamed or retired, and a log that
    -- reads "moved to <deleted>" tells nobody anything.
    "fromTable" TEXT,
    "toTable" TEXT,
    "otherSessionId" TEXT,
    "lineCount" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TableSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TableSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TableSessionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TableSessionEvent_sessionId_idx" ON "TableSessionEvent"("sessionId");
CREATE INDEX "TableSessionEvent_createdAt_idx" ON "TableSessionEvent"("createdAt");
