-- Quotations: customer (we quote) vs vendor (a vendor quotes us).
ALTER TABLE `Quotation` ADD COLUMN `type` ENUM('CUSTOMER', 'VENDOR') NOT NULL DEFAULT 'CUSTOMER';
CREATE INDEX `Quotation_type_idx` ON `Quotation`(`type`);

-- Permissions: party.* -> customerParty.* + vendorParty.*,
--              quotation.* -> customerQuotation.* + vendorQuotation.*.
-- Every role / per-user grant of an old key becomes a grant of BOTH new keys,
-- so nobody loses access in the move; the old keys are then removed.
INSERT INTO `Permission` (`key`, `module`, `action`)
  SELECT CONCAT(n.module, '.', o.action), n.module, o.action
  FROM `Permission` o
  JOIN (SELECT 'party' AS old_mod, 'customerParty' AS module UNION ALL
        SELECT 'party', 'vendorParty' UNION ALL
        SELECT 'quotation', 'customerQuotation' UNION ALL
        SELECT 'quotation', 'vendorQuotation') n ON n.old_mod = o.module
  WHERE NOT EXISTS (SELECT 1 FROM `Permission` x WHERE x.`key` = CONCAT(n.module, '.', o.action));

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
  SELECT rp.`roleId`, np.`id`
  FROM `RolePermission` rp
  JOIN `Permission` op ON op.`id` = rp.`permissionId`
  JOIN `Permission` np ON np.`action` = op.`action`
   AND ((op.`module` = 'party' AND np.`module` IN ('customerParty', 'vendorParty'))
     OR (op.`module` = 'quotation' AND np.`module` IN ('customerQuotation', 'vendorQuotation')));

INSERT IGNORE INTO `UserPermission` (`userId`, `permissionId`, `allow`, `createdAt`)
  SELECT up.`userId`, np.`id`, up.`allow`, up.`createdAt`
  FROM `UserPermission` up
  JOIN `Permission` op ON op.`id` = up.`permissionId`
  JOIN `Permission` np ON np.`action` = op.`action`
   AND ((op.`module` = 'party' AND np.`module` IN ('customerParty', 'vendorParty'))
     OR (op.`module` = 'quotation' AND np.`module` IN ('customerQuotation', 'vendorQuotation')));

-- RolePermission / UserPermission rows cascade with their Permission
DELETE FROM `Permission` WHERE `module` IN ('party', 'quotation');
