-- Material size as printed on the stock sheet / drawing. Additive and
-- nullable: existing items keep whatever their name already says.
ALTER TABLE `Item` ADD COLUMN `size` VARCHAR(191) NULL;
