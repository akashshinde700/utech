-- AlterTable: physical return receipt proof (AUD-211)
-- A sales return may only put stock back once the goods are proven to have
-- arrived: a return challan number, the date they were received and who booked
-- them. `dispatchChallanId` optionally ties the return to the outbound challan
-- so the returned quantity can be capped by what was actually shipped.
ALTER TABLE `SalesReturn`
    ADD COLUMN `returnChallanNo` VARCHAR(191) NULL,
    ADD COLUMN `receivedAt` DATETIME(3) NULL,
    ADD COLUMN `receivedById` INTEGER NULL,
    ADD COLUMN `dispatchChallanId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `SalesReturn_dispatchChallanId_idx` ON `SalesReturn`(`dispatchChallanId`);

-- AddForeignKey
ALTER TABLE `SalesReturn` ADD CONSTRAINT `SalesReturn_receivedById_fkey` FOREIGN KEY (`receivedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturn` ADD CONSTRAINT `SalesReturn_dispatchChallanId_fkey` FOREIGN KEY (`dispatchChallanId`) REFERENCES `DispatchChallan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
