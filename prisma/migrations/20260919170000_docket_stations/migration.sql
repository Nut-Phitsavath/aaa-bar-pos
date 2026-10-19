-- Which printer a line prints on.
--
-- Until now "Send Order" printed nothing at all: the round landed in the
-- database and somebody shouted the food order across the room. Routing needs
-- exactly one fact per category - is this made at the bar or in the kitchen -
-- which is the grain SambaPOS maps print jobs by too.
--
-- BAR is the default because in this venue most of the menu is a drink, so it
-- is the rarer mistake. The kitchen categories are named here so the first
-- night after deploying does not need an admin to go and tick six boxes.
ALTER TABLE "Category" ADD COLUMN "station" TEXT NOT NULL DEFAULT 'BAR';

UPDATE "Category" SET "station" = 'KITCHEN'
WHERE "name" LIKE '%Snack%'
   OR "name" LIKE '%Food%'
   OR "name" LIKE '%Kitchen%'
   OR "name" LIKE '%ອາຫານ%';
