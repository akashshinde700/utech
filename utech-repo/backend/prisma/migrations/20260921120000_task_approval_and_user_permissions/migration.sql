-- 1) Optional review gate on a task: the assignee submits for review instead
--    of closing it directly, and a manager approves or sends it back.
--    Default false, so every existing task keeps the direct-complete flow.
ALTER TABLE `JobcardOperation`
  MODIFY `status` ENUM('NOT_STARTED','ASSIGNED','ACCEPTED','IN_PROGRESS','ON_HOLD','SUBMITTED','COMPLETED','REJECTED','CANCELLED','REOPENED') NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN `requiresApproval` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `submittedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedById` INTEGER NULL;

ALTER TABLE `JobcardOperation` ADD CONSTRAINT `JobcardOperation_approvedById_fkey`
  FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Per-user permission overrides on top of the role's grants, so one
--    Department Head can be given (or denied) a capability without cloning
--    the whole role. allow = true grants, allow = false revokes.
CREATE TABLE `UserPermission` (
    `userId` INTEGER NOT NULL,
    `permissionId` INTEGER NOT NULL,
    `allow` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserPermission_userId_idx`(`userId`),
    PRIMARY KEY (`userId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `UserPermission` ADD CONSTRAINT `UserPermission_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserPermission` ADD CONSTRAINT `UserPermission_permissionId_fkey`
  FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
