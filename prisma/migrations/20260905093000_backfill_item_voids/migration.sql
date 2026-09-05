-- Backfill line-level voids for rounds cancelled before voiding moved onto the
-- line (req #5/#24).
--
-- Without this the void audit report opens empty on every night already traded,
-- and the server report shows every waiter with zero voids - both of which read
-- as "nothing was ever cancelled here" rather than "we changed how we record
-- it". Existing history is exactly what a manager opens an audit report to look
-- at, so it has to come across.
--
-- The old free-text reason is mapped onto the fixed list where it plainly
-- corresponds, and kept verbatim in the note either way, so nothing a staff
-- member actually typed is lost or silently reclassified.
UPDATE "OrderItem"
SET
    "voidedAt" = COALESCE(
        (SELECT "updatedAt" FROM "Order" WHERE "Order"."id" = "OrderItem"."orderId"),
        (SELECT "createdAt" FROM "Order" WHERE "Order"."id" = "OrderItem"."orderId")
    ),
    "voidReason" = (
        SELECT CASE
            WHEN LOWER(COALESCE(o."cancellationReason", '')) LIKE '%duplicate%'    THEN 'DUPLICATE'
            WHEN LOWER(COALESCE(o."cancellationReason", '')) LIKE '%wrong table%'  THEN 'WRONG_TABLE'
            WHEN LOWER(COALESCE(o."cancellationReason", '')) LIKE '%changed mind%' THEN 'CUSTOMER_CHANGED'
            WHEN LOWER(COALESCE(o."cancellationReason", '')) LIKE '%wrong%'        THEN 'WRONG_ITEM'
            WHEN LOWER(COALESCE(o."cancellationReason", '')) LIKE '%spill%'        THEN 'SPILLED'
            ELSE 'OTHER'
        END
        FROM "Order" o WHERE o."id" = "OrderItem"."orderId"
    ),
    "voidNote" = (SELECT o."cancellationReason" FROM "Order" o WHERE o."id" = "OrderItem"."orderId")
WHERE "voidedAt" IS NULL
  AND "orderId" IN (SELECT "id" FROM "Order" WHERE "status" = 'CANCELLED');
