-- Relation fields for Return approvals. The scalar columns already existed
-- (added with the base returns tables) but the Prisma models were missing the
-- opposite User relation, so every `include: { approvedBy }` crashed with
-- "Unknown field approvedBy" — i.e. GET/POST on returns returned 500.
ALTER TABLE `SalesReturn`
  ADD CONSTRAINT `SalesReturn_approvedById_fkey`
  FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PurchaseReturn`
  ADD CONSTRAINT `PurchaseReturn_approvedById_fkey`
  FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
