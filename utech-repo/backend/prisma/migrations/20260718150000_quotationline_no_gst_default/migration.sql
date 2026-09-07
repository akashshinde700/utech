-- AlterTable: quotations are sent without GST, so default the stored rate to 0
ALTER TABLE `QuotationLine` MODIFY `gstRate` DECIMAL(5, 2) NOT NULL DEFAULT 0.00;

-- backfill existing rows that only ever had the old 18.00 schema default
UPDATE `QuotationLine` SET `gstRate` = 0.00;
