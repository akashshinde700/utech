-- CreateTable: centralized, race-free document numbering (utils/numbering.js).
-- Replaces the old max+1 read-then-write, which handed out duplicate numbers
-- under concurrency (one caller then failed with a 409 on the unique index).
CREATE TABLE `NumberSequence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `current` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `NumberSequence_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
