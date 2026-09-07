-- CreateTable
CREATE TABLE `DepartmentSubCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `departmentId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DepartmentSubCategory_departmentId_idx`(`departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `departmentSubCategoryId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `User_departmentSubCategoryId_idx` ON `User`(`departmentSubCategoryId`);

-- AddForeignKey
ALTER TABLE `DepartmentSubCategory` ADD CONSTRAINT `DepartmentSubCategory_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_departmentSubCategoryId_fkey` FOREIGN KEY (`departmentSubCategoryId`) REFERENCES `DepartmentSubCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Permissions: new "departmentSubcategory" module, same grant shape as "department"
INSERT IGNORE INTO `Permission` (`key`, `module`, `action`)
VALUES
  ('departmentSubcategory.create', 'departmentSubcategory', 'create'),
  ('departmentSubcategory.read', 'departmentSubcategory', 'read'),
  ('departmentSubcategory.update', 'departmentSubcategory', 'update'),
  ('departmentSubcategory.delete', 'departmentSubcategory', 'delete');

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` IN ('SUPERADMIN', 'Admin') AND p.`module` = 'departmentSubcategory';

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` IN ('Plant Head', 'Department Head', 'Supervisor', 'Team Leader')
  AND p.`module` = 'departmentSubcategory' AND p.`action` = 'read';

-- Example/default sub-categories (per department) — admin can add more later
-- via the Sub Category master or the Users form's "+ Add Sub Category" popup.
INSERT IGNORE INTO `DepartmentSubCategory` (`departmentId`, `name`, `code`, `isActive`, `updatedAt`)
SELECT d.id, x.name, x.code, true, NOW(3)
FROM `Department` d
JOIN (
  SELECT 'FAB' AS dept_code, 'Fabrication Operator' AS name, 'FAB_OP' AS code
  UNION ALL SELECT 'FAB', 'Welding Operator', 'FAB_WELD'
  UNION ALL SELECT 'FAB', 'Cutting Operator', 'FAB_CUT'
  UNION ALL SELECT 'FAB', 'Grinding Operator', 'FAB_GRIND'
  UNION ALL SELECT 'MACH', 'Machining Operator', 'MACH_OP'
  UNION ALL SELECT 'MACH', 'CNC Operator', 'MACH_CNC'
  UNION ALL SELECT 'MACH', 'VMC Operator', 'MACH_VMC'
  UNION ALL SELECT 'MACH', 'Turning Operator', 'MACH_TURN'
  UNION ALL SELECT 'CNCVMC', 'CNC Operator', 'CNCVMC_CNC'
  UNION ALL SELECT 'CNCVMC', 'VMC Operator', 'CNCVMC_VMC'
  UNION ALL SELECT 'CNCVMC', 'CNC Programmer', 'CNCVMC_PROG'
  UNION ALL SELECT 'CNCVMC', 'Machine Setter', 'CNCVMC_SETTER'
  UNION ALL SELECT 'VDEV', 'Vendor Development Engineer', 'VDEV_ENG'
  UNION ALL SELECT 'VDEV', 'Vendor Coordinator', 'VDEV_COORD'
  UNION ALL SELECT 'VDEV', 'Vendor Quality Engineer', 'VDEV_QE'
  UNION ALL SELECT 'QC', 'Quality Inspector', 'QC_INSP'
  UNION ALL SELECT 'QC', 'Quality Engineer', 'QC_ENG'
  UNION ALL SELECT 'QC', 'Quality Operator', 'QC_OP'
) x ON x.dept_code = d.code;
