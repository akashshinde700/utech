-- CreateTable
CREATE TABLE `Assignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attachmentId` INTEGER NOT NULL,
    `pageNumbers` JSON NULL,
    `assignedById` INTEGER NOT NULL,
    `assignedToId` INTEGER NOT NULL,
    `instructions` TEXT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `dueDate` DATETIME(3) NULL,
    `status` ENUM('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REWORK_REQUESTED', 'CLOSED') NOT NULL DEFAULT 'ASSIGNED',
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acceptedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedById` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Assignment_attachmentId_idx`(`attachmentId`),
    INDEX `Assignment_assignedToId_idx`(`assignedToId`),
    INDEX `Assignment_assignedById_idx`(`assignedById`),
    INDEX `Assignment_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions: new "assignment" module
INSERT IGNORE INTO `Permission` (`key`, `module`, `action`)
VALUES
  ('assignment.create', 'assignment', 'create'),
  ('assignment.read', 'assignment', 'read'),
  ('assignment.update', 'assignment', 'update'),
  ('assignment.delete', 'assignment', 'delete');

-- SUPERADMIN gets everything (also covered by its permission bypass, kept for consistency)
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'SUPERADMIN' AND p.`module` = 'assignment';

-- Admin / Plant Head: oversight, read-only
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` IN ('Admin', 'Plant Head') AND p.`module` = 'assignment' AND p.`action` = 'read';

-- Project Engineer / Department Head / Supervisor / Team Leader: both assign and get assigned
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` IN ('Project Engineer', 'Department Head', 'Supervisor', 'Team Leader')
  AND p.`module` = 'assignment' AND p.`action` IN ('create', 'read', 'update');

-- Operator: receives and acts on assignments, never creates one
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'OPERATOR' AND p.`module` = 'assignment' AND p.`action` IN ('read', 'update');

-- Note: a future Vendor/External Developer role (created via the Roles UI) is
-- NOT granted here — the admin grants it assignment.read/update themselves
-- via the Roles page, same as any other permission on a self-created role.
