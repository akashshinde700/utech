-- AlterTable
ALTER TABLE `Quotation`
  ADD COLUMN `headerImageName` VARCHAR(191) NULL,
  ADD COLUMN `headerImageStoredName` VARCHAR(191) NULL,
  ADD COLUMN `footerImageName` VARCHAR(191) NULL,
  ADD COLUMN `footerImageStoredName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `QuotationTemplate`
  ADD COLUMN `headerImageName` VARCHAR(191) NULL,
  ADD COLUMN `headerImageStoredName` VARCHAR(191) NULL,
  ADD COLUMN `footerImageName` VARCHAR(191) NULL,
  ADD COLUMN `footerImageStoredName` VARCHAR(191) NULL;
