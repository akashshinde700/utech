/*
  Warnings:

  - You are about to alter the column `status` on the `purchaseorder` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Enum(EnumId(7))`.
  - Added the required column `updatedAt` to the `QualityCheck` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `GRN` ADD COLUMN `vehicleNo` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PurchaseOrder` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` INTEGER NULL,
    ADD COLUMN `expectedDate` DATETIME(3) NULL,
    ADD COLUMN `gstTotal` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `rejectionReason` VARCHAR(191) NULL,
    ADD COLUMN `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    MODIFY `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE `QualityCheck` ADD COLUMN `certificateNo` VARCHAR(191) NULL,
    ADD COLUMN `inspectorName` VARCHAR(191) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL,
    MODIFY `remarks` TEXT NULL;

-- CreateTable
CREATE TABLE `PurchaseOrderLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `description` VARCHAR(191) NULL,
    `qty` DECIMAL(14, 3) NOT NULL,
    `qtyReceived` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `rate` DECIMAL(14, 2) NOT NULL,
    `gstRate` DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    `amount` DECIMAL(14, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GrnLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grnId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `poLineId` INTEGER NULL,
    `qty` DECIMAL(14, 3) NOT NULL,
    `qtyAccepted` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `qtyRejected` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `rate` DECIMAL(14, 2) NULL,
    `notes` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityCheckLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qcId` INTEGER NOT NULL,
    `parameter` VARCHAR(191) NOT NULL,
    `expected` VARCHAR(191) NULL,
    `actual` VARCHAR(191) NULL,
    `result` VARCHAR(191) NOT NULL DEFAULT 'PASS',
    `notes` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `partyId` INTEGER NULL,
    `description` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `taxAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `paymentMode` VARCHAR(191) NOT NULL DEFAULT 'CASH',
    `reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Expense_number_key`(`number`),
    INDEX `Expense_category_idx`(`category`),
    INDEX `Expense_date_idx`(`date`),
    INDEX `Expense_partyId_idx`(`partyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesReturn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `invoiceId` INTEGER NOT NULL,
    `partyId` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PROCESSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `cgst` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `sgst` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `igst` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `discount` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `total` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `refundAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `reason` TEXT NULL,
    `notes` TEXT NULL,
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesReturn_number_key`(`number`),
    INDEX `SalesReturn_invoiceId_idx`(`invoiceId`),
    INDEX `SalesReturn_partyId_idx`(`partyId`),
    INDEX `SalesReturn_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesReturnLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesReturnId` INTEGER NOT NULL,
    `invoiceLineId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `hsnCode` VARCHAR(191) NULL,
    `qty` DECIMAL(14, 3) NOT NULL,
    `rate` DECIMAL(14, 2) NOT NULL,
    `gstRate` DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    `amount` DECIMAL(14, 2) NOT NULL,
    `reason` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseReturn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `grnId` INTEGER NULL,
    `poId` INTEGER NULL,
    `partyId` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PROCESSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `cgst` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `sgst` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `igst` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `total` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `creditNoteNo` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `notes` TEXT NULL,
    `approvedById` INTEGER NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseReturn_number_key`(`number`),
    INDEX `PurchaseReturn_grnId_idx`(`grnId`),
    INDEX `PurchaseReturn_poId_idx`(`poId`),
    INDEX `PurchaseReturn_partyId_idx`(`partyId`),
    INDEX `PurchaseReturn_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseReturnLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseReturnId` INTEGER NOT NULL,
    `grnLineId` INTEGER NULL,
    `itemId` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `qty` DECIMAL(14, 3) NOT NULL,
    `rate` DECIMAL(14, 2) NOT NULL,
    `gstRate` DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
    `amount` DECIMAL(14, 2) NOT NULL,
    `reason` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BackOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `invoiceId` INTEGER NULL,
    `partyId` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `expectedDate` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BackOrder_number_key`(`number`),
    INDEX `BackOrder_invoiceId_idx`(`invoiceId`),
    INDEX `BackOrder_partyId_idx`(`partyId`),
    INDEX `BackOrder_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BackOrderLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `backOrderId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `qtyOrdered` DECIMAL(14, 3) NOT NULL,
    `qtyFulfilled` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `rate` DECIMAL(14, 2) NOT NULL,
    `notes` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shift` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Shift_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductionBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `shiftId` INTEGER NOT NULL,
    `jobcardId` INTEGER NULL,
    `itemId` INTEGER NOT NULL,
    `bomId` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PLANNED',
    `qtyPlanned` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `qtyProduced` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `qtyRejected` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `startTime` DATETIME(3) NULL,
    `endTime` DATETIME(3) NULL,
    `machineId` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductionBatch_number_key`(`number`),
    INDEX `ProductionBatch_shiftId_idx`(`shiftId`),
    INDEX `ProductionBatch_jobcardId_idx`(`jobcardId`),
    INDEX `ProductionBatch_itemId_idx`(`itemId`),
    INDEX `ProductionBatch_status_idx`(`status`),
    INDEX `ProductionBatch_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductionMaterial` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batchId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qtyPlanned` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `qtyConsumed` DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
    `uomCode` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `GRN_poId_idx` ON `GRN`(`poId`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_partyId_idx` ON `PurchaseOrder`(`partyId`);

-- CreateIndex
CREATE INDEX `PurchaseOrder_status_idx` ON `PurchaseOrder`(`status`);

-- CreateIndex
CREATE INDEX `QualityCheck_refType_refId_idx` ON `QualityCheck`(`refType`, `refId`);

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderLine` ADD CONSTRAINT `PurchaseOrderLine_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderLine` ADD CONSTRAINT `PurchaseOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GRN` ADD CONSTRAINT `GRN_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GRN` ADD CONSTRAINT `GRN_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrnLine` ADD CONSTRAINT `GrnLine_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `GRN`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GrnLine` ADD CONSTRAINT `GrnLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityCheckLine` ADD CONSTRAINT `QualityCheckLine_qcId_fkey` FOREIGN KEY (`qcId`) REFERENCES `QualityCheck`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturn` ADD CONSTRAINT `SalesReturn_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturn` ADD CONSTRAINT `SalesReturn_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturnLine` ADD CONSTRAINT `SalesReturnLine_salesReturnId_fkey` FOREIGN KEY (`salesReturnId`) REFERENCES `SalesReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturnLine` ADD CONSTRAINT `SalesReturnLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `GRN`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturnLine` ADD CONSTRAINT `PurchaseReturnLine_purchaseReturnId_fkey` FOREIGN KEY (`purchaseReturnId`) REFERENCES `PurchaseReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturnLine` ADD CONSTRAINT `PurchaseReturnLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BackOrder` ADD CONSTRAINT `BackOrder_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BackOrder` ADD CONSTRAINT `BackOrder_partyId_fkey` FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BackOrderLine` ADD CONSTRAINT `BackOrderLine_backOrderId_fkey` FOREIGN KEY (`backOrderId`) REFERENCES `BackOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BackOrderLine` ADD CONSTRAINT `BackOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionBatch` ADD CONSTRAINT `ProductionBatch_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionBatch` ADD CONSTRAINT `ProductionBatch_jobcardId_fkey` FOREIGN KEY (`jobcardId`) REFERENCES `Jobcard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionBatch` ADD CONSTRAINT `ProductionBatch_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionBatch` ADD CONSTRAINT `ProductionBatch_bomId_fkey` FOREIGN KEY (`bomId`) REFERENCES `Bom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionBatch` ADD CONSTRAINT `ProductionBatch_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionMaterial` ADD CONSTRAINT `ProductionMaterial_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ProductionBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionMaterial` ADD CONSTRAINT `ProductionMaterial_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
