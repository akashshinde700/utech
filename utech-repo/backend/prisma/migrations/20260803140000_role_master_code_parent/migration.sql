-- AlterTable
ALTER TABLE `Role`
    ADD COLUMN `code` VARCHAR(191) NULL,
    ADD COLUMN `parentRoleId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Role_code_key` ON `Role`(`code`);

-- CreateIndex
CREATE INDEX `Role_parentRoleId_idx` ON `Role`(`parentRoleId`);

-- AddForeignKey
ALTER TABLE `Role` ADD CONSTRAINT `Role_parentRoleId_fkey` FOREIGN KEY (`parentRoleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill `code` for existing roles (new roles created after this point must
-- supply their own unique code via the app).
UPDATE `Role` SET `code` = 'SUPERADMIN' WHERE `name` = 'SUPERADMIN';
UPDATE `Role` SET `code` = 'MANAGER' WHERE `name` = 'MANAGER';
UPDATE `Role` SET `code` = 'ADMIN' WHERE `name` = 'Admin';
UPDATE `Role` SET `code` = 'PLANT_HEAD' WHERE `name` = 'Plant Head';
UPDATE `Role` SET `code` = 'PROJECT_ENGINEER' WHERE `name` = 'Project Engineer';
UPDATE `Role` SET `code` = 'DEPARTMENT_HEAD' WHERE `name` = 'Department Head';
UPDATE `Role` SET `code` = 'SUPERVISOR' WHERE `name` = 'Supervisor';
UPDATE `Role` SET `code` = 'TEAM_LEADER' WHERE `name` = 'Team Leader';
UPDATE `Role` SET `code` = 'OPERATOR' WHERE `name` = 'OPERATOR';

-- Backfill `parentRoleId` to match the reporting chain already implied by
-- hierarchyLevel (self-join UPDATE — MySQL disallows a plain subquery on the
-- same table being updated, but a self-join is fine).
UPDATE `Role` child JOIN `Role` parent ON parent.`name` = 'SUPERADMIN' SET child.`parentRoleId` = parent.`id` WHERE child.`name` = 'Admin';
UPDATE `Role` child JOIN `Role` parent ON parent.`name` = 'Admin' SET child.`parentRoleId` = parent.`id` WHERE child.`name` = 'Plant Head';
UPDATE `Role` child JOIN `Role` parent ON parent.`name` = 'Plant Head' SET child.`parentRoleId` = parent.`id` WHERE child.`name` = 'Project Engineer';
UPDATE `Role` child JOIN `Role` parent ON parent.`name` = 'Project Engineer' SET child.`parentRoleId` = parent.`id` WHERE child.`name` = 'Department Head';
UPDATE `Role` child JOIN `Role` parent ON parent.`name` = 'Department Head' SET child.`parentRoleId` = parent.`id` WHERE child.`name` IN ('Supervisor', 'Team Leader');
UPDATE `Role` child JOIN `Role` parent ON parent.`name` = 'Supervisor' SET child.`parentRoleId` = parent.`id` WHERE child.`name` = 'OPERATOR';
