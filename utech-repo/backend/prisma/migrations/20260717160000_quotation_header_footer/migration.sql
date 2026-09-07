-- AlterTable: quotation-level header/footer text (snapshot of whatever template was applied)
ALTER TABLE `Quotation`
  ADD COLUMN `headerText` TEXT NULL,
  ADD COLUMN `footerText` TEXT NULL;

-- CreateTable: reusable header/footer templates
CREATE TABLE `QuotationTemplate` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `headerText` TEXT NULL,
  `footerText` TEXT NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE UNIQUE INDEX `QuotationTemplate_name_key` ON `QuotationTemplate`(`name`);
