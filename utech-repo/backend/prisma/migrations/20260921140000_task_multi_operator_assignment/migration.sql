-- Multi-operator Task Progress assignment.
-- `JobcardOperation.assignedToId` is kept in sync with the first assignee so
-- every existing single-assignee query keeps working; this table is the
-- authoritative list and holds each operator's own completion tick.
CREATE TABLE `JobcardOperationAssignee` (
  `id`           INTEGER NOT NULL AUTO_INCREMENT,
  `operationId`  INTEGER NOT NULL,
  `userId`       INTEGER NOT NULL,
  `status`       ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
  `assignedById` INTEGER NULL,
  `assignedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt`  DATETIME(3) NULL,
  `remarks`      TEXT NULL,

  UNIQUE INDEX `JobcardOperationAssignee_operationId_userId_key`(`operationId`, `userId`),
  INDEX `JobcardOperationAssignee_userId_idx`(`userId`),
  INDEX `JobcardOperationAssignee_operationId_idx`(`operationId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `JobcardOperationAssignee`
  ADD CONSTRAINT `JobcardOperationAssignee_operationId_fkey`
  FOREIGN KEY (`operationId`) REFERENCES `JobcardOperation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `JobcardOperationAssignee`
  ADD CONSTRAINT `JobcardOperationAssignee_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `JobcardOperationAssignee`
  ADD CONSTRAINT `JobcardOperationAssignee_assignedById_fkey`
  FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every task that already has a single assignee becomes a one-row
-- assignee set, so the new UI shows existing assignments correctly.
INSERT INTO `JobcardOperationAssignee` (`operationId`, `userId`, `status`, `assignedById`, `assignedAt`, `completedAt`)
SELECT
  o.`id`,
  o.`assignedToId`,
  CASE WHEN o.`status` = 'COMPLETED' THEN 'COMPLETED' ELSE 'PENDING' END,
  o.`assignedById`,
  COALESCE(o.`createdAt`, CURRENT_TIMESTAMP(3)),
  CASE WHEN o.`status` = 'COMPLETED' THEN o.`endAt` ELSE NULL END
FROM `JobcardOperation` o
WHERE o.`assignedToId` IS NOT NULL;
