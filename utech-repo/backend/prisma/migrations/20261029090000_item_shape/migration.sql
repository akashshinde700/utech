-- The material size calculator used to write its shape into the size text
-- itself: "Calculator pipe: 145 mm X 25 mm X 145 mm". That put machine
-- bookkeeping in a field people read on screen, on exports and on printed
-- documents.
--
-- The shape moves to its own column. It is not decoration: the dimensions that
-- follow are the shape's own fields IN ORDER, so for a pipe they are outer
-- diameter, wall thickness and length -- while the stock sheet's convention
-- reads the second number as an inner diameter. Same digits, different weight.
-- Dropping the marker without keeping the shape would silently change what the
-- numbers mean.
ALTER TABLE `Item` ADD COLUMN `shape` VARCHAR(32) NULL;

-- Move every size already written in that format: shape into the column, and
-- the dimensions left as the only thing in the text.
UPDATE `Item`
   SET `shape` = LOWER(SUBSTRING_INDEX(SUBSTRING(`size`, 12), ':', 1)),
       `size`  = TRIM(SUBSTRING(`size`, LOCATE(':', `size`) + 1))
 WHERE `size` LIKE 'Calculator %:%';
