-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Department_name_key`(`name`),
    UNIQUE INDEX `Department_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Role`
    ADD COLUMN `hierarchyLevel` INTEGER NULL,
    ADD COLUMN `requiresDepartment` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `scopeToDepartment` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `User`
    ADD COLUMN `departmentId` INTEGER NULL,
    ADD COLUMN `reportingToId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `User_departmentId_idx` ON `User`(`departmentId`);

-- CreateIndex
CREATE INDEX `User_reportingToId_idx` ON `User`(`reportingToId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_reportingToId_fkey` FOREIGN KEY (`reportingToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed initial departments (Admin can add more later via the Department Master UI)
INSERT IGNORE INTO `Department` (`name`, `code`, `isActive`, `updatedAt`)
VALUES
  ('Fabrication', 'FAB', true, NOW(3)),
  ('Machining', 'MACH', true, NOW(3)),
  ('CNC/VMC', 'CNCVMC', true, NOW(3)),
  ('Vendor Development', 'VDEV', true, NOW(3)),
  ('Quality', 'QC', true, NOW(3));

-- Existing SUPERADMIN/OPERATOR roles: set hierarchyLevel + OPERATOR now requires a department
UPDATE `Role` SET `hierarchyLevel` = 0, `requiresDepartment` = false, `scopeToDepartment` = false WHERE `name` = 'SUPERADMIN';
UPDATE `Role` SET `hierarchyLevel` = 6, `requiresDepartment` = true, `scopeToDepartment` = false WHERE `name` = 'OPERATOR';

-- New roles in the hierarchy (MANAGER is left untouched, unrelated to this hierarchy)
INSERT IGNORE INTO `Role` (`name`, `description`, `isSystem`, `hierarchyLevel`, `requiresDepartment`, `scopeToDepartment`, `updatedAt`)
VALUES
  ('Admin', 'Organization administrator', false, 1, false, false, NOW(3)),
  ('Plant Head', 'Oversees the entire plant across all departments', false, 2, false, false, NOW(3)),
  ('Project Engineer', 'Manages projects across departments', false, 3, false, false, NOW(3)),
  ('Department Head', 'Heads a single department', false, 4, true, true, NOW(3)),
  ('Supervisor', 'Supervises operators within a department', false, 5, true, true, NOW(3)),
  ('Team Leader', 'Leads a team within a department', false, 5, true, true, NOW(3));

-- Permissions: new "department" module, granted to SUPERADMIN only
INSERT IGNORE INTO `Permission` (`key`, `module`, `action`)
VALUES
  ('department.create', 'department', 'create'),
  ('department.read', 'department', 'read'),
  ('department.update', 'department', 'update'),
  ('department.delete', 'department', 'delete');

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'SUPERADMIN' AND p.`module` = 'department';
