-- Project delete should only be available to Super Admin and Admin. It was
-- previously also granted to Project Engineer and the legacy MANAGER role;
-- revoke it from everyone except SUPERADMIN/Admin so the frontend can gate
-- the Delete button purely on the jobcard.delete permission (no hardcoded
-- role-name check needed).
DELETE rp FROM `RolePermission` rp
JOIN `Permission` p ON p.`id` = rp.`permissionId`
JOIN `Role` r ON r.`id` = rp.`roleId`
WHERE p.`key` = 'jobcard.delete' AND r.`name` NOT IN ('SUPERADMIN', 'Admin');
