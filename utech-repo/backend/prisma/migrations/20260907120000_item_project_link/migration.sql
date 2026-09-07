-- Real FK from Item to Project (replaces the free-text Item.projectNumber label).
-- projectNumber is kept for items tagged before this link existed.

-- AlterTable
ALTER TABLE `Item` ADD COLUMN `projectId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Item_projectId_idx` ON `Item`(`projectId`);

-- AddForeignKey
ALTER TABLE `Item` ADD CONSTRAINT `Item_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
