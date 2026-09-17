-- Department Head Task Progress / Task Assignment module.
-- Built by extending the existing (previously unused by any UI) JobcardOperation
-- table into the real "task" unit, plus small additive links elsewhere, instead
-- of a parallel task-management schema.

-- ── Jobcard: real Project link (keeps legacy free-text projectNumber) ──────
ALTER TABLE `Jobcard` ADD COLUMN `projectId` INTEGER NULL;
CREATE INDEX `Jobcard_projectId_idx` ON `Jobcard`(`projectId`);
ALTER TABLE `Jobcard` ADD CONSTRAINT `Jobcard_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Process: stage grouping + Process Master (department scope, sub-process
--    nesting, optional template-level dependency, display order) — all
--    additive, existing Process rows/usages (JobcardOperation, JobworkLine)
--    are unaffected.
ALTER TABLE `Process`
  ADD COLUMN `stage` VARCHAR(191) NULL,
  ADD COLUMN `departmentId` INTEGER NULL,
  ADD COLUMN `parentProcessId` INTEGER NULL,
  ADD COLUMN `dependsOnProcessId` INTEGER NULL,
  ADD COLUMN `displayOrder` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `createdById` INTEGER NULL;

CREATE INDEX `Process_departmentId_idx` ON `Process`(`departmentId`);
CREATE INDEX `Process_parentProcessId_idx` ON `Process`(`parentProcessId`);

ALTER TABLE `Process` ADD CONSTRAINT `Process_departmentId_fkey`
  FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Process` ADD CONSTRAINT `Process_parentProcessId_fkey`
  FOREIGN KEY (`parentProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Process` ADD CONSTRAINT `Process_dependsOnProcessId_fkey`
  FOREIGN KEY (`dependsOnProcessId`) REFERENCES `Process`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Process` ADD CONSTRAINT `Process_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ── JobcardNote: optional link to one task within the jobcard ─────────────
ALTER TABLE `JobcardNote` ADD COLUMN `operationId` INTEGER NULL;
CREATE INDEX `JobcardNote_operationId_idx` ON `JobcardNote`(`operationId`);

-- ── JobcardOperation: reshape into the Task Progress task unit ────────────
-- normalize the old free-text status before the column becomes an ENUM
UPDATE `JobcardOperation` SET `status` = CASE `status`
  WHEN 'PENDING' THEN 'NOT_STARTED'
  WHEN 'RUNNING' THEN 'IN_PROGRESS'
  WHEN 'DONE' THEN 'COMPLETED'
  WHEN 'SKIPPED' THEN 'CANCELLED'
  ELSE 'NOT_STARTED'
END;

ALTER TABLE `JobcardOperation`
  MODIFY `status` ENUM('NOT_STARTED','ASSIGNED','ACCEPTED','IN_PROGRESS','ON_HOLD','COMPLETED','REJECTED','CANCELLED','REOPENED') NOT NULL DEFAULT 'NOT_STARTED',
  MODIFY `notes` TEXT NULL,
  ADD COLUMN `title` VARCHAR(191) NULL,
  ADD COLUMN `priority` ENUM('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN `progressPercent` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `departmentId` INTEGER NULL,
  ADD COLUMN `assignedToId` INTEGER NULL,
  ADD COLUMN `assignedById` INTEGER NULL,
  ADD COLUMN `createdById` INTEGER NULL,
  ADD COLUMN `plannedStartAt` DATETIME(3) NULL,
  ADD COLUMN `dueDate` DATETIME(3) NULL,
  ADD COLUMN `estimatedHours` DECIMAL(6, 2) NULL,
  ADD COLUMN `actualHours` DECIMAL(6, 2) NULL,
  ADD COLUMN `acceptedAt` DATETIME(3) NULL,
  ADD COLUMN `parentOperationId` INTEGER NULL,
  ADD COLUMN `reworkReason` TEXT NULL,
  ADD COLUMN `dependsOnOperationId` INTEGER NULL,
  ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `JobcardOperation_assignedToId_idx` ON `JobcardOperation`(`assignedToId`);
CREATE INDEX `JobcardOperation_departmentId_idx` ON `JobcardOperation`(`departmentId`);
CREATE INDEX `JobcardOperation_status_idx` ON `JobcardOperation`(`status`);
CREATE INDEX `JobcardOperation_parentOperationId_idx` ON `JobcardOperation`(`parentOperationId`);

ALTER TABLE `JobcardOperation` ADD CONSTRAINT `JobcardOperation_departmentId_fkey`
  FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `JobcardOperation` ADD CONSTRAINT `JobcardOperation_assignedToId_fkey`
  FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `JobcardOperation` ADD CONSTRAINT `JobcardOperation_assignedById_fkey`
  FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `JobcardOperation` ADD CONSTRAINT `JobcardOperation_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `JobcardOperation` ADD CONSTRAINT `JobcardOperation_parentOperationId_fkey`
  FOREIGN KEY (`parentOperationId`) REFERENCES `JobcardOperation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `JobcardOperation` ADD CONSTRAINT `JobcardOperation_dependsOnOperationId_fkey`
  FOREIGN KEY (`dependsOnOperationId`) REFERENCES `JobcardOperation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- (JobcardNote.operationId FK added last, after JobcardOperation's own new PK-adjacent
-- columns exist, purely for a tidy migration order — no functional dependency)
ALTER TABLE `JobcardNote` ADD CONSTRAINT `JobcardNote_operationId_fkey`
  FOREIGN KEY (`operationId`) REFERENCES `JobcardOperation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
