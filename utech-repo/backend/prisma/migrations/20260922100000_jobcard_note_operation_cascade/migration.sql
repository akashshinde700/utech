-- schema.prisma has always declared JobcardNote.operation with onDelete: Cascade,
-- but the task-progress migration created the constraint as ON DELETE SET NULL.
-- Deleting a task therefore left its comment thread behind as project-level
-- notes. Align the database with the schema.
ALTER TABLE `JobcardNote` DROP FOREIGN KEY `JobcardNote_operationId_fkey`;
ALTER TABLE `JobcardNote` ADD CONSTRAINT `JobcardNote_operationId_fkey`
  FOREIGN KEY (`operationId`) REFERENCES `JobcardOperation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
