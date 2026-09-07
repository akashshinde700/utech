-- AlterTable
ALTER TABLE `Department`
    ADD COLUMN `description` VARCHAR(191) NULL,
    ADD COLUMN `departmentHeadUserId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Department_departmentHeadUserId_idx` ON `Department`(`departmentHeadUserId`);

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_departmentHeadUserId_fkey` FOREIGN KEY (`departmentHeadUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
