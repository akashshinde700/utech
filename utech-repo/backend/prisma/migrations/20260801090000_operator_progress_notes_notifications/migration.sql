-- AlterTable
ALTER TABLE `Jobcard`
    ADD COLUMN `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    ADD COLUMN `workStatus` ENUM('NOT_STARTED', 'IN_PROGRESS', 'TESTING', 'COMPLETED') NOT NULL DEFAULT 'NOT_STARTED',
    ADD COLUMN `checklist` JSON NULL;

-- CreateTable
CREATE TABLE `JobcardNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jobcardId` INTEGER NOT NULL,
    `kind` ENUM('WORK_UPDATE', 'COMMENT') NOT NULL,
    `body` TEXT NOT NULL,
    `authorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` INTEGER NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `JobcardNote_jobcardId_idx` ON `JobcardNote`(`jobcardId`);

-- CreateIndex
CREATE INDEX `Notification_userId_isRead_idx` ON `Notification`(`userId`, `isRead`);

-- AddForeignKey
ALTER TABLE `JobcardNote` ADD CONSTRAINT `JobcardNote_jobcardId_fkey` FOREIGN KEY (`jobcardId`) REFERENCES `Jobcard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JobcardNote` ADD CONSTRAINT `JobcardNote_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions: add a narrow "jobcard.progress" permission for the operator-facing
-- endpoints, grant it to SUPERADMIN/MANAGER alongside their existing full access,
-- and swap OPERATOR's broad "jobcard.update" for this narrow one (also revokes
-- OPERATOR's access to the generic PUT /jobcards/:id and the revert endpoint,
-- which are both gated by jobcard.update).
INSERT IGNORE INTO `Permission` (`key`, `module`, `action`) VALUES ('jobcard.progress', 'jobcard', 'progress');

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` IN ('SUPERADMIN', 'MANAGER') AND p.`key` = 'jobcard.progress';

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'OPERATOR' AND p.`key` = 'jobcard.progress';

DELETE rp FROM `RolePermission` rp
JOIN `Permission` p ON rp.`permissionId` = p.`id`
JOIN `Role` r ON rp.`roleId` = r.`id`
WHERE r.`name` = 'OPERATOR' AND p.`key` = 'jobcard.update';
