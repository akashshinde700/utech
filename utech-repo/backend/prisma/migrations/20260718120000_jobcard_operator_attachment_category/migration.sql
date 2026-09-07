-- AlterTable
ALTER TABLE `Jobcard` ADD COLUMN `assignedOperatorId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Attachment` ADD COLUMN `category` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Jobcard_assignedOperatorId_idx` ON `Jobcard`(`assignedOperatorId`);

-- AddForeignKey
ALTER TABLE `Jobcard` ADD CONSTRAINT `Jobcard_assignedOperatorId_fkey` FOREIGN KEY (`assignedOperatorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
