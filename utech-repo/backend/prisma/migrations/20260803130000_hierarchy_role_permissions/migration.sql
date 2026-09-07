-- Baseline permission grants for the new hierarchy roles, so they aren't
-- inert immediately after creation. Kept intentionally conservative — all of
-- these are editable per-role afterwards via the existing Roles UI.

-- Admin: same operational footprint as MANAGER, plus user + department management
-- (spec: "Admin can manage all users except Super Admin").
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'Admin' AND p.`module` IN (
  'party', 'item', 'invoice', 'quotation', 'jobcard', 'jobwork', 'dispatch',
  'machine', 'process', 'purchase', 'grn', 'quality', 'project', 'expense',
  'attachment', 'report', 'customerMaterial', 'stock', 'user', 'department'
);

-- Plant Head: read-only across every module (spec: "can view all departments").
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'Plant Head' AND p.`action` = 'read';

-- Project Engineer: manages projects across departments.
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` = 'Project Engineer' AND p.`module` IN ('jobcard', 'quotation', 'project', 'invoice', 'user')
  AND (p.`module` != 'user' OR p.`action` = 'read')
  AND (p.`module` != 'invoice' OR p.`action` = 'read');

-- Department Head / Supervisor / Team Leader: view + assign jobs to their own
-- department's operators (scopeToDepartment on the Role already restricts the
-- Users list to their own department; jobcard visibility itself is not
-- department-scoped in this pass).
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id` FROM `Role` r, `Permission` p
WHERE r.`name` IN ('Department Head', 'Supervisor', 'Team Leader')
  AND ((p.`module` = 'user' AND p.`action` IN ('read', 'update'))
    OR (p.`module` = 'jobcard' AND p.`action` IN ('read', 'update'))
    OR (p.`module` = 'department' AND p.`action` = 'read'));
