-- Bring the database back in line with schema.prisma, and index the two
-- columns the return guards aggregate on.
--
-- `prisma migrate diff --from-url <db built by these migrations>
--  --to-schema-datamodel prisma/schema.prisma` was NOT empty: the init
-- migration was hand-written and drifted from the data model on three counts.
-- A non-empty diff means `prisma migrate dev` on any developer machine invents
-- a "fix the drift" migration of its own, so this has to be closed once,
-- deliberately, in a migration everyone replays.

-- 1. Two relations the schema declares had NO foreign key in the database at
--    all, so a BOM could reference an item id that does not exist. BomItem.item
--    is required -> RESTRICT; Bom.finishedItem is optional -> SET NULL (both are
--    Prisma's defaults for those relations). Run `npm run db:check-integrity`
--    first: an orphan BomItem row makes the first statement fail, which is the
--    intended behaviour -- the row has to be looked at, not silently rewritten.
ALTER TABLE `BomItem` ADD CONSTRAINT `BomItem_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Bom` ADD CONSTRAINT `Bom_finishedItemId_fkey` FOREIGN KEY (`finishedItemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Five optional item relations were created ON DELETE RESTRICT, while the
--    schema declares the default for an optional relation, SET NULL. The column
--    is nullable in every case, so deleting an item detaches the historical
--    document line instead of refusing. Nothing in the app hard-deletes an item
--    today (`DELETE /api/items/:id` deactivates), so this changes no current
--    behaviour -- it makes the database say what the Prisma client already
--    believes.
ALTER TABLE `StockLedger` DROP FOREIGN KEY `StockLedger_itemId_fkey`;
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `JobcardLine` DROP FOREIGN KEY `JobcardLine_itemId_fkey`;
ALTER TABLE `JobcardLine` ADD CONSTRAINT `JobcardLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `JobworkLine` DROP FOREIGN KEY `JobworkLine_itemId_fkey`;
ALTER TABLE `JobworkLine` ADD CONSTRAINT `JobworkLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PurchaseOrderLine` DROP FOREIGN KEY `PurchaseOrderLine_itemId_fkey`;
ALTER TABLE `PurchaseOrderLine` ADD CONSTRAINT `PurchaseOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `GrnLine` DROP FOREIGN KEY `GrnLine_itemId_fkey`;
ALTER TABLE `GrnLine` ADD CONSTRAINT `GrnLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Both return flows cap a return at the quantity actually invoiced or
--    received by aggregating every prior return line for that source line --
--    once per line, inside the create transaction. `invoiceLineId` and
--    `grnLineId` are logical foreign keys (plain Int columns, no relation), so
--    neither had an index and that guard scanned the whole table while holding
--    the transaction open.
CREATE INDEX `SalesReturnLine_invoiceLineId_idx` ON `SalesReturnLine`(`invoiceLineId`);
CREATE INDEX `PurchaseReturnLine_grnLineId_idx` ON `PurchaseReturnLine`(`grnLineId`);

-- 4. Leftovers that kept the diff non-empty: an `updatedAt` default the data
--    model does not declare (Prisma writes the value itself via @updatedAt),
--    and an index still carrying its old `_fkey` name after the foreign key it
--    belonged to was replaced by a plain @@index.
ALTER TABLE `JobcardOperation` ALTER COLUMN `updatedAt` DROP DEFAULT;
ALTER TABLE `JobcardOperation` RENAME INDEX `JobcardOperation_jobcardId_fkey` TO `JobcardOperation_jobcardId_idx`;
