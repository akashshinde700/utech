-- AlterTable
ALTER TABLE `StockLedger`
    MODIFY COLUMN `itemId` INTEGER NULL,
    ADD COLUMN `ownerType` ENUM('COMPANY', 'CUSTOMER') NOT NULL DEFAULT 'COMPANY',
    ADD COLUMN `customerMaterialLotId` INTEGER NULL;

-- AlterTable
-- MySQL has no ALTER-ADD-VALUE syntax for enums; the full value list must be
-- restated (order matches the Prisma enum declaration).
ALTER TABLE `JobworkChallan`
    MODIFY COLUMN `status` ENUM('ISSUED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED', 'REJECTED') NOT NULL DEFAULT 'ISSUED',
    ADD COLUMN `materialOwnerType` ENUM('COMPANY', 'CUSTOMER') NOT NULL DEFAULT 'COMPANY',
    ADD COLUMN `customerMaterialLotId` INTEGER NULL,
    ADD COLUMN `expectedReturnDate` DATETIME(3) NULL,
    ADD COLUMN `actualReturnDate` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `JobworkLine`
    MODIFY COLUMN `itemId` INTEGER NULL,
    ADD COLUMN `description` VARCHAR(191) NULL,
    ADD COLUMN `qtyRejected` DECIMAL(14, 3) NOT NULL DEFAULT 0.000;

-- CreateTable
CREATE TABLE `CustomerMaterialLot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `inwardNumber` VARCHAR(191) NOT NULL,
    `jobcardId` INTEGER NULL,
    `itemId` INTEGER NULL,
    `materialDescription` VARCHAR(191) NOT NULL,
    `heatNumber` VARCHAR(191) NULL,
    `lotNumber` VARCHAR(191) NULL,
    `qty` DECIMAL(14, 3) NOT NULL,
    `weight` DECIMAL(14, 3) NULL,
    `uomCode` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `status` ENUM('RECEIVED', 'IN_PROCESS', 'AT_VENDOR', 'CONSUMED', 'DISPATCHED', 'RETURNED_TO_CUSTOMER') NOT NULL DEFAULT 'RECEIVED',
    `receivedDate` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CustomerMaterialLot_inwardNumber_key`(`inwardNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `StockLedger_ownerType_date_idx` ON `StockLedger`(`ownerType`, `date`);

-- CreateIndex
CREATE INDEX `StockLedger_customerMaterialLotId_idx` ON `StockLedger`(`customerMaterialLotId`);

-- CreateIndex
CREATE INDEX `JobworkChallan_customerMaterialLotId_idx` ON `JobworkChallan`(`customerMaterialLotId`);

-- CreateIndex
CREATE INDEX `JobworkChallan_materialOwnerType_idx` ON `JobworkChallan`(`materialOwnerType`);

-- CreateIndex
CREATE INDEX `CustomerMaterialLot_customerId_idx` ON `CustomerMaterialLot`(`customerId`);

-- CreateIndex
CREATE INDEX `CustomerMaterialLot_status_idx` ON `CustomerMaterialLot`(`status`);

-- CreateIndex
CREATE INDEX `CustomerMaterialLot_jobcardId_idx` ON `CustomerMaterialLot`(`jobcardId`);

-- CreateIndex
CREATE INDEX `CustomerMaterialLot_itemId_idx` ON `CustomerMaterialLot`(`itemId`);

-- AddForeignKey
ALTER TABLE `StockLedger` ADD CONSTRAINT `StockLedger_customerMaterialLotId_fkey` FOREIGN KEY (`customerMaterialLotId`) REFERENCES `CustomerMaterialLot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobworkChallan` ADD CONSTRAINT `JobworkChallan_customerMaterialLotId_fkey` FOREIGN KEY (`customerMaterialLotId`) REFERENCES `CustomerMaterialLot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerMaterialLot` ADD CONSTRAINT `CustomerMaterialLot_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Party`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerMaterialLot` ADD CONSTRAINT `CustomerMaterialLot_jobcardId_fkey` FOREIGN KEY (`jobcardId`) REFERENCES `Jobcard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerMaterialLot` ADD CONSTRAINT `CustomerMaterialLot_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerMaterialLot` ADD CONSTRAINT `CustomerMaterialLot_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions: new "customerMaterial" module, granted to SUPERADMIN + MANAGER only
-- (matches jobwork/dispatch/grn's existing managerMods grant pattern; OPERATOR is
-- intentionally not granted anything here).
INSERT IGNORE INTO `Permission` (`key`, `module`, `action`)
VALUES
  ('customerMaterial.create', 'customerMaterial', 'create'),
  ('customerMaterial.read', 'customerMaterial', 'read'),
  ('customerMaterial.update', 'customerMaterial', 'update'),
  ('customerMaterial.delete', 'customerMaterial', 'delete'),
  ('stock.read', 'stock', 'read'),
  ('stock.adjust', 'stock', 'adjust');

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` IN ('SUPERADMIN', 'MANAGER') AND p.`module` IN ('customerMaterial', 'stock');
