-- DropForeignKey (old review-cycle field being removed)
ALTER TABLE `Assignment` DROP FOREIGN KEY `Assignment_reviewedById_fkey`;

-- AlterTable: simplify status workflow (ASSIGNED/ACCEPTED/IN_PROGRESS/SUBMITTED/APPROVED/REJECTED/REWORK_REQUESTED/CLOSED
-- -> ASSIGNED/IN_PROGRESS/COMPLETED/REOPENED/CANCELLED) and replace the accept/submit/review
-- cycle with a direct start/complete/reopen cycle. Safe: production has 0 Assignment rows.
ALTER TABLE `Assignment`
    MODIFY COLUMN `status` ENUM('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REOPENED', 'CANCELLED') NOT NULL DEFAULT 'ASSIGNED',
    DROP COLUMN `acceptedAt`,
    DROP COLUMN `submittedAt`,
    DROP COLUMN `reviewedById`,
    DROP COLUMN `reviewedAt`,
    DROP COLUMN `reviewNotes`,
    ADD COLUMN `departmentId` INTEGER NULL,
    ADD COLUMN `departmentSubCategoryId` INTEGER NULL,
    ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `completedById` INTEGER NULL,
    ADD COLUMN `completionRemarks` TEXT NULL;

-- CreateIndex
CREATE INDEX `Assignment_departmentId_idx` ON `Assignment`(`departmentId`);

-- CreateIndex
CREATE INDEX `Assignment_departmentSubCategoryId_idx` ON `Assignment`(`departmentSubCategoryId`);

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_departmentSubCategoryId_fkey` FOREIGN KEY (`departmentSubCategoryId`) REFERENCES `DepartmentSubCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_completedById_fkey` FOREIGN KEY (`completedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
