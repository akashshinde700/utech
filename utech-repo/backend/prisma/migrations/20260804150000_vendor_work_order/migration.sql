-- AlterTable: work outsourced to a vendor is frequently a one-off, non-catalog
-- part identified only by a drawing/description, so a PO/GRN line must be able
-- to stand on its own without an Item master row. Existing rows all keep their
-- itemId, so nothing observable changes for the purchase flow as it is today.
ALTER TABLE `PurchaseOrderLine` MODIFY COLUMN `itemId` INTEGER NULL;

ALTER TABLE `GrnLine`
    MODIFY COLUMN `itemId` INTEGER NULL,
    ADD COLUMN `description` VARCHAR(191) NULL,
    ADD COLUMN `vendorWorkOrderLineId` INTEGER NULL;

-- AlterTable: a GRN can now be reversed (previously a wrongly booked receipt
-- left company stock permanently inflated with no way back)
ALTER TABLE `GRN`
    ADD COLUMN `cancelReason` TEXT NULL,
    ADD COLUMN `vendorWorkOrderId` INTEGER NULL;

-- CreateTable
CREATE TABLE `VendorWorkOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `assignmentId` INTEGER NULL,
    `jobcardId` INTEGER NULL,
    `departmentId` INTEGER NULL,
    `partyId` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'PARTIAL_RECEIVED', 'RECEIVED', 'SHORT_CLOSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `date` DATETIME(3) NOT NULL,
    `sentDate` DATETIME(3) NULL,
    `expectedReturnDate` DATETIME(3) NULL,
    `actualReturnDate` DATETIME(3) NULL,
    `scopeDescription` TEXT NULL,
    `instructions` TEXT NULL,
    `notes` TEXT NULL,
    `closureRemarks` TEXT NULL,
    `materialIssued` BOOLEAN NOT NULL DEFAULT false,
    `jobworkChallanId` INTEGER NULL,
    `poId` INTEGER NULL,
    `createdById` INTEGER NULL,
    `sentById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VendorWorkOrder_number_key`(`number`),
    UNIQUE INDEX `VendorWorkOrder_jobworkChallanId_key`(`jobworkChallanId`),
    UNIQUE INDEX `VendorWorkOrder_poId_key`(`poId`),
    INDEX `VendorWorkOrder_partyId_idx`(`partyId`),
    INDEX `VendorWorkOrder_status_idx`(`status`),
    INDEX `VendorWorkOrder_assignmentId_idx`(`assignmentId`),
    INDEX `VendorWorkOrder_jobcardId_idx`(`jobcardId`),
    INDEX `VendorWorkOrder_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VendorWorkOrderLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vendorWorkOrderId` INTEGER NOT NULL,
    `itemId` INTEGER NULL,
    `description` VARCHAR(191) NULL,
    `drawingNumber` VARCHAR(191) NULL,
    `partNumber` VARCHAR(191) NULL,
    `qtySent` DECIMAL(14, 3) NOT NULL,
    `qtyReceived` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `qtyRejected` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `uomCode` VARCHAR(191) NULL,
    `rate` DECIMAL(14, 2) NULL,
    `gstRate` DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    `notes` VARCHAR(191) NULL,
    `poLineId` INTEGER NULL,

    INDEX `VendorWorkOrderLine_vendorWorkOrderId_idx`(`vendorWorkOrderId`),
    INDEX `VendorWorkOrderLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `GRN_vendorWorkOrderId_idx` ON `GRN`(`vendorWorkOrderId`);

-- CreateIndex
CREATE INDEX `GrnLine_vendorWorkOrderLineId_idx` ON `GrnLine`(`vendorWorkOrderLineId`);

-- AddForeignKey
ALTER TABLE `VendorWorkOrder` ADD CONSTRAINT `VendorWorkOrder_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `Assignment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorWorkOrder` ADD CONSTRAINT `VendorWorkOrder_jobcardId_fkey` FOREIGN KEY (`jobcardId`) REFERENCES `Jobcard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorWorkOrder` ADD CONSTRAINT `VendorWorkOrder_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorWorkOrder` ADD CONSTRAINT `VendorWorkOrder_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorWorkOrder` ADD CONSTRAINT `VendorWorkOrder_jobworkChallanId_fkey` FOREIGN KEY (`jobworkChallanId`) REFERENCES `JobworkChallan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorWorkOrder` ADD CONSTRAINT `VendorWorkOrder_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorWorkOrderLine` ADD CONSTRAINT `VendorWorkOrderLine_vendorWorkOrderId_fkey` FOREIGN KEY (`vendorWorkOrderId`) REFERENCES `VendorWorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VendorWorkOrderLine` ADD CONSTRAINT `VendorWorkOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GRN` ADD CONSTRAINT `GRN_vendorWorkOrderId_fkey` FOREIGN KEY (`vendorWorkOrderId`) REFERENCES `VendorWorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrnLine` ADD CONSTRAINT `GrnLine_vendorWorkOrderLineId_fkey` FOREIGN KEY (`vendorWorkOrderLineId`) REFERENCES `VendorWorkOrderLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
