-- Party: nickname, GST state code (derived from GSTIN) and bank details.

ALTER TABLE `Party`
  ADD COLUMN `nickName` VARCHAR(191) NULL,
  ADD COLUMN `stateCode` VARCHAR(191) NULL,
  ADD COLUMN `bankName` VARCHAR(191) NULL,
  ADD COLUMN `bankAccountNo` VARCHAR(191) NULL,
  ADD COLUMN `bankIfsc` VARCHAR(191) NULL,
  ADD COLUMN `bankBranch` VARCHAR(191) NULL;
