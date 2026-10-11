-- Bills closed before "taxRate" existed have nothing stamped, and the receipt
-- now prints no VAT line at all for them. That is a worse answer than the bug
-- it replaces, so freeze them at the rate settings holds right now - which is
-- the rate the old code was computing them at a moment ago. Same slip as
-- yesterday, except it can no longer move when the owner edits settings.
--
-- Skipped entirely when no rate is configured: null stays null rather than
-- inventing a number nobody was charged.
UPDATE "TableSession"
SET "taxRate" = (
    SELECT CAST("value" AS REAL) FROM "Setting"
    WHERE "key" IN ('taxRate', 'tax_rate') LIMIT 1
)
WHERE "status" = 'CLOSED'
  AND "taxRate" IS NULL
  AND EXISTS (SELECT 1 FROM "Setting" WHERE "key" IN ('taxRate', 'tax_rate'));
