-- The kip rate a walk-in sale was struck at.
--
-- Table bills stamp their rate at close; counter sales stamped nothing, so
-- their slips could show no kip at all - and a till set to print in kip had no
-- rate it could honestly quote. Null for every sale before this: those print
-- in baht, rather than at a rate nobody was charged.
ALTER TABLE "Order" ADD COLUMN "fxRateLAK" REAL;
