-- The states a floor plan actually has to tell apart.
--
-- Three facts the room knew and the screen did not:
--
--   needsClearing  A settled table became "free" the instant its bill closed,
--                  so a host could seat a party onto glasses nobody had
--                  collected. Toast treats this as a state of its own for the
--                  same reason.
--
--   reservedFor    A VIP room sold on a minimum spend and booked for 11pm
--                  looked identical to a free one at 9pm.
--   reservedAt
--
--   billRequestedAt  A table waiting to pay is the most time-sensitive thing on
--                    a floor, and one asked 30 seconds ago read the same as one
--                    asked twenty minutes ago.
ALTER TABLE "Table" ADD COLUMN "needsClearing" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "Table" ADD COLUMN "reservedFor" TEXT;
ALTER TABLE "Table" ADD COLUMN "reservedAt" DATETIME;
ALTER TABLE "TableSession" ADD COLUMN "billRequestedAt" DATETIME;
