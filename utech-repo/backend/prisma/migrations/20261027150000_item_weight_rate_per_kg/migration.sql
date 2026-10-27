-- Material weight derived from the size (plant formulas: plate W×L×T×0.0000085,
-- round Ø×Ø×L×0.0000065) and the per-kilogram rate it is priced from.
-- Additive and nullable: nothing is computed for existing rows by this file.
ALTER TABLE `Item`
  ADD COLUMN `weightKg` DECIMAL(14, 3) NULL,
  ADD COLUMN `ratePerKg` DECIMAL(14, 2) NULL;
