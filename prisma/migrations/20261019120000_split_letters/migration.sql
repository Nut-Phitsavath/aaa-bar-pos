-- The letter a split bill keeps: T1-a, T1-b (0 = a).
--
-- It was worked out from whichever bills on the table were still open, so it
-- moved: once T1-a paid, T1-b turned back into plain "T1", and a reprint of
-- either said "T1". Two slips for one party, neither saying which half it was.
--
-- Null for every existing bill. Bills split before this keep the old,
-- worked-out letter on screen until they close.
ALTER TABLE "TableSession" ADD COLUMN "splitIndex" INTEGER;
