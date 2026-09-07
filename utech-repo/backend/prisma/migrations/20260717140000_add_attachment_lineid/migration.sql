-- AlterTable
ALTER TABLE `Attachment`
  ADD COLUMN `lineId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Attachment_lineId_idx` ON `Attachment`(`lineId`);
