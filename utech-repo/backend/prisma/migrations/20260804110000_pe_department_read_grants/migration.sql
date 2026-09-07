-- Project Engineer needs to read Departments + Sub Categories to build the
-- new "Assign Work" modal's Department -> Sub Category -> User chain — this
-- was missed when 'department'/'departmentSubcategory' were first seeded
-- (Project Engineer wasn't department-scoped at the time, so it was never
-- granted read access to either module).
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'Project Engineer' AND p.`module` IN ('department', 'departmentSubcategory') AND p.`action` = 'read';
