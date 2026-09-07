-- AlterTable
-- captures who/where work was sent when starting it (e.g. external vendor
-- name), symmetric with the existing completionRemarks captured on complete
ALTER TABLE `Assignment` ADD COLUMN `startNotes` TEXT NULL;
