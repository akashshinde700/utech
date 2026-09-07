-- AlterTable
ALTER TABLE `Jobcard` ADD COLUMN `projectEngineerId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Jobcard_projectEngineerId_idx` ON `Jobcard`(`projectEngineerId`);

-- AddForeignKey
ALTER TABLE `Jobcard` ADD CONSTRAINT `Jobcard_projectEngineerId_fkey` FOREIGN KEY (`projectEngineerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
