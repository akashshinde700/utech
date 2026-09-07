-- AlterTable: JobcardLine items are now project-scoped free text, not required to link to the Item master
ALTER TABLE `JobcardLine`
  MODIFY COLUMN `itemId` INTEGER NULL,
  ADD COLUMN `itemName` VARCHAR(191) NULL;
