-- Additive only. Existing lot links and history are not backfilled or altered.
-- Historical on-hand weight is unknown until an authorised user measures it.
ALTER TABLE `CustomerMaterialLot`
  ADD COLUMN `currentWeight` DECIMAL(14, 3) NULL;

ALTER TABLE `StockLedger`
  ADD COLUMN `weightIn` DECIMAL(14, 3) NULL,
  ADD COLUMN `weightOut` DECIMAL(14, 3) NULL,
  ADD COLUMN `weightBalance` DECIMAL(14, 3) NULL;

CREATE TABLE `CustomerMaterialAllocation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `lotId` INTEGER NOT NULL,
  `jobcardId` INTEGER NOT NULL,
  `qty` DECIMAL(14, 3) NOT NULL,
  `weight` DECIMAL(14, 3) NOT NULL,
  `createdById` INTEGER NULL,
  `releasedById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `releasedAt` DATETIME(3) NULL,
  `releaseReason` VARCHAR(191) NULL,
  INDEX `CustomerMaterialAllocation_lotId_releasedAt_idx` (`lotId`, `releasedAt`),
  INDEX `CustomerMaterialAllocation_jobcardId_releasedAt_idx` (`jobcardId`, `releasedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerMaterialAllocation`
  ADD CONSTRAINT `CustomerMaterialAllocation_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `CustomerMaterialLot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `CustomerMaterialAllocation_jobcardId_fkey` FOREIGN KEY (`jobcardId`) REFERENCES `Jobcard`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
