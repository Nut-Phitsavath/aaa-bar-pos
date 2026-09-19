-- What a VIP room undertakes to spend across the night.
--
-- Nullable, and null everywhere to start: most tables have no floor, and a
-- default of 0 would read as "a minimum of nothing" rather than "no minimum".
-- Which rooms carry one is a decision for whoever sells them, not for SQL.
ALTER TABLE "Table" ADD COLUMN "minSpend" REAL;
