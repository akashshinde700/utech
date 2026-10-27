-- Which metal an item is, named as the metal calculator's catalogue names it.
-- Density (and therefore weight) follows from it. Additive and nullable.
ALTER TABLE `Item` ADD COLUMN `metal` VARCHAR(191) NULL;
