-- AlterTable
ALTER TABLE `Jobcard`
  ADD COLUMN `projectNumber` VARCHAR(191) NULL,
  ADD COLUMN `assemblyNumber` VARCHAR(191) NULL,
  ADD COLUMN `drawingNumber` VARCHAR(191) NULL;
